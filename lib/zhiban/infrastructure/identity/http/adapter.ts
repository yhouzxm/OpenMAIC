import type { createIdentityComposition } from '../composition/root';
import { observedTransport } from '../composition/admission';
import { observeOperation, refuse, type Refusal } from '../composition/refusals';
import type { IdentitySafeQueries } from '@/lib/zhiban/application/identity/use-cases/safe-queries';
import type { AuthenticatedRequestHandle } from '@/lib/zhiban/application/identity/ports/authenticated-request';
import { bearerForCookie } from '../sessions/session-material';
import { membershipId, roleGrantId } from '@/lib/zhiban/domain/identity';
import type {
  MembershipCommandTarget,
  MembershipCommandOutcome,
} from '@/lib/zhiban/application/identity/ports/membership-composition';
import type {
  MemberPoint,
  ConsentContext,
} from '@/lib/zhiban/application/identity/ports/safe-queries';
import {
  body,
  headers,
  cookie,
  query,
  requestId,
  response,
  failure,
  clearCookie,
  record,
  ProtocolRefusal,
  invalid,
  integer,
} from './protocol';
import {
  actions,
  envelopeKeys,
  envelope,
  target,
  targetKeys,
  uuid,
  tenant,
  reference,
  revision,
  password,
  validated,
} from './dto';

export type HttpComposition = Pick<
  Awaited<ReturnType<typeof createIdentityComposition>>,
  'security' | 'application' | 'members'
> & { queries: IdentitySafeQueries };
export interface HttpPolicy {
  readonly origin: string;
  readonly concurrentRequests: number;
  readonly bodyTimeoutMs: number;
  readonly retryAfterSeconds: number;
}
export interface OperationalRecord {
  readonly requestId: string;
  readonly route:
    | 'login'
    | 'logout'
    | 'logout-all'
    | 'me'
    | 'csrf'
    | 'spaces'
    | 'password'
    | 'member'
    | 'consent-context'
    | 'invitations'
    | 'consents'
    | 'admin-transfer'
    | 'unknown';
  readonly status: number;
  readonly duration: 'SHORT' | 'MEDIUM' | 'LONG';
}
export interface HttpFacade {
  handle(request: Request): Promise<Response>;
}
const mapped: Record<Refusal, readonly [number, string]> = {
  SESSION_REJECTED: [401, 'UNAUTHENTICATED'],
  REAUTH_REJECTED: [403, 'FORBIDDEN'],
  TARGET_HIDDEN: [404, 'NOT_FOUND'],
  POLICY_DENIED: [403, 'FORBIDDEN'],
  REQUEST_STALE: [409, 'CONFLICT'],
  ADMISSION_DENIED: [429, 'TOO_MANY_REQUESTS'],
  PASSWORD_POLICY_REJECTED: [400, 'INVALID_REQUEST'],
};
class PublicRefusal {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {}
}
const own = (value: { userId: string; absoluteExpiresAt: number; idleExpiresAt: number }) => ({
  userId: value.userId,
  absoluteExpiresAt: value.absoluteExpiresAt,
  idleExpiresAt: value.idleExpiresAt,
});
const outcome = (v: MembershipCommandOutcome) => ({
  commandId: v.commandId,
  status: v.status,
  effects: v.effects.map((e) => ({
    userId: e.userId,
    membershipId: e.membershipId,
    revision: e.revision,
    authorizationVersion: e.authorizationVersion,
    status: e.status,
  })),
});
const consentContext = (v: ConsentContext) => ({
  membershipId: v.membershipId,
  expectedMemberRevision: v.expectedMemberRevision,
  expectedAuthorizationVersion: v.expectedAuthorizationVersion,
  purpose: v.purpose,
  expiresAt: v.expiresAt,
});
const point = (v: MemberPoint) => ({
  tenantId: v.tenantId,
  membershipId: v.membershipId,
  userId: v.userId,
  status: v.status,
  revision: v.revision,
  authorizationVersion: v.authorizationVersion,
  actorRevision: v.actorRevision,
  actorAuthorizationVersion: v.actorAuthorizationVersion,
  tenantRevision: v.tenantRevision,
  grants: v.grants.map((g) => ({
    grantId: g.grantId,
    roleCode: g.roleCode,
    scope: { type: g.scope.type, scopeId: g.scope.scopeId },
    validUntil: g.validUntil,
  })),
  nextGrantCursor: v.nextGrantCursor,
  consent:
    v.consent === null
      ? null
      : {
          consentId: v.consent.consentId,
          admissionId: v.consent.admissionId,
          purpose: v.consent.purpose,
          expectedMemberRevision: v.consent.expectedMemberRevision,
          expectedAuthorizationVersion: v.consent.expectedAuthorizationVersion,
          expiresAt: v.consent.expiresAt,
        },
});
/** All private handles/material stay in this one facade's module registry, across Next bundles. */
export function createIdentityHttp(
  load: () => Promise<HttpComposition>,
  policy: HttpPolicy,
  telemetry: (record: OperationalRecord) => void = () => {},
): HttpFacade {
  policy = Object.freeze({ ...policy });
  if (
    new URL(policy.origin).origin !== policy.origin ||
    !policy.origin.startsWith('https://') ||
    !Number.isInteger(policy.concurrentRequests) ||
    policy.concurrentRequests < 1 ||
    !Number.isInteger(policy.bodyTimeoutMs) ||
    policy.bodyTimeoutMs < 1 ||
    !Number.isInteger(policy.retryAfterSeconds) ||
    policy.retryAfterSeconds < 1
  )
    throw new Error('Invalid HTTP security policy.');
  let active = 0;
  const root = Promise.resolve().then(load);
  void root.catch(() => {});
  return Object.freeze({
    async handle(request: Request) {
      const id = requestId(),
        started = performance.now();
      let route: OperationalRecord['route'] = 'unknown',
        clear = false,
        status = 503;
      const reply = (s: number, v?: unknown, h?: HeadersInit) => {
        status = s;
        return response(id, s, v, h);
      };
      const fail = (s: number, c: string, h?: HeadersInit) => {
        status = s;
        return failure(id, s, c, h);
      };
      const op = async <T>(work: () => Promise<T>): Promise<T> => {
        const result = await observeOperation(work);
        if (result.ok) return result.value;
        const pair =
          result.refusal === null
            ? ([503, 'SERVICE_UNAVAILABLE'] as const)
            : mapped[result.refusal];
        if (pair[0] === 401) clear = true;
        throw new PublicRefusal(...pair);
      };
      let admitted = false;
      try {
        const url = new URL(request.url),
          p = url.pathname;
        if (Buffer.byteLength(p + url.search) > 2048 || /%|\\|\/\//.test(p)) invalid();
        const ownMatch =
          /^\/api\/zhiban\/identity\/(login|logout|logout-all|me|csrf|spaces|password)$/.exec(p);
        const tenantMatch =
          /^\/api\/zhiban\/identity\/tenants\/([^/]+)\/(consent-context|invitations|consents|admin-transfer|memberships\/([^/]+)(?:\/([^/]+))?)$/.exec(
            p,
          );
        let action: MembershipCommandTarget['action'] | null = null;
        if (ownMatch) route = ownMatch[1] as OperationalRecord['route'];
        else if (tenantMatch) {
          if (tenantMatch[2].startsWith('memberships/')) {
            route = 'member';
            if (tenantMatch[4]) {
              if (!Object.hasOwn(actions, tenantMatch[4])) return fail(404, 'NOT_FOUND');
              action = actions[tenantMatch[4] as keyof typeof actions];
            }
          } else route = tenantMatch[2] as OperationalRecord['route'];
        } else return fail(404, 'NOT_FOUND');
        const methods =
          ['me', 'csrf', 'spaces', 'consent-context'].includes(route) ||
          (route === 'member' && action === null)
            ? ['GET']
            : route === 'password'
              ? ['GET', 'POST']
              : ['POST'];
        if (!methods.includes(request.method))
          return fail(405, 'METHOD_NOT_ALLOWED', { Allow: methods.join(', ') });
        const unsafe = request.method === 'POST';
        headers(request, policy.origin, unsafe);
        const raw = cookie(request);
        if (active >= policy.concurrentRequests)
          return fail(429, 'TOO_MANY_REQUESTS', {
            'Retry-After': String(policy.retryAfterSeconds),
          });
        active++;
        admitted = true;
        const composition = await op(() => root);
        // Only an independently verified, fixed overwriting proxy may supply this address.
        const transport = await op(async () =>
          observedTransport(request.headers.get('x-zhiban-client-ip') ?? ''),
        );
        const q = query(
          request,
          route === 'spaces'
            ? ['afterMembershipId', 'limit']
            : route === 'member' && action === null
              ? ['actorMembershipId', 'afterGrantId', 'consentPurpose']
              : route === 'consent-context'
                ? ['admissionId', 'onboardingRef']
                : [],
        );
        if (
          !unsafe &&
          (request.body !== null ||
            (request.headers.get('content-length') !== null &&
              request.headers.get('content-length') !== '0'))
        )
          invalid();
        const readInput = () =>
          unsafe
            ? body(
                request,
                route === 'login' ? 8192 : route === 'password' ? 16384 : 32768,
                policy.bodyTimeoutMs,
              )
            : Promise.resolve(null);
        const authentication =
          raw === null
            ? { ok: true as const, value: null }
            : await observeOperation(() => composition.security.authenticate(raw));
        let handle: AuthenticatedRequestHandle | null;
        if (authentication.ok) handle = authentication.value;
        else if (route === 'logout' && authentication.refusal === 'SESSION_REJECTED') {
          handle = null;
          clear = true;
        } else {
          const pair =
            authentication.refusal === null
              ? ([503, 'SERVICE_UNAVAILABLE'] as const)
              : mapped[authentication.refusal];
          if (pair[0] === 401) clear = true;
          throw new PublicRefusal(...pair);
        }
        if (raw !== null && handle === null) clear = true;
        const assert = async () => {
          if (handle === null) {
            clear = true;
            throw new PublicRefusal(401, 'UNAUTHENTICATED');
          }
          const h = handle;
          if (unsafe) {
            const proof = request.headers.get('x-zhiban-csrf');
            if (proof === null || !/^[A-Za-z0-9_-]{43}$/.test(proof))
              throw new ProtocolRefusal(403);
            // Session errors have their private tag; invalid protocol proof is not a guessed DB error.
            const result = await observeOperation(() =>
              composition.application.assertUnsafe(h, policy.origin, proof),
            );
            if (!result.ok) {
              if (result.refusal === 'POLICY_DENIED') throw new ProtocolRefusal(403);
              if (result.refusal === null) throw new PublicRefusal(503, 'SERVICE_UNAVAILABLE');
              if (result.refusal === 'SESSION_REJECTED') clear = true;
              throw new PublicRefusal(...mapped[result.refusal]);
            }
          }
          return h;
        };
        if (route === 'login') {
          if (raw !== null) {
            if (handle === null) throw new PublicRefusal(401, 'UNAUTHENTICATED');
            await assert();
          }
          const input = await readInput();
          const b = record(input, ['userId', 'password']);
          if (typeof b.userId !== 'string' || b.userId.length > 128) invalid();
          const secret = password(b.password);
          if (raw !== null) {
            if (handle === null) throw new PublicRefusal(401, 'UNAUTHENTICATED');
            await op(() => composition.application.logout(handle!, id));
            clear = true;
            handle = null;
          }
          const result = await op(() =>
            composition.security.login(b.userId, secret, transport, id),
          );
          if (result.status !== 'ISSUED')
            return fail(401, 'UNAUTHENTICATED', clear ? { 'Set-Cookie': clearCookie } : undefined);
          const maxAge = Math.max(
            0,
            Math.floor((result.identity.absoluteExpiresAt - Date.now()) / 1000),
          );
          if (maxAge === 0) throw new PublicRefusal(401, 'UNAUTHENTICATED');
          return reply(200, own(result.identity), {
            'Set-Cookie': `__Host-zhiban_session=${bearerForCookie(result.bearer)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}; Expires=${new Date(result.identity.absoluteExpiresAt).toUTCString()}`,
          });
        }
        if (route === 'logout') {
          if (handle !== null) await assert();
          const input = await readInput();
          record(input, []);
          if (handle !== null) {
            await op(() => composition.application.logout(handle!, id));
          }
          return reply(204, undefined, { 'Set-Cookie': clearCookie });
        }
        const h = await assert();
        const input = await readInput();
        if (route === 'me') return reply(200, own(await op(() => composition.application.me(h))));
        if (route === 'csrf')
          return reply(200, { csrfToken: await op(() => composition.application.csrfToken(h)) });
        if (route === 'spaces') {
          const limit = q.limit === undefined ? 25 : integer(Number(q.limit), 50);
          if (limit < 1 || (q.limit !== undefined && !/^[1-9][0-9]?$/.test(q.limit))) invalid();
          const cursor =
            q.afterMembershipId === undefined
              ? null
              : validated(() => membershipId(q.afterMembershipId));
          const spaces = await op(() => composition.application.spaces(h, cursor, limit));
          return reply(200, {
            spaces: spaces.map((s) => ({
              tenantId: s.tenantId,
              tenantCode: s.tenantCode,
              displayName: s.displayName,
              membershipId: s.membershipId,
            })),
            nextCursor: spaces.length === limit ? spaces[spaces.length - 1].membershipId : null,
          });
        }
        if (route === 'password') {
          if (!unsafe) {
            const state = await op(() => composition.queries.passwordState(h));
            return reply(200, { credentialRevision: state.credentialRevision });
          }
          const b = record(input, ['password', 'newPassword', 'expectedCredentialRevision']),
            old = password(b.password),
            fresh = password(b.newPassword, true),
            expected = revision(b.expectedCredentialRevision);
          await op(() =>
            composition.application.changePassword(h, old, fresh, transport, id, expected),
          );
          return reply(204, undefined, { 'Set-Cookie': clearCookie });
        }
        if (route === 'logout-all') {
          const b = record(input, ['password']),
            secret = password(b.password);
          await op(() => composition.application.logoutAll(h, secret, transport, id));
          return reply(204, undefined, { 'Set-Cookie': clearCookie });
        }
        const tid = tenant(tenantMatch![1]);
        if (route === 'consent-context') {
          if ((q.admissionId === undefined) === (q.onboardingRef === undefined)) invalid();
          const context = {
            tenantId: tid,
            admissionId: q.admissionId === undefined ? null : uuid(q.admissionId),
            onboardingRef: q.onboardingRef === undefined ? null : reference(q.onboardingRef),
          };
          return reply(
            200,
            consentContext(await op(() => composition.queries.consentContext(h, context))),
          );
        }
        if (route === 'member' && action === null) {
          const purpose = q.consentPurpose ?? null;
          if (purpose !== null && !['ACTIVATE', 'REACTIVATE', 'REJOIN'].includes(purpose))
            invalid();
          const lookup = {
            tenantId: tid,
            membershipId: validated(() => membershipId(tenantMatch![3])),
            actorMembershipId: validated(() => membershipId(q.actorMembershipId)),
            afterGrantId:
              q.afterGrantId === undefined ? null : validated(() => roleGrantId(q.afterGrantId)),
            consentPurpose: purpose as 'ACTIVATE' | 'REACTIVATE' | 'REJOIN' | null,
          };
          return reply(200, point(await op(() => composition.queries.member(h, lookup))));
        }
        if (composition.members === null) throw new PublicRefusal(503, 'SERVICE_UNAVAILABLE');
        const members = composition.members,
          key = reference(request.headers.get('idempotency-key'));
        if (route === 'consents') {
          if (typeof input !== 'object' || input === null || Array.isArray(input)) invalid();
          const preliminary = input as Record<string, unknown>;
          const first = Object.hasOwn(preliminary, 'onboardingRef');
          const b = record(input, [
            first ? 'onboardingRef' : 'admissionId',
            'expectedMemberRevision',
            'expectedAuthorizationVersion',
          ]);
          const r = {
            tenantId: tid,
            admissionId: first ? null : uuid(b.admissionId),
            controlApprovalRef: first ? reference(b.onboardingRef) : null,
            expectedMemberRevision:
              b.expectedMemberRevision === null ? null : revision(b.expectedMemberRevision),
            expectedAuthorizationVersion:
              b.expectedAuthorizationVersion === null
                ? null
                : integer(b.expectedAuthorizationVersion),
            idempotencyKey: key,
            requestId: id,
          };
          return reply(200, outcome(await op(() => members.consent(h, r))));
        }
        if (route === 'invitations') {
          const b = record(input, [...envelopeKeys, 'admissionId', 'password']),
            r = {
              tenantId: tid,
              ...envelope(b),
              admissionId: uuid(b.admissionId),
              idempotencyKey: key,
              requestId: id,
            },
            secret = password(b.password);
          return reply(200, outcome(await op(() => members.invite(h, r, secret, transport))));
        }
        if (route === 'admin-transfer') {
          const b = record(input, [...envelopeKeys, 'targets', 'password']);
          if (!Array.isArray(b.targets) || b.targets.length !== 2) invalid();
          const targets = b.targets.map((t) => {
            if (typeof t !== 'object' || t === null || Array.isArray(t)) invalid();
            const r = t as Record<string, unknown>;
            if (!Object.values(actions).includes(r.action as MembershipCommandTarget['action']))
              invalid();
            const a = r.action as MembershipCommandTarget['action'];
            record(r, ['userId', 'membershipId', 'action', ...targetKeys(r, a)]);
            return target(r, a, r.userId, r.membershipId);
          });
          if (
            targets[0].membershipId === targets[1].membershipId ||
            targets[0].userId === targets[1].userId
          )
            invalid();
          // Point visibility is checked for both before any version details; write rechecks all facts.
          const e = envelope(b),
            secret = password(b.password);
          for (const t of targets) {
            const v = await op(() =>
              composition.queries.member(h, {
                tenantId: tid,
                actorMembershipId: e.actorMembershipId,
                membershipId: t.membershipId,
                afterGrantId: null,
                consentPurpose: null,
              }),
            );
            await op(async () => {
              if (v.userId !== t.userId) refuse('TARGET_HIDDEN');
              if (
                v.revision !== t.expectedRevision ||
                v.authorizationVersion !== t.expectedAuthorizationVersion ||
                v.actorRevision !== e.expectedActorRevision ||
                v.actorAuthorizationVersion !== e.expectedActorAuthorizationVersion ||
                v.tenantRevision !== e.expectedTenantRevision
              )
                refuse('REQUEST_STALE', 'STALE_WRITE');
            });
          }
          return reply(
            200,
            outcome(
              await op(() =>
                members.execute(
                  h,
                  {
                    tenantId: tid,
                    ...e,
                    action: 'MEMBERSHIP_ATOMIC_TRANSFER',
                    targets,
                    idempotencyKey: key,
                    requestId: id,
                  },
                  secret,
                  transport,
                ),
              ),
            ),
          );
        }
        if (route === 'member' && action !== null) {
          if (typeof input !== 'object' || input === null || Array.isArray(input)) invalid();
          const b = input as Record<string, unknown>;
          record(b, [...envelopeKeys, ...targetKeys(b, action), 'password']);
          const mid = validated(() => membershipId(tenantMatch![3])),
            e = envelope(b);
          const visible = await op(() =>
            composition.queries.member(h, {
              tenantId: tid,
              actorMembershipId: e.actorMembershipId,
              membershipId: mid,
              afterGrantId: null,
              consentPurpose: null,
            }),
          );
          const t = target(b, action, visible.userId, mid),
            secret = password(b.password);
          await op(async () => {
            if (
              visible.revision !== t.expectedRevision ||
              visible.authorizationVersion !== t.expectedAuthorizationVersion ||
              visible.actorRevision !== e.expectedActorRevision ||
              visible.actorAuthorizationVersion !== e.expectedActorAuthorizationVersion ||
              visible.tenantRevision !== e.expectedTenantRevision
            )
              refuse('REQUEST_STALE', 'STALE_WRITE');
          });
          return reply(
            200,
            outcome(
              await op(() =>
                members.execute(
                  h,
                  { tenantId: tid, ...e, action, targets: [t], idempotencyKey: key, requestId: id },
                  secret,
                  transport,
                ),
              ),
            ),
          );
        }
        return fail(404, 'NOT_FOUND');
      } catch (error) {
        const extra: Record<string, string> = clear ? { 'Set-Cookie': clearCookie } : {};
        if (error instanceof ProtocolRefusal)
          return fail(
            error.status,
            error.status === 403 ? 'REQUEST_FORBIDDEN' : 'INVALID_REQUEST',
            extra,
          );
        if (error instanceof PublicRefusal) {
          if (error.status === 429) extra['Retry-After'] = String(policy.retryAfterSeconds);
          return fail(error.status, error.code, extra);
        }
        return fail(503, 'SERVICE_UNAVAILABLE', extra);
      } finally {
        if (admitted) active--;
        try {
          telemetry(
            Object.freeze({
              requestId: id,
              route,
              status,
              duration:
                performance.now() - started < 100
                  ? 'SHORT'
                  : performance.now() - started < 1000
                    ? 'MEDIUM'
                    : 'LONG',
            }),
          );
        } catch {
          /* Best effort operational records never reinterpret a committed mutation. */
        }
      }
    },
  });
}
