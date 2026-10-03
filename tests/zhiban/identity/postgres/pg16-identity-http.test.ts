import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createIdentityHttp,
  type HttpComposition,
} from '@/lib/zhiban/infrastructure/identity/http/adapter';
import { IdentitySafeQueryComposition } from '@/lib/zhiban/infrastructure/identity/composition/safe-queries';
import { IdentitySafeQueries } from '@/lib/zhiban/application/identity/use-cases/safe-queries';
import { OwnAuthentication } from '@/lib/zhiban/application/identity/use-cases/authentication';
import { MembershipCommands } from '@/lib/zhiban/application/identity/use-cases/memberships';
import { MemberCommands } from '@/lib/zhiban/infrastructure/identity/composition/member-commands';
import { MemberAdmissions } from '@/lib/zhiban/infrastructure/identity/composition/member-admissions';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { instant, selfScope } from '@/lib/zhiban/domain/identity';
import { digestBearer } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import {
  configured,
  prepareSchema,
  verifyPg16,
  resetDisposableIdentity,
  adminClient,
} from './pg16-harness';
import {
  fixture,
  rows,
  ids,
  password,
  policy,
  installAdmissionPolicy,
  cleanupPools,
  acknowledgeBlocked,
  type IdentityFixture,
} from './membership-composition-fixtures';
import { listen } from '../http/node-harness';

type Environment = Awaited<ReturnType<typeof fixture>>;
const protocol = {
  'X-Zhiban-Request': 'identity-v1',
  'X-Zhiban-Client-IP': '127.0.0.1',
  Origin: 'https://synthetic.example',
  'Content-Type': 'application/json',
};
const servers: Awaited<ReturnType<typeof listen>>[] = [];
async function browser(
  e: Environment,
  who: IdentityFixture = e.manager,
  tenantPool: TransactionPool = who.tenantPool,
) {
  const queries = new IdentitySafeQueries(
    new IdentitySafeQueryComposition(
      who.authentication,
      tenantPool,
      who.security,
      e.catalog,
      policy,
      e.store,
    ),
  );
  const root: HttpComposition = {
    security: who.authentication,
    application: new OwnAuthentication(who.authentication),
    queries,
    members: new MembershipCommands(
      new MemberCommands(tenantPool, who.security, e.catalog, ids, policy),
      new MemberAdmissions(tenantPool, who.security, e.catalog, ids, policy, e.store),
    ),
  };
  const server = await listen(
    createIdentityHttp(async () => root, {
      origin: 'https://synthetic.example',
      concurrentRequests: 8,
      bodyTimeoutMs: 1000,
      retryAfterSeconds: 30,
    }),
  );
  servers.push(server);
  const call = (
    path: string,
    method = 'GET',
    value?: unknown,
    extra: HeadersInit = {},
    authenticated = true,
  ) =>
    fetch(server.base + path, {
      method,
      headers: {
        ...protocol,
        // Anonymous requests omit Cookie; an empty header is malformed protocol input.
        ...(authenticated ? { Cookie: '__Host-zhiban_session=' + who.raw } : {}),
        ...Object.fromEntries(new Headers(extra)),
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  const proof = await (await call('csrf')).json();
  return {
    call,
    anonymous: (path: string, method = 'GET', value?: unknown, extra: HeadersInit = {}) =>
      call(path, method, value, extra, false),
    unsafe: (path: string, value: unknown, key = ids.nextCommandId()) =>
      call(path, 'POST', value, { 'X-Zhiban-CSRF': proof.csrfToken, 'Idempotency-Key': key }),
    server,
  };
}
function mutation(r: Awaited<ReturnType<Environment['request']>>) {
  const t = r.targets[0];
  return {
    actorMembershipId: r.actorMembershipId,
    expectedActorRevision: r.expectedActorRevision,
    expectedActorAuthorizationVersion: r.expectedActorAuthorizationVersion,
    expectedTenantRevision: r.expectedTenantRevision,
    expectedRevision: t.expectedRevision,
    expectedAuthorizationVersion: t.expectedAuthorizationVersion,
    password,
    ...(t.action === 'MEMBERSHIP_DISABLE' ? { reason: t.reason } : {}),
    ...(t.action === 'ROLE_REVOKE' ? { revokeGrantId: t.revokeGrantId } : {}),
    ...(['MEMBERSHIP_ACTIVATE', 'MEMBERSHIP_REJOIN'].includes(t.action)
      ? { admissionId: t.admissionId, consentId: t.consentId, grants: t.grants }
      : {}),
    ...(t.action === 'ROLE_REPLACE' ? { grants: t.grants } : {}),
    ...(t.action === 'ROLE_GRANT' ? { grant: t.grants[0] } : {}),
  };
}
const memberPath = (e: Environment, m: string, suffix = '') =>
  `tenants/${e.tenant}/memberships/${m}${suffix}`;
async function active(e: Environment) {
  const a = await e.admission(),
    invited = await e.invite(a),
    m = invited.effects[0].membershipId!,
    c = await e.consent(a, m),
    r = await e.request(m, 'MEMBERSHIP_ACTIVATE', {
      admissionId: a.admissionId,
      consentId: c,
      grants: [{ roleCode: 'STUDENT', scope: selfScope(), validUntil: null }],
    });
  return { a, m, c, r };
}
describe.skipIf(!configured).sequential('D8 real PG16 roles + actual HTTP adapter', () => {
  beforeAll(async () => expect(await verifyPg16()).toMatch(/^16\./));
  beforeEach(async () => {
    await prepareSchema();
    await installAdmissionPolicy();
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
    await cleanupPools();
  });
  afterAll(resetDisposableIdentity);
  it('D8-PG01 migration inventory unchanged and runtime query/HTTP schema accessible', async () => {
    const e = await fixture(),
      b = await browser(e);
    expect((await b.call('password')).status).toBe(200);
    expect(
      (await rows('SELECT version FROM zhiban_identity.schema_migrations ORDER BY version')).map(
        (r) => r.version,
      ),
    ).toEqual(Array.from({ length: 9 }, (_, i) => String(i + 1).padStart(4, '0')));
  });
  it('D8-PG02 own canonical revision is secret-free and belongs to authenticated User', async () => {
    const e = await fixture(),
      b = await browser(e);
    expect(await (await b.call('password')).json()).toEqual({ credentialRevision: '1' });
    expect((await b.call('password?userId=' + e.subject.id)).status).toBe(400);
  });
  it('D8-PG03 login actual native Argon2, cookie-only bearer and correct/wrong/unknown', async () => {
    const e = await fixture(),
      b = await browser(e);
    for (const [locator, p, expected] of [
      [e.manager.id, password, 200],
      [e.manager.id, 'wrong', 401],
      [ids.nextUserId(), password, 401],
    ] as const) {
      const r = await b.anonymous('login', 'POST', { userId: locator, password: p });
      expect(r.status).toBe(expected);
      if (expected === 200) {
        expect(Object.keys(await r.json()).sort()).toEqual([
          'absoluteExpiresAt',
          'idleExpiresAt',
          'userId',
        ]);
        expect(r.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
      } else expect((await r.json()).error.code).toBe('UNAUTHENTICATED');
    }
  });
  it('D8-PG04 manager point read executes scoped role/locks and whitelists current grants', async () => {
    const e = await fixture(),
      b = await browser(e);
    const r = await b.call(
      memberPath(e, e.managerMember.id) + `?actorMembershipId=${e.managerMember.id}`,
    );
    expect(r.status).toBe(200);
    const v = await r.json();
    expect(v.userId).toBe(e.manager.id);
    expect(v.actorRevision).toBe('1');
    expect(v.tenantRevision).toBe('1');
    expect(Object.keys(v.grants[0]).sort()).toEqual(['grantId', 'roleCode', 'scope', 'validUntil']);
    expect(v.consent).toBeNull();
  });
  it('D8-PG05 foreign/spoofed actor/member are normalized404, no cross-tenant versions', async () => {
    const e = await fixture(),
      b = await browser(e),
      foreign = await fixture();
    for (const [m, actor] of [
      [ids.nextMembershipId(), e.managerMember.id],
      [e.managerMember.id, e.secondAdmin.id],
      [foreign.managerMember.id, e.managerMember.id],
    ] as const) {
      const r = await b.call(memberPath(e, m) + `?actorMembershipId=${actor}`);
      expect(r.status).toBe(404);
      expect((await r.json()).error.code).toBe('NOT_FOUND');
    }
  });
  it('D8-PG06 spaces own-only bounded discovery without permission snapshot', async () => {
    const e = await fixture(),
      b = await browser(e);
    const r = await b.call('spaces?limit=1');
    expect(r.status).toBe(200);
    const v = await r.json();
    expect(v.spaces).toHaveLength(1);
    expect(Object.keys(v.spaces[0]).sort()).toEqual([
      'displayName',
      'membershipId',
      'tenantCode',
      'tenantId',
    ]);
    expect(v.spaces[0].membershipId).toBe(e.managerMember.id);
    expect(v.nextCursor).toBe(e.managerMember.id);
  });
  it('D8-PG07 subject PENDING consent context/record and manager current unconsumed metadata', async () => {
    const e = await fixture(),
      a = await e.admission(),
      invited = await e.invite(a),
      m = invited.effects[0].membershipId!,
      subject = await browser(e, e.subject),
      manager = await browser(e);
    const context = await subject.call(
      `tenants/${e.tenant}/consent-context?admissionId=${a.admissionId}`,
    );
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({
      membershipId: m,
      purpose: 'ACTIVATE',
      expectedMemberRevision: '1',
      expectedAuthorizationVersion: 0,
    });
    const consent = await subject.unsafe(`tenants/${e.tenant}/consents`, {
      admissionId: a.admissionId,
      expectedMemberRevision: '1',
      expectedAuthorizationVersion: 0,
    });
    expect(consent.status).toBe(200);
    const point = await manager.call(
      memberPath(e, m) + `?actorMembershipId=${e.managerMember.id}&consentPurpose=ACTIVATE`,
    );
    expect(point.status).toBe(200);
    const c = (await point.json()).consent;
    expect(c).toMatchObject({
      admissionId: a.admissionId,
      purpose: 'ACTIVATE',
      expectedMemberRevision: '1',
    });
    expect(typeof c.consentId).toBe('string');
  });
  it('D8-PG08 FIRST onboarding reference resolves approved manifest privately', async () => {
    const e = await fixture(),
      first = await e.first(),
      b = await browser(e, e.subject);
    const r = await b.call(
      `tenants/${first.tenant}/consent-context?onboardingRef=${first.manifest.approval_ref}`,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      membershipId: null,
      expectedMemberRevision: null,
      expectedAuthorizationVersion: null,
      purpose: 'FIRST_TENANT_ADMIN',
    });
  });
  it('D8-PG09 foreign source remains hidden without admitting caller approval', async () => {
    const e = await fixture(),
      a = await e.admission(),
      b = await browser(e);
    expect(
      (await b.call(`tenants/${e.tenant}/consent-context?admissionId=${a.admissionId}`)).status,
    ).toBe(404);
  });
  it('D8-PG10 valid fixed activation atomically consumes consent and audit; metadata no longer projects it', async () => {
    const e = await fixture(),
      a = await active(e),
      b = await browser(e),
      r = await b.unsafe(memberPath(e, a.m, '/activate'), mutation(a.r));
    expect(r.status).toBe(200);
    expect((await r.json()).effects[0]).toMatchObject({
      status: 'ACTIVE',
      revision: '2',
      authorizationVersion: 1,
    });
    const p = await b.call(
      memberPath(e, a.m) + `?actorMembershipId=${e.managerMember.id}&consentPurpose=ACTIVATE`,
    );
    expect((await p.json()).consent).toBeNull();
    expect(
      (
        await rows(
          'SELECT count(*)::int AS n FROM zhiban_identity.identity_member_approvals WHERE consent_id=$1',
          [a.c],
        )
      )[0].n,
    ).toBe(1);
  });
  it('D8-PG11 stale version returns409 after visible point read, no mutation/ledger', async () => {
    const e = await fixture(),
      b = await browser(e),
      r = await e.request(e.secondAdmin.id, 'ROLE_REVOKE', {
        revokeGrantId: e.secondAdmin.roleGrants[0].id,
      });
    const x = await b.unsafe(memberPath(e, e.secondAdmin.id, '/revoke-grant'), {
      ...mutation(r),
      expectedRevision: '2',
    });
    expect(x.status).toBe(409);
    expect(
      (
        await rows('SELECT revoked_at FROM zhiban_identity.role_grants WHERE grant_id=$1', [
          e.secondAdmin.roleGrants[0].id,
        ])
      )[0].revoked_at,
    ).toBeNull();
    expect(await rows('SELECT command_id FROM zhiban_identity.identity_tenant_commands')).toEqual(
      [],
    );
  });
  it('D8-PG12 password CAS increments epoch; prior cookie immediately rejected', async () => {
    const e = await fixture(),
      b = await browser(e);
    const r = await b.unsafe('password', {
      password,
      newPassword: 'Synthetic-http-replacement-secret!',
      expectedCredentialRevision: '1',
    });
    expect(r.status).toBe(204);
    const slot = (
      await rows(
        'SELECT repository_revision,security_epoch FROM zhiban_identity.credential_slots WHERE user_id=$1',
        [e.manager.id],
      )
    )[0];
    expect(slot).toEqual({ repository_revision: '2', security_epoch: '2' });
    expect((await b.call('me')).status).toBe(401);
  });
  it('D8-PG13 logout audit is secret-free and same transaction; stale logout204', async () => {
    const e = await fixture(),
      b = await browser(e);
    expect((await b.unsafe('logout', {})).status).toBe(204);
    expect((await b.unsafe('logout', {})).status).toBe(204);
    const records = await rows(
      "SELECT event_payload FROM zhiban_identity.audit_events WHERE event_type='SESSION_REVOKED'",
    );
    expect(records).toHaveLength(1);
    const encoded = JSON.stringify(records);
    expect(encoded.includes(e.manager.raw) || encoded.includes(digestBearer(e.manager.raw)!)).toBe(
      false,
    );
  });
  it('D8-PG14 logout-all reauth audit invalidates all Sessions, failed proof403', async () => {
    const e = await fixture(),
      b = await browser(e);
    expect((await b.unsafe('logout-all', { password: 'wrong' })).status).toBe(403);
    expect((await b.unsafe('logout-all', { password })).status).toBe(204);
    expect((await b.call('me')).status).toBe(401);
  });
  it('D8-PG15 actual screening true400; storage/crypto exceptions503, no secret errors', async () => {
    const e = await fixture(),
      b = await browser(e);
    const r = await b.unsafe('password', {
      password,
      newPassword: 'compromised'.repeat(2),
      expectedCredentialRevision: '1',
    });
    expect(r.status).toBe(400);
    const broken = createIdentityHttp(
      async () => {
        throw new IdentityPortError('UNAVAILABLE');
      },
      {
        origin: 'https://synthetic.example',
        concurrentRequests: 1,
        bodyTimeoutMs: 1000,
        retryAfterSeconds: 30,
      },
    );
    expect(
      (
        await broken.handle(
          new Request('https://synthetic.example/api/zhiban/identity/me', { headers: protocol }),
        )
      ).status,
    ).toBe(503);
  });
  it.each(['credential', 'logout', 'disable-restore', 'grant'] as const)(
    'D8-PG16 authentication→write %s race fails closed without target mutation',
    async (mode) => {
      const e = await fixture(),
        r = await e.request(e.secondAdmin.id, 'ROLE_REVOKE', {
          revokeGrantId: e.secondAdmin.roleGrants[0].id,
        });
      let entered!: () => void, resume!: () => void;
      const gate = new Promise<void>((r) => (entered = r)),
        released = new Promise<void>((r) => (resume = r));
      const security = new Proxy(e.manager.authentication, {
        get(o, k) {
          if (k === 'authenticate')
            return async (raw: string) => {
              const h = await o.authenticate(raw);
              entered();
              await released;
              return h;
            };
          const v = Reflect.get(o, k, o);
          return typeof v === 'function' ? v.bind(o) : v;
        },
      });
      const root: HttpComposition = {
        security,
        application: new OwnAuthentication(e.manager.authentication),
        members: new MembershipCommands(e.memberCommands(), e.admissions()),
        queries: new IdentitySafeQueries(
          new IdentitySafeQueryComposition(
            e.manager.authentication,
            e.manager.tenantPool,
            e.manager.security,
            e.catalog,
            policy,
            e.store,
          ),
        ),
      };
      const listener = await listen(
        createIdentityHttp(async () => root, {
          origin: 'https://synthetic.example',
          concurrentRequests: 8,
          bodyTimeoutMs: 1000,
          retryAfterSeconds: 30,
        }),
      );
      servers.push(listener);
      const proof = await e.manager.authentication.csrfToken(e.manager.handle);
      const writing = fetch(listener.base + memberPath(e, e.secondAdmin.id, '/revoke-grant'), {
        method: 'POST',
        headers: {
          ...protocol,
          Cookie: '__Host-zhiban_session=' + e.manager.raw,
          'X-Zhiban-CSRF': proof,
          'Idempotency-Key': ids.nextCommandId(),
        },
        body: JSON.stringify(mutation(r)),
      });
      try {
        await gate;
        if (mode === 'credential')
          await e.manager.credentials.revokePassword(
            e.manager.id,
            repositoryRevisionOne(),
            (await e.manager.credentials.verificationSnapshot(e.manager.id))!.credentialId,
            instant(Date.now()),
            {
              actor: { kind: 'SYSTEM' },
              reason: 'SECURITY_POLICY',
              requestId: ids.nextCommandId(),
            },
          );
        else if (mode === 'logout')
          await e.manager.authentication.logout(e.manager.handle, ids.nextCommandId());
        else if (mode === 'grant') {
          const revoke = await e.request(
            e.managerMember.id,
            'ROLE_REVOKE',
            { revokeGrantId: e.managerMember.roleGrants[0].id },
            e.operator,
            e.secondAdmin,
          );
          await e
            .memberCommands(e.operator)
            .execute(e.operator.handle, revoke, password, transport);
        } else {
          const user = await e.manager.users.findById(e.manager.id);
          if (!user) throw Error('Synthetic fixture missing.');
          const disabled = await e.manager.users.save(
            user.value.disable(instant(Date.now()), 'ADMIN_REQUEST'),
            user.revision,
          );
          await e.manager.users.save(
            disabled.value.restore(instant(Date.now())),
            disabled.revision,
          );
        }
      } finally {
        resume();
      }
      expect((await writing).status).toBe(mode === 'grant' ? 404 : 401);
      expect(
        (
          await rows('SELECT revoked_at FROM zhiban_identity.role_grants WHERE grant_id=$1', [
            e.secondAdmin.roleGrants[0].id,
          ])
        )[0].revoked_at,
      ).toBeNull();
    },
  );
  it('D8-PG17 HTTP concurrent two-admin removal uses independent connections and acknowledged Tenant lock', async () => {
    const e = await fixture(),
      first = await browser(e),
      second = await browser(e, e.operator);
    const r1 = await e.request(e.managerMember.id, 'ROLE_REVOKE', {
        revokeGrantId: e.managerMember.roleGrants[0].id,
      }),
      r2 = await e.request(
        e.secondAdmin.id,
        'ROLE_REVOKE',
        { revokeGrantId: e.secondAdmin.roleGrants[0].id },
        e.operator,
        e.secondAdmin,
      );
    const pids = [
        (await e.manager.tenantPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        (await e.operator.tenantPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
      ],
      gate = adminClient();
    await gate.connect();
    try {
      await gate.query('BEGIN');
      const blocker = (await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await gate.query(
        'SELECT tenant_id FROM zhiban_identity.tenants WHERE tenant_id=$1 FOR UPDATE',
        [e.tenant],
      );
      const pending = Promise.all([
        first.unsafe(memberPath(e, e.managerMember.id, '/revoke-grant'), mutation(r1)),
        second.unsafe(memberPath(e, e.secondAdmin.id, '/revoke-grant'), mutation(r2)),
      ]);
      await acknowledgeBlocked(pids, blocker);
      await gate.query('COMMIT');
      const result = await pending;
      expect(result.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        await rows(
          "SELECT g.grant_id FROM zhiban_identity.role_grants g JOIN zhiban_identity.memberships m USING(tenant_id,membership_id) WHERE g.tenant_id=$1 AND g.role_code='TENANT_ADMIN' AND m.status='ACTIVE' AND g.revoked_at IS NULL",
          [e.tenant],
        ),
      ).toHaveLength(1);
    } finally {
      await gate.query('ROLLBACK');
      await gate.end();
    }
  });
  it('D8-PG18 explicit lost-response confirmation uses fresh versions and produces no second state/audit/ledger', async () => {
    const e = await fixture(),
      b = await browser(e),
      r = await e.request(e.secondAdmin.id, 'ROLE_REVOKE', {
        revokeGrantId: e.secondAdmin.roleGrants[0].id,
      }),
      key = ids.nextCommandId(),
      path = memberPath(e, e.secondAdmin.id, '/revoke-grant');
    const applied = await b.unsafe(path, mutation(r), key);
    expect(applied.status).toBe(200);
    const original = await applied.json(),
      before = await businessCounts();
    expect((await b.unsafe(path, mutation(r), key)).status).toBe(409);
    const current = await e.request(e.secondAdmin.id, 'ROLE_REVOKE', {
      revokeGrantId: e.secondAdmin.roleGrants[0].id,
    });
    const confirmed = await b.unsafe(path, mutation(current), key);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual(original);
    const changed = { ...mutation(current), revokeGrantId: e.managerMember.roleGrants[0].id };
    expect((await b.unsafe(path, changed, key)).status).toBe(409);
    expect(await businessCounts()).toEqual(before);
  });
  it.each(['audit_events', 'identity_tenant_commands', 'identity_tenant_command_effects'])(
    'D8-PG19 HTTP %s failure rolls back all business state without automatic retry',
    async (table) => {
      const e = await fixture(),
        target = await e.seed(e.subject, 'STUDENT'),
        r = await e.request(target.id, 'ROLE_GRANT', {
          grants: [{ roleCode: 'STUDENT', scope: selfScope(), validUntil: null }],
        });
      let faults = 0,
        releases = 0;
      const injected: TransactionPool = {
        connect: async () => {
          const c = await e.manager.tenantPool.connect();
          return {
            release: () => {
              releases++;
              c.release();
            },
            query: ((sql: string, params: unknown[]) => {
              if (sql.includes('INSERT INTO zhiban_identity.' + table)) {
                faults++;
                throw Error('Synthetic write fault.');
              }
              return c.query(sql, params);
            }) as typeof c.query,
          };
        },
      };
      const b = await browser(e, e.manager, injected),
        before = await businessCounts();
      expect((await b.unsafe(memberPath(e, target.id, '/grant'), mutation(r))).status).toBe(503);
      expect(faults).toBe(1);
      expect(releases).toBeGreaterThan(0);
      expect(await businessCounts()).toEqual(before);
      expect(
        (
          await rows(
            'SELECT repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
            [target.id],
          )
        )[0],
      ).toEqual({ repository_revision: '1', authorization_version: '1' });
      expect(
        (
          await rows('SELECT grant_id FROM zhiban_identity.role_grants WHERE membership_id=$1', [
            target.id,
          ])
        ).length,
      ).toBe(1);
    },
  );
  it('D8-PG20 HTTP atomic two-target transfer preserves last administrator', async () => {
    const e = await fixture(),
      target = await e.seed(e.subject, 'STUDENT'),
      b = await browser(e);
    // First remove the second administrator; then transfer the only remaining grant atomically.
    const removeSecond = await e.request(e.secondAdmin.id, 'ROLE_REVOKE', {
      revokeGrantId: e.secondAdmin.roleGrants[0].id,
    });
    expect(
      (await b.unsafe(memberPath(e, e.secondAdmin.id, '/revoke-grant'), mutation(removeSecond)))
        .status,
    ).toBe(200);
    const outgoing = await e.request(e.managerMember.id, 'ROLE_REVOKE', {
        revokeGrantId: e.managerMember.roleGrants[0].id,
      }),
      incoming = await e.request(target.id, 'ROLE_GRANT', {
        grants: [{ roleCode: 'TENANT_ADMIN', scope: tenantScope(), validUntil: null }],
      });
    const r = await b.unsafe(`tenants/${e.tenant}/admin-transfer`, {
      actorMembershipId: outgoing.actorMembershipId,
      expectedActorRevision: outgoing.expectedActorRevision,
      expectedActorAuthorizationVersion: outgoing.expectedActorAuthorizationVersion,
      expectedTenantRevision: outgoing.expectedTenantRevision,
      password,
      targets: [
        {
          userId: e.manager.id,
          membershipId: e.managerMember.id,
          action: 'ROLE_REVOKE',
          expectedRevision: '1',
          expectedAuthorizationVersion: 1,
          revokeGrantId: e.managerMember.roleGrants[0].id,
        },
        {
          userId: e.subject.id,
          membershipId: target.id,
          action: 'ROLE_GRANT',
          expectedRevision: '1',
          expectedAuthorizationVersion: 1,
          grant: incoming.targets[0].grants[0],
        },
      ],
    });
    expect(r.status).toBe(200);
    const effects = (await r.json()).effects;
    expect(effects).toHaveLength(2);
    expect(
      (
        await rows(
          "SELECT membership_id FROM zhiban_identity.role_grants WHERE tenant_id=$1 AND role_code='TENANT_ADMIN' AND revoked_at IS NULL",
          [e.tenant],
        )
      ).map((row) => row.membership_id),
    ).toEqual([target.id]);
  });
  it('D8-PG21 shared budget refusal429, backend failure503, missing proxy503 without forwarding hints', async () => {
    const e = await fixture(),
      b = await browser(e);
    const gate = await rows(
      "SELECT global_limit FROM zhiban_identity.admission_policies WHERE purpose='LOGIN'",
    );
    const limit = Number(BigInt(gate[0].global_limit));
    await rows(
      "UPDATE zhiban_identity.admission_buckets SET used_count=$1 WHERE purpose='LOGIN' AND dimension='GLOBAL'",
      [limit.toString()],
    );
    const refused = await b.anonymous('login', 'POST', { userId: e.manager.id, password });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('Retry-After')).toBe('30');
    expect((await b.call('me', 'GET', undefined, { 'X-Zhiban-Client-IP': '' })).status).toBe(503);
  });
});
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { tenantScope } from '@/lib/zhiban/domain/identity';
import { transport } from './membership-composition-fixtures';
const repositoryRevisionOne = () => repositoryRevision('1');
async function businessCounts() {
  return rows(
    `SELECT (SELECT count(*)::int FROM zhiban_identity.audit_events) AS audits,(SELECT count(*)::int FROM zhiban_identity.role_grants) AS grants,(SELECT count(*)::int FROM zhiban_identity.identity_tenant_commands) AS commands,(SELECT count(*)::int FROM zhiban_identity.identity_tenant_command_effects) AS effects`,
  );
}
