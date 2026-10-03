import type { PoolClient } from 'pg';
import { Membership } from '@/lib/zhiban/domain/identity/membership';
import { RoleGrant } from '@/lib/zhiban/domain/identity/role-grant';
import {
  membershipId,
  roleGrantId,
  userId,
  type MembershipId,
  type UserId,
} from '@/lib/zhiban/domain/identity/ids';
import { roleCode } from '@/lib/zhiban/domain/identity/role';
import { parseScope } from '@/lib/zhiban/domain/identity/scope';
import { instant, type Instant } from '@/lib/zhiban/domain/identity/time';
import { lastAdminCounts, mayDelegate } from '@/lib/zhiban/domain/identity/policies/authorization';
import {
  authorizeRead,
  validateAuthorizationCatalog,
} from '@/lib/zhiban/application/identity/authorize';
import {
  AuthorizationRejected,
  isAuthorizationRejected,
} from '@/lib/zhiban/application/identity/authorization-error';
import {
  createIdentityAuditEvent,
  type IdentityAuditEventInput,
  type IdentityAuditGrantFact,
} from '@/lib/zhiban/application/identity/ports/audit';
import {
  requireTenantContext,
  tenantScopeContext,
  type TenantContext,
} from '@/lib/zhiban/application/identity/ports/tenant-context';
import type {
  AuthorizationCatalogPort,
  AuthorizationClock,
  AuthorizationMutationPort,
  AuthorizationMutationRequest,
  AuthorizationRead,
  AuthorizationStatePort,
  MembershipMutationIntent,
  NewAuthorizationGrant,
} from '@/lib/zhiban/application/identity/ports/authorization';
import type { Loaded } from '@/lib/zhiban/application/identity/ports/repository-types';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { tenantTransaction, type TransactionPool } from '../transactions';
import { atPortBoundary, expectedRevision, integrity } from './repository-support';
import { authorizationGlobals } from './authorization-records';
import { loadMembershipOnClient, saveMembershipOnClient } from './membership';

type Client = Pick<PoolClient, 'query' | 'release'>;
function reject(reason: ConstructorParameters<typeof AuthorizationRejected>[0]): never {
  throw new AuthorizationRejected(reason);
}

export class PostgresAuthorizationState implements AuthorizationStatePort {
  constructor(private readonly pool: TransactionPool) {}
  read(
    context: TenantContext,
    actorId: MembershipId,
    targetId: MembershipId,
  ): Promise<AuthorizationRead> {
    return atPortBoundary(async () => {
      const tenant = requireTenantContext(context),
        actor = membershipId(actorId),
        target = membershipId(targetId);
      return tenantTransaction(
        this.pool,
        tenantScopeContext(tenant),
        async (client) => {
          const globals = await authorizationGlobals(
            client,
            tenant,
            actor,
            [target],
            'READ_CONTEXT',
          );
          const a = await loadMembershipOnClient(client, tenant, actor),
            t = actor === target ? a : await loadMembershipOnClient(client, tenant, target);
          integrity(a !== null && t !== null);
          return { globals, actor: a, target: t };
        },
        'REPEATABLE_READ_READ_ONLY',
      );
    });
  }
}

function grantSpec(spec: NewAuthorizationGrant): NewAuthorizationGrant {
  return Object.freeze({
    id: roleGrantId(spec.id),
    roleCode: roleCode(spec.roleCode),
    scope: parseScope(spec.scope.type, spec.scope.scopeId),
    validUntil: spec.validUntil === null ? null : instant(spec.validUntil),
  });
}
function copyIntent(intent: MembershipMutationIntent): MembershipMutationIntent {
  switch (intent.action) {
    case 'MEMBERSHIP_DISABLE':
      return Object.freeze({ action: intent.action, reason: intent.reason });
    case 'MEMBERSHIP_LEAVE_ADMIN':
      return Object.freeze({ action: intent.action });
    case 'ROLE_REVOKE':
      return Object.freeze({ action: intent.action, grantId: roleGrantId(intent.grantId) });
    case 'ROLE_GRANT':
      return Object.freeze({
        action: intent.action,
        approvedGrant: grantSpec(intent.approvedGrant),
      });
    case 'MEMBERSHIP_ACTIVATE':
    case 'MEMBERSHIP_REJOIN':
    case 'ROLE_REPLACE':
      return Object.freeze({
        action: intent.action,
        approvedGrants: Object.freeze(intent.approvedGrants.map(grantSpec)),
      });
    case 'MEMBERSHIP_REACTIVATE':
      if (!['REPLACE_GRANTS', 'PRESERVE_EXISTING_VALID_GRANTS'].includes(intent.mode))
        reject('INVALID_FACTS');
      return Object.freeze({
        action: intent.action,
        mode: intent.mode,
        approvedGrants: Object.freeze(intent.approvedGrants.map(grantSpec)),
        approvedGrantIds: Object.freeze(intent.approvedGrantIds.map(roleGrantId)),
      });
    default:
      return reject('UNSUPPORTED_ACTION');
  }
}
function transition(before: Membership, intent: MembershipMutationIntent, now: Instant) {
  const command = { now, expectedAuthorizationVersion: before.authorizationVersion };
  const make = (spec: NewAuthorizationGrant) =>
    RoleGrant.create({ ...spec, createdAt: now, validFrom: now });
  let after: Membership;
  switch (intent.action) {
    case 'MEMBERSHIP_DISABLE':
      after = before.disable({ ...command, reason: intent.reason });
      break;
    case 'MEMBERSHIP_LEAVE_ADMIN':
      after = before.leave(command);
      break;
    case 'ROLE_REVOKE':
      after = before.revokeGrant({ ...command, grantId: intent.grantId });
      break;
    case 'ROLE_GRANT':
      after = before.grantRole({ ...command, approvedGrant: make(intent.approvedGrant) });
      break;
    case 'MEMBERSHIP_ACTIVATE':
      after = before.activatePending({
        ...command,
        approvedGrants: intent.approvedGrants.map(make),
      });
      break;
    case 'MEMBERSHIP_REJOIN':
      after = before.rejoin({ ...command, approvedGrants: intent.approvedGrants.map(make) });
      break;
    case 'ROLE_REPLACE':
      after = before.replaceGrants({ ...command, approvedGrants: intent.approvedGrants.map(make) });
      break;
    case 'MEMBERSHIP_REACTIVATE':
      after = before.reactivate(
        intent.mode === 'REPLACE_GRANTS'
          ? { ...command, mode: intent.mode, approvedGrants: intent.approvedGrants.map(make) }
          : { ...command, mode: intent.mode, approvedGrantIds: intent.approvedGrantIds },
      );
      break;
  }
  return after;
}
type WithoutAuditCommon<T> = T extends unknown
  ? Omit<T, 'occurredAt' | 'actor' | 'reason' | 'requestId'>
  : never;
function auditInput(
  before: Membership,
  after: Membership,
  intent: MembershipMutationIntent,
): WithoutAuditCommon<Extract<IdentityAuditEventInput, { membershipId: MembershipId }>> {
  const fact = (g: RoleGrant): IdentityAuditGrantFact => ({
    id: g.id,
    roleCode: g.roleCode,
    scope: g.scope,
    validFrom: g.validFrom,
    validUntil: g.validUntil,
  });
  const common = {
    membershipId: before.id,
    tenantId: before.tenantId,
    userId: before.userId,
    authorizationVersionBefore: before.authorizationVersion,
    authorizationVersionAfter: after.authorizationVersion,
  };
  switch (intent.action) {
    case 'MEMBERSHIP_DISABLE':
      return { ...common, type: 'MEMBERSHIP_DISABLED' };
    case 'MEMBERSHIP_LEAVE_ADMIN':
      return { ...common, type: 'MEMBERSHIP_LEFT' };
    case 'ROLE_GRANT':
      return { ...common, type: 'ROLE_GRANT_GRANTED', grant: fact(after.roleGrants.at(-1)!) };
    case 'ROLE_REVOKE':
      return {
        ...common,
        type: 'ROLE_GRANT_REVOKED',
        grant: fact(before.roleGrants.find((g) => g.id === intent.grantId)!),
      };
    default: {
      const approvedGrants = after.roleGrants
        .filter((g) => g.isEffectiveAt(after.updatedAt))
        .map(fact);
      const priorGrantIds = before.roleGrants.map((g) => g.id);
      if (intent.action === 'MEMBERSHIP_REACTIVATE')
        return {
          ...common,
          type: 'MEMBERSHIP_REACTIVATED',
          mode: intent.mode,
          priorGrantIds,
          approvedGrants,
        };
      return {
        ...common,
        type:
          intent.action === 'ROLE_REPLACE'
            ? 'ROLE_GRANTS_REPLACED'
            : intent.action === 'MEMBERSHIP_REJOIN'
              ? 'MEMBERSHIP_REJOINED'
              : 'MEMBERSHIP_ACTIVATED',
        priorGrantIds,
        approvedGrants,
      };
    }
  }
}
async function audit(client: Client, input: IdentityAuditEventInput): Promise<void> {
  const event = createIdentityAuditEvent(input);
  if (!('membershipId' in event)) reject('INVALID_FACTS');
  let payload: object;
  switch (event.type) {
    case 'ROLE_GRANT_GRANTED':
    case 'ROLE_GRANT_REVOKED':
      payload = { grant: event.grant };
      break;
    case 'MEMBERSHIP_DISABLED':
    case 'MEMBERSHIP_LEFT':
      payload = {};
      break;
    case 'MEMBERSHIP_REACTIVATED':
      payload = {
        mode: event.mode,
        priorGrantIds: event.priorGrantIds,
        approvedGrants: event.approvedGrants,
      };
      break;
    default:
      payload = { priorGrantIds: event.priorGrantIds, approvedGrants: event.approvedGrants };
  }
  const result = await client.query(
    `INSERT INTO zhiban_identity.audit_events (event_shape_version,event_type,event_scope,occurred_at,actor_type,actor_user_id,actor_service_code,request_id,reason,tenant_id,subject_user_id,subject_membership_id,authorization_version_before,authorization_version_after,event_payload)
     VALUES (1,$1,'TENANT',$2,'USER',$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      event.type,
      event.occurredAt.toString(),
      event.actor.kind === 'USER' ? event.actor.userId : null,
      event.requestId,
      event.reason,
      event.tenantId,
      event.userId,
      event.membershipId,
      event.authorizationVersionBefore.toString(),
      event.authorizationVersionAfter.toString(),
      JSON.stringify(payload),
    ],
  );
  integrity(result.command === 'INSERT' && result.rowCount === 1);
}

/** Tenant → User SHARE → sorted parent locks → fresh policy → CAS/history/audit. No auto retry. */
export class PostgresAuthorizationMutations implements AuthorizationMutationPort {
  constructor(
    private readonly pool: TransactionPool,
    private readonly catalog: AuthorizationCatalogPort,
    private readonly clock: AuthorizationClock,
  ) {}
  async execute(input: AuthorizationMutationRequest): Promise<readonly Loaded<Membership>[]> {
    try {
      if (
        !Array.isArray(input.operations) ||
        input.operations.length < 1 ||
        input.operations.length > 2
      )
        reject('INVALID_FACTS');
      const requestId = input.requestId,
        auditReason = input.auditReason;
      const operations = input.operations.map((op) => {
        const r = op.receipt,
          q = r.request;
        return Object.freeze({
          receipt: Object.freeze({
            ...r,
            decision: Object.freeze({ ...r.decision }),
            request: Object.freeze({
              actorUserId: userId(q.actorUserId),
              actorMembershipId: membershipId(q.actorMembershipId),
              targetMembershipId: membershipId(q.targetMembershipId),
              context: tenantScopeContext(requireTenantContext(q.context)),
              action: q.action,
              requestId: q.requestId,
            }),
          }),
          intent: copyIntent(op.intent),
        });
      });
      const first = operations[0].receipt.request,
        tenant = requireTenantContext(first.context);
      const targets = operations.map((op) => op.receipt.request.targetMembershipId);
      if (
        new Set(targets).size !== targets.length ||
        operations.some(
          (op) =>
            op.receipt.request.actorUserId !== first.actorUserId ||
            op.receipt.request.actorMembershipId !== first.actorMembershipId ||
            requireTenantContext(op.receipt.request.context) !== tenant ||
            op.intent.action !== op.receipt.request.action ||
            op.receipt.request.requestId !== requestId,
        )
      )
        reject('INVALID_FACTS');
      const catalog = await this.catalog.load();
      validateAuthorizationCatalog(catalog);
      return await tenantTransaction(this.pool, first.context, async (client) => {
        const globals = await authorizationGlobals(
          client,
          tenant,
          first.actorMembershipId,
          targets,
          'GUARD_MEMBERSHIP',
        );
        const loaded = new Map<MembershipId, Loaded<Membership>>();
        const lockIds = new Set([first.actorMembershipId, ...targets]);
        for (const id of [...lockIds].sort()) {
          const member = await loadMembershipOnClient(client, tenant, id, true);
          if (!member) reject('INVALID_FACTS');
          loaded.set(id, member);
        }
        const rosterResult = await client.query<{ membership_id: string }>(
          `SELECT DISTINCT m.membership_id FROM zhiban_identity.memberships AS m
           JOIN zhiban_identity.role_grants AS g ON g.tenant_id=m.tenant_id AND g.membership_id=m.membership_id
           WHERE m.tenant_id=$1 AND m.status='ACTIVE' AND g.role_code='TENANT_ADMIN' AND g.revoked_at IS NULL ORDER BY m.membership_id`,
          [tenant],
        );
        integrity(
          rosterResult.command === 'SELECT' && rosterResult.rowCount === rosterResult.rows.length,
        );
        const required = new Set([
          ...lockIds,
          ...rosterResult.rows.map((r) => membershipId(r.membership_id)),
        ]);
        integrity(
          required.size === globals.users.size &&
            [...required].every((id) => globals.users.has(id)),
        );
        for (const id of [...required].sort())
          if (!loaded.has(id)) {
            const member = await loadMembershipOnClient(client, tenant, id);
            if (!member) reject('INVALID_FACTS');
            loaded.set(id, member);
          }
        for (const [id, m] of loaded)
          integrity(
            m.value.userId === globals.users.get(id)?.userId && m.value.tenantId === tenant,
          );
        const actor = loaded.get(first.actorMembershipId)!;
        const now = instant(this.clock.now()); // AFTER lock waits and fresh reads.
        const candidates = new Map(loaded);
        for (const op of operations) {
          const r = op.receipt,
            q = r.request,
            target = loaded.get(q.targetMembershipId)!;
          const decision = authorizeRead(q, { globals, actor, target }, catalog, now);
          if (decision.decision === 'DENY') reject(decision.reason);
          expectedRevision(actor.revision, repositoryRevision(r.actorRevision));
          expectedRevision(target.revision, repositoryRevision(r.targetRevision));
          if (
            r.decision.decision !== 'ALLOW' ||
            r.decision.actorUserId !== q.actorUserId ||
            r.decision.tenantId !== tenant ||
            r.decision.membershipId !== actor.value.id ||
            r.decision.action !== q.action ||
            r.decision.resourceId !== target.value.id ||
            r.decision.authorizationVersion !== actor.value.authorizationVersion ||
            r.decision.grantId !== decision.grantId ||
            r.decision.catalogVersion !== catalog.snapshot.version ||
            r.decision.ruleVersion !== catalog.actionVersion ||
            r.delegationVersion !== catalog.delegationVersion ||
            r.catalogDigest !== catalog.contentDigest ||
            r.tenantRevision !== globals.tenantRevision ||
            r.actorUserRevision !== globals.users.get(actor.value.id)!.revision ||
            r.targetUserRevision !== globals.users.get(target.value.id)!.revision ||
            instant(r.decision.evaluatedAt) > now
          )
            reject('STALE_AUTHORIZATION');
          const after = transition(target.value, op.intent, now);
          const added = after.roleGrants.filter(
            (g) => !target.value.roleGrants.some((old) => old.id === g.id),
          );
          const preserve =
            op.intent.action === 'MEMBERSHIP_REACTIVATE' &&
            op.intent.mode === 'PRESERVE_EXISTING_VALID_GRANTS';
          const proposed = preserve ? after.effectiveGrantsAt(now) : added;
          const authority = actor.value.roleGrants.find((g) => g.id === decision.grantId)!;
          if (
            proposed.some(
              (grant) =>
                !mayDelegate({
                  actor: actor.value,
                  actorGrant: authority,
                  target: target.value,
                  targetUserStatus: globals.users.get(target.value.id)!.status,
                  proposed: grant,
                  catalog: catalog.snapshot,
                  now,
                  preserve,
                  resourceRelationshipVerified: false,
                }),
            )
          )
            reject('DELEGATION_DENIED');
          candidates.set(after.id, { value: after, revision: target.revision });
        }
        const states = new Map<UserId, 'ACTIVE' | 'DISABLED'>(
          [...globals.users.values()].map((u) => [u.userId, u.status]),
        );
        const roster = [...candidates.values()].map((m) => m.value);
        const count = lastAdminCounts(tenant, roster, states, catalog.snapshot, now);
        if (!count.governance || !count.operational) reject('LAST_ADMIN_REQUIRED');
        const saved: Loaded<Membership>[] = [];
        for (const op of operations) {
          const id = op.receipt.request.targetMembershipId,
            before = loaded.get(id)!,
            after = candidates.get(id)!.value;
          saved.push(await saveMembershipOnClient(client, first.context, after, before.revision));
          if (after !== before.value)
            await audit(client, {
              ...auditInput(before.value, after, op.intent),
              occurredAt: now,
              actor: { kind: 'USER', userId: first.actorUserId },
              requestId,
              reason: auditReason,
            } as IdentityAuditEventInput);
        }
        // Time is not frozen by row locks. Recheck authority and proposed operational roster just before commit.
        const finalNow = instant(this.clock.now());
        if (
          finalNow < now ||
          operations.some(
            (op) =>
              authorizeRead(
                op.receipt.request,
                { globals, actor, target: loaded.get(op.receipt.request.targetMembershipId)! },
                catalog,
                finalNow,
              ).decision !== 'ALLOW',
          ) ||
          lastAdminCounts(tenant, roster, states, catalog.snapshot, finalNow).operational === 0
        )
          reject('STALE_AUTHORIZATION');
        return Object.freeze(saved);
      });
    } catch (error) {
      if (isAuthorizationRejected(error)) throw error;
      return atPortBoundary(async () => {
        throw error;
      });
    }
  }
}
