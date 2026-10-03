import {
  Membership,
  instant,
  userId,
  tenantScope,
  type UserId,
  type MembershipId,
} from '@/lib/zhiban/domain/identity';
import {
  evaluateAuthorization,
  lastAdminCounts,
  mayDelegate,
} from '@/lib/zhiban/domain/identity/policies/authorization';
import {
  authorizeRead,
  identityActionRule,
  validateAuthorizationCatalog,
} from '@/lib/zhiban/application/identity/authorize';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import {
  repositoryRevision,
  type Loaded,
} from '@/lib/zhiban/application/identity/ports/repository-types';
import type {
  AuthorizationCatalog,
  AuthorizationRequest,
  GlobalAuthorizationFacts,
  MembershipMutationIntent,
} from '@/lib/zhiban/application/identity/ports/authorization';
import type {
  MembershipCompositionPort,
  MembershipCompositionPolicy,
  MembershipCommandRequest,
  MembershipCommandTarget,
  MembershipCommandOutcome,
} from '@/lib/zhiban/application/identity/ports/membership-composition';
import type {
  AuthenticatedRequestHandle,
  AuthenticationTransport,
} from '@/lib/zhiban/application/identity/use-cases/authentication';
import type { IdentityAuditEventInput } from '@/lib/zhiban/application/identity/ports/audit';
import { tenantTransaction, type TransactionPool } from '../postgres/transactions';
import {
  loadMembershipOnClient,
  saveMembershipOnClient,
} from '../postgres/repositories/membership';
import { authorizationGlobals } from '../postgres/repositories/authorization-records';
import { transition, auditInput } from '../postgres/repositories/authorization';
import { expectedRevision, integrity, oneRow } from '../postgres/repositories/repository-support';
import { ApprovedIdentityCatalog } from '../authorization/identity-catalog';
import { IdentityIds } from './ids';
import { MembershipSecurity, type MembershipProofIntent } from './membership-security';
import {
  membershipIntent,
  membershipCompositionPolicy,
  membershipBoundary,
} from './membership-intent';
import { appendMemberAudit } from './member-audit';
import { now, changed, type Client } from './support';
import { refuse } from './refusals';

interface Ledger {
  command_id: string;
  intent_digest: string;
  completed_at: string;
  outcome_kind: 'APPLIED' | 'TRUE_NO_OP';
}
const approvalActions = [
  'MEMBERSHIP_ACTIVATE',
  'MEMBERSHIP_REACTIVATE',
  'MEMBERSHIP_REJOIN',
  'ROLE_GRANT',
  'ROLE_REPLACE',
];
const consentActions = ['MEMBERSHIP_ACTIVATE', 'MEMBERSHIP_REACTIVATE', 'MEMBERSHIP_REJOIN'];
function immutableRequest(input: MembershipCommandRequest, digest: string) {
  membershipIntent(input, digest);
  return Object.freeze({
    ...input,
    targets: Object.freeze(
      input.targets.map((t) =>
        Object.freeze({
          ...t,
          grants: Object.freeze(
            t.grants.map((g) => Object.freeze({ ...g, scope: Object.freeze({ ...g.scope }) })),
          ),
          preserveGrantIds: Object.freeze([...t.preserveGrantIds]),
        }),
      ),
    ),
  });
}
function intentFor(target: MembershipCommandTarget, ids: IdentityIds): MembershipMutationIntent {
  const grants = target.grants.map((g) => ({
    ...g,
    id: ids.nextRoleGrantId(),
    validUntil: g.validUntil === null ? null : instant(g.validUntil),
  }));
  switch (target.action) {
    case 'MEMBERSHIP_DISABLE':
      return { action: target.action, reason: target.reason };
    case 'MEMBERSHIP_LEAVE_ADMIN':
      return { action: target.action };
    case 'ROLE_REVOKE':
      integrity(target.revokeGrantId !== null);
      return { action: target.action, grantId: target.revokeGrantId };
    case 'ROLE_GRANT':
      integrity(grants.length === 1);
      return { action: target.action, approvedGrant: grants[0] };
    case 'MEMBERSHIP_REACTIVATE':
      integrity(target.mode !== null);
      return {
        action: target.action,
        mode: target.mode,
        approvedGrants: grants,
        approvedGrantIds: target.preserveGrantIds,
      };
    default:
      return { action: target.action, approvedGrants: grants };
  }
}
function authority(
  q: AuthorizationRequest,
  globals: GlobalAuthorizationFacts,
  actor: Loaded<Membership>,
  target: Loaded<Membership>,
  catalog: AuthorizationCatalog,
  at: ReturnType<typeof instant>,
  confirmation: boolean,
) {
  if (!confirmation) return authorizeRead(q, { globals, actor, target }, catalog, at);
  const rule = identityActionRule(q.action),
    fact = globals.users.get(actor.value.id),
    subject = globals.users.get(target.value.id);
  integrity(
    rule !== null &&
      fact !== undefined &&
      subject !== undefined &&
      target.value.tenantId === globals.tenantId,
  );
  integrity(
    subject.status === 'ACTIVE' ||
      ['MEMBERSHIP_DISABLE', 'MEMBERSHIP_LEAVE_ADMIN', 'ROLE_REVOKE'].includes(q.action),
  );
  // A confirmed outcome is already in post-state; only its transition precondition is omitted.
  return evaluateAuthorization({
    actorUserId: q.actorUserId,
    userStatus: fact.status,
    tenantId: globals.tenantId,
    tenantStatus: globals.tenantStatus,
    membership: actor.value,
    catalog: catalog.snapshot,
    rule,
    resource: {
      tenantId: globals.tenantId,
      resourceId: target.value.id,
      scope: tenantScope(),
      subjectUserId: target.value.userId,
      subjectMembershipId: target.value.id,
      relationshipSatisfied: true,
      stateAllowed: true,
    },
    now: at,
  });
}
async function ledger(client: Client, request: MembershipCommandRequest, actor: UserId) {
  return oneRow(
    await client.query<Ledger>(
      `SELECT command_id,intent_digest,completed_at,outcome_kind
    FROM zhiban_identity.identity_tenant_commands WHERE tenant_id=$1 AND actor_user_id=$2 AND action=$3 AND idempotency_key=$4`,
      [request.tenantId, actor, request.action, request.idempotencyKey],
    ),
    'SELECT',
    true,
  );
}
async function capacity(client: Client, policy: MembershipCompositionPolicy, additions: number) {
  const row = oneRow(
    await client.query<{ records: number }>(
      `SELECT count(*)::integer AS records FROM (
    SELECT 1 FROM zhiban_identity.identity_member_admissions UNION ALL SELECT 1 FROM zhiban_identity.identity_member_consents
    UNION ALL SELECT 1 FROM zhiban_identity.identity_member_approvals UNION ALL SELECT 1 FROM zhiban_identity.identity_member_approval_grants
    UNION ALL SELECT 1 FROM zhiban_identity.identity_tenant_commands UNION ALL SELECT 1 FROM zhiban_identity.identity_tenant_command_effects
    LIMIT $1) AS bounded_records`,
      [policy.tenantRecordCapacity + 1],
    ),
    'SELECT',
  );
  integrity(
    row !== null &&
      Number.isSafeInteger(row.records) &&
      row.records >= 0 &&
      row.records + additions <= policy.tenantRecordCapacity,
  );
}
async function consent(
  client: Client,
  target: MembershipCommandTarget,
  globals: GlobalAuthorizationFacts,
  at: number,
  completedCommandId?: string,
) {
  integrity(target.consentId !== null && target.admissionId !== null);
  const row = oneRow(
    await client.query<{
      subject_user_revision: string;
      purpose: string;
      issued_at: string;
      expires_at: string;
      expected_member_revision: string;
      expected_auth_version: string;
      admission_id: string;
      user_id: string;
      membership_id: string;
    }>(
      `SELECT subject_user_revision,purpose,issued_at,expires_at,expected_member_revision,expected_auth_version,admission_id,user_id,membership_id
    FROM zhiban_identity.identity_member_consents WHERE tenant_id=$1 AND consent_id=$2`,
      [globals.tenantId, target.consentId],
    ),
    'SELECT',
  );
  integrity(
    row !== null &&
      row.user_id === target.userId &&
      row.membership_id === target.membershipId &&
      row.admission_id === target.admissionId &&
      row.subject_user_revision === globals.users.get(target.membershipId)?.revision &&
      row.expected_member_revision === target.expectedRevision &&
      row.expected_auth_version === target.expectedAuthorizationVersion.toString() &&
      row.purpose === target.action.replace('MEMBERSHIP_', '') &&
      BigInt(row.issued_at) <= BigInt(at) &&
      BigInt(row.expires_at) > BigInt(at),
  );
  const source = oneRow(
    await client.query<{
      user_id: string;
      membership_id: string;
      subject_user_revision: string;
      purpose: string;
      issued_at: string;
      expires_at: string;
      repository_revision: string;
      expected_member_revision: string | null;
      expected_auth_version: string | null;
      command_id: string | null;
    }>(
      `SELECT user_id,membership_id,subject_user_revision,purpose,issued_at,expires_at,repository_revision,expected_member_revision,expected_auth_version,command_id
    FROM zhiban_identity.identity_member_admissions WHERE tenant_id=$1 AND admission_id=$2 FOR UPDATE`,
      [globals.tenantId, target.admissionId],
    ),
    'SELECT',
  );
  integrity(
    source !== null &&
      source.user_id === target.userId &&
      source.membership_id === target.membershipId &&
      source.subject_user_revision === row.subject_user_revision &&
      BigInt(source.issued_at) <= BigInt(at) &&
      BigInt(source.expires_at) > BigInt(at) &&
      (target.action === 'MEMBERSHIP_ACTIVATE'
        ? source.purpose === 'INVITE' && source.repository_revision === '2'
        : source.purpose === row.purpose &&
          (completedCommandId === undefined
            ? source.repository_revision === '1'
            : source.repository_revision === '2' && source.command_id === completedCommandId) &&
          source.expected_member_revision === target.expectedRevision &&
          source.expected_auth_version === target.expectedAuthorizationVersion.toString()),
  );
}
/** Closed member-mutation facade. No independently committing repository or audit calls. */
export class MemberCommands implements MembershipCompositionPort {
  private readonly policy: MembershipCompositionPolicy;
  constructor(
    private readonly pool: TransactionPool,
    private readonly security: MembershipSecurity,
    private readonly catalog: ApprovedIdentityCatalog,
    private readonly ids: IdentityIds,
    policy: MembershipCompositionPolicy,
  ) {
    this.policy = membershipCompositionPolicy(policy);
  }
  execute(
    handle: AuthenticatedRequestHandle,
    input: MembershipCommandRequest,
    password: string,
    transport: AuthenticationTransport,
  ): Promise<MembershipCommandOutcome> {
    return membershipBoundary(async () => {
      const catalog = await this.catalog.load();
      validateAuthorizationCatalog(catalog);
      const request = immutableRequest(input, catalog.contentDigest),
        actorUser = this.security.actor(handle),
        context = tenantScopeContext(request.tenantId);
      const hint = await tenantTransaction(
        this.pool,
        context,
        async (client) => {
          const actor = oneRow(
            await client.query<{ user_id: string }>(
              'SELECT user_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND membership_id=$2',
              [request.tenantId, request.actorMembershipId],
            ),
            'SELECT',
          );
          integrity(actor !== null && actor.user_id === actorUser); // immutable identity check BEFORE any User lock
          return ledger(client, request, actorUser);
        },
        'REPEATABLE_READ_READ_ONLY',
      );
      const commandId = hint === null ? this.ids.nextCommandId() : userId(hint.command_id),
        digest = membershipIntent(request, catalog.contentDigest);
      const proofIntent: MembershipProofIntent = {
        requestId: request.requestId,
        commandId,
        action: request.action,
        targetIds: request.targets.map((t) => t.membershipId),
        intentDigest: digest,
      };
      const proof = await this.security.prepare(handle, proofIntent, password, transport);
      return tenantTransaction(this.pool, context, async (client) => {
        const globals = await authorizationGlobals(
          client,
          request.tenantId,
          request.actorMembershipId,
          request.targets.map((t) => t.membershipId),
          'GUARD_MEMBERSHIP',
        );
        await this.security.assertSession(client, handle);
        await this.security.assertProof(client, handle, proof, proofIntent);
        expectedRevision(globals.tenantRevision, request.expectedTenantRevision);
        const members = new Map<MembershipId, Loaded<Membership>>();
        for (const id of [
          ...new Set([request.actorMembershipId, ...request.targets.map((t) => t.membershipId)]),
        ].sort()) {
          const member = await loadMembershipOnClient(client, request.tenantId, id, true);
          integrity(member !== null);
          members.set(id, member);
        }
        const actor = members.get(request.actorMembershipId)!;
        integrity(
          actor.value.userId === actorUser &&
            actor.value.authorizationVersion === request.expectedActorAuthorizationVersion,
        );
        expectedRevision(actor.revision, request.expectedActorRevision);
        for (const t of request.targets) {
          const m = members.get(t.membershipId)!;
          integrity(
            m.value.userId === t.userId &&
              m.value.authorizationVersion === t.expectedAuthorizationVersion,
          );
          expectedRevision(m.revision, t.expectedRevision); // stale BEFORE ledger/no-op
        }
        for (const id of globals.users.keys())
          if (!members.has(id)) {
            const member = await loadMembershipOnClient(client, request.tenantId, id);
            integrity(member !== null);
            members.set(id, member);
          }
        const existing = await ledger(client, request, actorUser),
          at = await now(client);
        integrity(
          existing === null ||
            (existing.command_id === commandId &&
              /^[0-9a-f]{64}$/.test(existing.intent_digest) &&
              ['APPLIED', 'TRUE_NO_OP'].includes(existing.outcome_kind) &&
              /^(0|[1-9][0-9]*)$(?![\s\S])/.test(existing.completed_at) &&
              BigInt(existing.completed_at) <= BigInt(at)),
        );
        const candidates = new Map(members),
          outcomes: MembershipCommandOutcome['effects'][number][] = [];
        const queries: AuthorizationRequest[] = request.targets.map((t) => ({
          requestId: request.requestId,
          actorUserId: actorUser,
          actorMembershipId: actor.value.id,
          context,
          targetMembershipId: t.membershipId,
          action: t.action,
        }));
        const states = new Map<UserId, 'ACTIVE' | 'DISABLED'>(
          [...globals.users.values()].map((f) => [f.userId, f.status]),
        );
        if (existing !== null && existing.intent_digest !== digest) {
          for (const q of queries)
            if (
              authorizeRead(
                { ...q, action: 'MEMBERSHIP_READ' },
                { globals, actor, target: members.get(q.targetMembershipId!)! },
                catalog,
                at,
              ).decision !== 'ALLOW'
            )
              refuse('TARGET_HIDDEN', 'INTEGRITY_FAILURE');
          refuse('REQUEST_STALE', 'INTEGRITY_FAILURE');
        }
        const plans: {
          target: MembershipCommandTarget;
          before: Loaded<Membership>;
          after: Membership;
          intent: MembershipMutationIntent;
          authorityId: string;
        }[] = [];
        const confirmationConsents: MembershipCommandTarget[] = [];
        const confirmationDelegations: {
          target: Loaded<Membership>;
          authorityId: string;
          grants: Membership['roleGrants'];
        }[] = [];
        for (const [i, t] of request.targets.entries()) {
          const before = members.get(t.membershipId)!,
            decision = authority(
              queries[i],
              globals,
              actor,
              before,
              catalog,
              at,
              existing !== null,
            );
          if (decision.decision !== 'ALLOW') {
            const visible = authorizeRead(
              { ...queries[i], action: 'MEMBERSHIP_READ' },
              { globals, actor, target: before },
              catalog,
              at,
            );
            refuse(
              visible.decision === 'ALLOW' ? 'POLICY_DENIED' : 'TARGET_HIDDEN',
              'INTEGRITY_FAILURE',
            );
          }
          if (existing !== null) {
            const effect = oneRow(
              await client.query<{
                after_revision: string;
                after_auth_version: string;
                after_status: string;
                membership_id: string;
                target_user_id: string;
                approval_id: string | null;
              }>(
                `SELECT after_revision,after_auth_version,after_status,membership_id,target_user_id,approval_id FROM zhiban_identity.identity_tenant_command_effects
              WHERE tenant_id=$1 AND command_id=$2 AND target_ordinal=$3`,
                [request.tenantId, commandId, i],
              ),
              'SELECT',
            );
            integrity(
              effect !== null &&
                effect.membership_id === before.value.id &&
                effect.target_user_id === before.value.userId &&
                effect.after_revision === before.revision &&
                effect.after_auth_version === before.value.authorizationVersion.toString() &&
                effect.after_status === before.value.status,
            );
            if (effect.approval_id !== null) {
              const approval = oneRow(
                await client.query<{
                  expected_member_revision: string;
                  expected_auth_version: string;
                  consent_id: string | null;
                  intent_digest: string;
                  action: string;
                }>(
                  'SELECT expected_member_revision,expected_auth_version,consent_id,intent_digest,action FROM zhiban_identity.identity_member_approvals WHERE tenant_id=$1 AND approval_id=$2',
                  [request.tenantId, effect.approval_id],
                ),
                'SELECT',
              );
              integrity(
                approval !== null &&
                  approval.intent_digest === digest &&
                  approval.action === t.action &&
                  approval.consent_id === t.consentId,
              );
              const originalTarget = {
                ...t,
                expectedRevision: repositoryRevision(approval.expected_member_revision),
                expectedAuthorizationVersion: Number(BigInt(approval.expected_auth_version)),
              };
              if (consentActions.includes(t.action)) {
                await consent(client, originalTarget, globals, at, commandId);
                confirmationConsents.push(originalTarget);
              }
              const approved = await client.query<{
                grant_id: string;
                ordinal: number;
                grant_mode: string;
                role_code: string;
                scope_kind: string;
                scope_id: string | null;
                created_at: string;
                valid_from: string;
                valid_until: string | null;
              }>(
                `SELECT grant_id,ordinal,grant_mode,role_code,scope_kind,scope_id,created_at,valid_from,valid_until FROM zhiban_identity.identity_member_approval_grants WHERE tenant_id=$1 AND approval_id=$2 ORDER BY ordinal`,
                [request.tenantId, effect.approval_id],
              );
              integrity(
                approved.command === 'SELECT' &&
                  approved.rowCount === approved.rows.length &&
                  approved.rows.length <= 16,
              );
              const authorityGrant = actor.value.roleGrants.find((g) => g.id === decision.grantId)!;
              for (const [ordinal, row] of approved.rows.entries()) {
                const grant = before.value.roleGrants.find((g) => g.id === row.grant_id);
                integrity(
                  grant !== undefined &&
                    row.ordinal === ordinal &&
                    ['NEW', 'PRESERVE'].includes(row.grant_mode) &&
                    row.role_code === grant.roleCode &&
                    row.scope_kind === grant.scope.type &&
                    row.scope_id === grant.scope.scopeId &&
                    row.created_at === grant.createdAt.toString() &&
                    row.valid_from === grant.validFrom.toString() &&
                    row.valid_until === (grant.validUntil?.toString() ?? null) &&
                    mayDelegate({
                      actor: actor.value,
                      actorGrant: authorityGrant,
                      target: before.value,
                      targetUserStatus: globals.users.get(before.value.id)!.status,
                      proposed: grant,
                      catalog: catalog.snapshot,
                      now: at,
                      preserve: true,
                      resourceRelationshipVerified: false,
                    }),
                );
              }
              confirmationDelegations.push({
                target: before,
                authorityId: decision.grantId,
                grants: approved.rows.map(
                  (row) => before.value.roleGrants.find((g) => g.id === row.grant_id)!,
                ),
              });
            }
          } else {
            if (consentActions.includes(t.action)) await consent(client, t, globals, at);
            const intent = intentFor(t, this.ids),
              after = transition(before.value, intent, at),
              authorityGrant = actor.value.roleGrants.find((g) => g.id === decision.grantId)!;
            const preserve = t.mode === 'PRESERVE_EXISTING_VALID_GRANTS',
              grants = preserve
                ? after.effectiveGrantsAt(at)
                : after.roleGrants.filter(
                    (g) => !before.value.roleGrants.some((old) => old.id === g.id),
                  );
            integrity(grants.length <= 16);
            if (
              !grants.every((g) =>
                mayDelegate({
                  actor: actor.value,
                  actorGrant: authorityGrant,
                  target: before.value,
                  targetUserStatus: globals.users.get(before.value.id)!.status,
                  proposed: g,
                  catalog: catalog.snapshot,
                  now: at,
                  preserve,
                  resourceRelationshipVerified: false,
                }),
              )
            )
              refuse('POLICY_DENIED', 'INTEGRITY_FAILURE');
            plans.push({ target: t, before, after, intent, authorityId: decision.grantId });
            candidates.set(after.id, { value: after, revision: before.revision });
          }
        }
        const count = lastAdminCounts(
          request.tenantId,
          [...candidates.values()].map((m) => m.value),
          states,
          catalog.snapshot,
          at,
        );
        if (!(count.governance > 0 && count.operational > 0))
          refuse('POLICY_DENIED', 'INTEGRITY_FAILURE');
        if (existing === null) {
          await capacity(
            client,
            this.policy,
            1 +
              plans.length +
              plans.reduce(
                (n, p) =>
                  n +
                  (approvalActions.includes(p.target.action)
                    ? 1 +
                      (p.target.mode === 'PRESERVE_EXISTING_VALID_GRANTS'
                        ? p.after.effectiveGrantsAt(at).length
                        : p.after.roleGrants.filter(
                            (g) => !p.before.value.roleGrants.some((old) => old.id === g.id),
                          ).length)
                    : 0),
                0,
              ),
          );
          for (const [ordinal, p] of plans.entries()) {
            const saved = await saveMembershipOnClient(client, context, p.after, p.before.revision),
              mutation = p.after !== p.before.value;
            const eventId = mutation
              ? await appendMemberAudit(client, {
                  ...auditInput(p.before.value, p.after, p.intent),
                  occurredAt: at,
                  actor: { kind: 'USER', userId: actorUser },
                  requestId: request.requestId,
                  reason: p.target.reason,
                } as IdentityAuditEventInput)
              : null;
            const approvalId =
              mutation && approvalActions.includes(p.target.action)
                ? this.ids.nextCommandId()
                : null;
            if (approvalId !== null) {
              changed(
                await client.query(
                  `INSERT INTO zhiban_identity.identity_member_approvals
                (approval_id,tenant_id,command_id,target_ordinal,target_user_id,membership_id,action,mode,expected_member_revision,expected_auth_version,
                 approver_user_id,approver_membership_id,approver_member_revision,approver_auth_version,approver_user_revision,authority_grant_id,
                 tenant_revision,catalog_digest,action_version,delegation_version,intent_digest,consent_id,approved_at,consumed_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'identity-v1','identity-v1',$19,$20,$21,$21)`,
                  [
                    approvalId,
                    request.tenantId,
                    commandId,
                    ordinal,
                    p.target.userId,
                    p.target.membershipId,
                    p.target.action,
                    p.target.mode,
                    p.before.revision,
                    p.before.value.authorizationVersion.toString(),
                    actorUser,
                    actor.value.id,
                    actor.revision,
                    actor.value.authorizationVersion.toString(),
                    globals.users.get(actor.value.id)!.revision,
                    p.authorityId,
                    globals.tenantRevision,
                    catalog.contentDigest,
                    digest,
                    p.target.consentId,
                    at.toString(),
                  ],
                ),
                'INSERT',
              );
              const preserved = p.target.mode === 'PRESERVE_EXISTING_VALID_GRANTS',
                approved = preserved
                  ? p.after.effectiveGrantsAt(at)
                  : p.after.roleGrants.filter(
                      (g) => !p.before.value.roleGrants.some((old) => old.id === g.id),
                    );
              for (const [index, g] of approved.entries())
                changed(
                  await client.query(
                    `INSERT INTO zhiban_identity.identity_member_approval_grants
                (tenant_id,approval_id,ordinal,grant_id,grant_mode,role_code,scope_kind,scope_id,created_at,valid_from,valid_until)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                    [
                      request.tenantId,
                      approvalId,
                      index,
                      g.id,
                      preserved ? 'PRESERVE' : 'NEW',
                      g.roleCode,
                      g.scope.type,
                      g.scope.scopeId,
                      g.createdAt.toString(),
                      g.validFrom.toString(),
                      g.validUntil?.toString() ?? null,
                    ],
                  ),
                  'INSERT',
                );
            }
            if (
              mutation &&
              ['MEMBERSHIP_REACTIVATE', 'MEMBERSHIP_REJOIN'].includes(p.target.action)
            )
              changed(
                await client.query(
                  `UPDATE zhiban_identity.identity_member_admissions SET repository_revision=2,consumed_at=$1,membership_id=$2,command_id=$3,audit_event_id=$4
               WHERE tenant_id=$5 AND admission_id=$6 AND repository_revision=1`,
                  [
                    at.toString(),
                    p.after.id,
                    commandId,
                    eventId,
                    request.tenantId,
                    p.target.admissionId,
                  ],
                ),
                'UPDATE',
              );
            changed(
              await client.query(
                `INSERT INTO zhiban_identity.identity_tenant_command_effects
              (tenant_id,command_id,target_ordinal,target_user_id,membership_id,before_revision,after_revision,before_auth_version,after_auth_version,after_status,admission_id,consent_id,approval_id,audit_event_id)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                [
                  request.tenantId,
                  commandId,
                  ordinal,
                  p.after.userId,
                  p.after.id,
                  p.before.revision,
                  saved.revision,
                  p.before.value.authorizationVersion.toString(),
                  p.after.authorizationVersion.toString(),
                  p.after.status,
                  p.target.admissionId,
                  p.target.consentId,
                  approvalId,
                  eventId,
                ],
              ),
              'INSERT',
            );
            outcomes.push(
              Object.freeze({
                userId: p.after.userId,
                membershipId: p.after.id,
                revision: saved.revision,
                authorizationVersion: p.after.authorizationVersion,
                status: p.after.status,
              }),
            );
          }
          changed(
            await client.query(
              `INSERT INTO zhiban_identity.identity_tenant_commands
            (command_id,tenant_id,actor_user_id,actor_membership_id,action,idempotency_key,intent_digest,request_id,completed_at,outcome_kind)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [
                commandId,
                request.tenantId,
                actorUser,
                actor.value.id,
                request.action,
                request.idempotencyKey,
                digest,
                request.requestId,
                at.toString(),
                plans.some((p) => p.after !== p.before.value) ? 'APPLIED' : 'TRUE_NO_OP',
              ],
            ),
            'INSERT',
          );
        } else
          for (const t of request.targets) {
            const m = members.get(t.membershipId)!;
            outcomes.push(
              Object.freeze({
                userId: m.value.userId,
                membershipId: m.value.id,
                revision: m.revision,
                authorizationVersion: m.value.authorizationVersion,
                status: m.value.status,
              }),
            );
          }
        await this.security.assertSession(client, handle);
        await this.security.assertProof(client, handle, proof, proofIntent);
        const finalAt = await now(client),
          finalCatalog = await this.catalog.load();
        validateAuthorizationCatalog(finalCatalog);
        integrity(
          finalAt >= at &&
            finalCatalog.contentDigest === catalog.contentDigest &&
            queries.every(
              (q, i) =>
                authority(
                  q,
                  globals,
                  actor,
                  members.get(request.targets[i].membershipId)!,
                  catalog,
                  finalAt,
                  existing !== null,
                ).decision === 'ALLOW',
            ),
        );
        const finalCount = lastAdminCounts(
          request.tenantId,
          [...candidates.values()].map((m) => m.value),
          states,
          catalog.snapshot,
          finalAt,
        );
        integrity(finalCount.governance > 0 && finalCount.operational > 0);
        for (const p of plans) {
          const authorityGrant = actor.value.roleGrants.find((g) => g.id === p.authorityId)!;
          const preserve = p.target.mode === 'PRESERVE_EXISTING_VALID_GRANTS';
          const approved = preserve
            ? p.after.effectiveGrantsAt(at)
            : p.after.roleGrants.filter(
                (g) => !p.before.value.roleGrants.some((old) => old.id === g.id),
              );
          integrity(
            approved.every((g) =>
              mayDelegate({
                actor: actor.value,
                actorGrant: authorityGrant,
                target: p.after,
                targetUserStatus: globals.users.get(p.before.value.id)!.status,
                proposed: g,
                catalog: catalog.snapshot,
                now: finalAt,
                preserve: true,
                resourceRelationshipVerified: false,
              }),
            ),
          );
        }
        if (existing === null)
          for (const p of plans)
            if (consentActions.includes(p.target.action))
              await consent(client, p.target, globals, finalAt, commandId);
        for (const target of confirmationConsents)
          await consent(client, target, globals, finalAt, commandId);
        for (const confirmed of confirmationDelegations) {
          const authorityGrant = actor.value.roleGrants.find(
            (g) => g.id === confirmed.authorityId,
          )!;
          integrity(
            confirmed.grants.every((g) =>
              mayDelegate({
                actor: actor.value,
                actorGrant: authorityGrant,
                target: confirmed.target.value,
                targetUserStatus: globals.users.get(confirmed.target.value.id)!.status,
                proposed: g,
                catalog: catalog.snapshot,
                now: finalAt,
                preserve: true,
                resourceRelationshipVerified: false,
              }),
            ),
          );
        }
        return Object.freeze({
          commandId,
          status:
            existing?.outcome_kind ??
            (plans.some((p) => p.after !== p.before.value) ? 'APPLIED' : 'TRUE_NO_OP'),
          effects: Object.freeze(outcomes),
        });
      });
    });
  }
}
