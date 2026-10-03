import { createHash } from 'node:crypto';
import {
  Membership,
  membershipId,
  userId,
  tenantId,
  instant,
  tenantScope,
  permission,
} from '@/lib/zhiban/domain/identity';
import { evaluateAuthorization } from '@/lib/zhiban/domain/identity/policies/authorization';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import type {
  MembershipAdmissionPort,
  MembershipCompositionPolicy,
  PendingMembershipRequest,
  MembershipConsentRequest,
  MembershipCommandOutcome,
} from '@/lib/zhiban/application/identity/ports/membership-composition';
import type {
  AuthenticatedRequestHandle,
  AuthenticationTransport,
} from '@/lib/zhiban/application/identity/use-cases/authentication';
import { tenantTransaction, type TransactionPool } from '../postgres/transactions';
import {
  createMembershipOnClient,
  loadMembershipOnClient,
} from '../postgres/repositories/membership';
import { integrity, oneRow, expectedRevision } from '../postgres/repositories/repository-support';
import { ApprovedIdentityCatalog } from '../authorization/identity-catalog';
import { IdentityIds } from './ids';
import { MembershipSecurity } from './membership-security';
import {
  closedCompositionRecord,
  membershipCompositionPolicy,
  membershipBoundary,
} from './membership-intent';
import { controlManifest, type MembershipOperatorApprovalStore } from './control-approval';
import { appendMemberAudit } from './member-audit';
import { now, ref, changed, type Client } from './support';

const digest = (parts: readonly unknown[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const version = (n: unknown) => {
  integrity(typeof n === 'number' && Number.isSafeInteger(n) && n >= 0);
  return n;
};
interface Ledger {
  command_id: string;
  intent_digest: string;
  outcome_kind: 'APPLIED' | 'TRUE_NO_OP';
  completed_at: string;
}
async function prior(client: Client, tenant: string, actor: string, action: string, key: string) {
  return oneRow(
    await client.query<Ledger>(
      `SELECT command_id,intent_digest,outcome_kind,completed_at
    FROM zhiban_identity.identity_tenant_commands WHERE tenant_id=$1 AND actor_user_id=$2 AND action=$3 AND idempotency_key=$4`,
      [tenant, actor, action, key],
    ),
    'SELECT',
    true,
  );
}
async function capacity(client: Client, maximum: number) {
  const row = oneRow(
    await client.query<{ records: number }>(
      `SELECT count(*)::integer AS records FROM (
    SELECT 1 FROM zhiban_identity.identity_member_admissions UNION ALL SELECT 1 FROM zhiban_identity.identity_member_consents
    UNION ALL SELECT 1 FROM zhiban_identity.identity_member_approvals UNION ALL SELECT 1 FROM zhiban_identity.identity_member_approval_grants
    UNION ALL SELECT 1 FROM zhiban_identity.identity_tenant_commands UNION ALL SELECT 1 FROM zhiban_identity.identity_tenant_command_effects LIMIT $1) AS bounded_records`,
      [maximum + 1],
    ),
    'SELECT',
  );
  integrity(
    row !== null &&
      Number.isSafeInteger(row.records) &&
      row.records >= 0 &&
      row.records + 3 <= maximum,
  );
}
async function outcome(
  client: Client,
  tenant: string,
  command: string,
): Promise<MembershipCommandOutcome> {
  const row = oneRow(
    await client.query<{
      membership_id: string | null;
      target_user_id: string;
      after_revision: string | null;
      after_auth_version: string | null;
      after_status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'LEFT' | null;
    }>(
      `SELECT membership_id,target_user_id,after_revision,after_auth_version,after_status FROM zhiban_identity.identity_tenant_command_effects
     WHERE tenant_id=$1 AND command_id=$2 AND target_ordinal=0`,
      [tenant, command],
    ),
    'SELECT',
  );
  integrity(row !== null);
  integrity(
    Object.keys(row).sort().join(',') ===
      'after_auth_version,after_revision,after_status,membership_id,target_user_id' &&
      (row.membership_id === null
        ? row.after_revision === null &&
          row.after_auth_version === null &&
          row.after_status === null
        : row.after_revision !== null &&
          row.after_auth_version !== null &&
          ['PENDING', 'ACTIVE', 'DISABLED', 'LEFT'].includes(row.after_status ?? '')),
  );
  return Object.freeze({
    commandId: command,
    status: 'APPLIED',
    effects: Object.freeze([
      Object.freeze({
        userId: userId(row.target_user_id),
        membershipId: row.membership_id === null ? null : membershipId(row.membership_id),
        revision: row.after_revision === null ? null : repositoryRevision(row.after_revision),
        authorizationVersion:
          row.after_auth_version === null ? null : version(Number(BigInt(row.after_auth_version))),
        status: row.after_status,
      }),
    ]),
  });
}
async function command(
  client: Client,
  tenant: string,
  actor: string,
  member: string | null,
  action: string,
  key: string,
  hash: string,
  request: string,
  id: string,
  at: number,
) {
  changed(
    await client.query(
      `INSERT INTO zhiban_identity.identity_tenant_commands
    (command_id,tenant_id,actor_user_id,actor_membership_id,action,idempotency_key,intent_digest,request_id,completed_at,outcome_kind)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'APPLIED')`,
      [id, tenant, actor, member, action, key, hash, request, at.toString()],
    ),
    'INSERT',
  );
}

/** Qualification, self consent and manager approval are deliberately separate commands. */
export class MemberAdmissions implements MembershipAdmissionPort {
  private readonly policy: MembershipCompositionPolicy;
  constructor(
    private readonly pool: TransactionPool,
    private readonly security: MembershipSecurity,
    private readonly catalog: ApprovedIdentityCatalog,
    private readonly ids: IdentityIds,
    policy: MembershipCompositionPolicy,
    private readonly store: MembershipOperatorApprovalStore | null,
  ) {
    this.policy = membershipCompositionPolicy(policy);
  }
  invite(
    handle: AuthenticatedRequestHandle,
    input: PendingMembershipRequest,
    password: string,
    transport: AuthenticationTransport,
  ) {
    return membershipBoundary(async () => {
      closedCompositionRecord(input, [
        'tenantId',
        'actorMembershipId',
        'expectedActorRevision',
        'expectedActorAuthorizationVersion',
        'expectedTenantRevision',
        'admissionId',
        'idempotencyKey',
        'requestId',
      ]);
      const r = Object.freeze({ ...input });
      tenantId(r.tenantId);
      membershipId(r.actorMembershipId);
      userId(r.admissionId);
      repositoryRevision(r.expectedActorRevision);
      repositoryRevision(r.expectedTenantRevision);
      version(r.expectedActorAuthorizationVersion);
      ref(r.idempotencyKey);
      ref(r.requestId);
      const actor = this.security.actor(handle),
        context = tenantScopeContext(r.tenantId),
        catalog = await this.catalog.load();
      const hash = digest([
        'identity-pending-command-v1',
        r.tenantId,
        r.actorMembershipId,
        r.admissionId,
        catalog.contentDigest,
        'identity-v1',
      ]);
      const hint = await tenantTransaction(
        this.pool,
        context,
        async (client) => {
          const m = oneRow(
            await client.query<{ user_id: string }>(
              'SELECT user_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND membership_id=$2',
              [r.tenantId, r.actorMembershipId],
            ),
            'SELECT',
          );
          integrity(m !== null && m.user_id === actor);
          return prior(client, r.tenantId, actor, 'MEMBERSHIP_PENDING_CREATE', r.idempotencyKey);
        },
        'REPEATABLE_READ_READ_ONLY',
      );
      const id = hint?.command_id ?? this.ids.nextCommandId();
      userId(id);
      const binding = {
        requestId: r.requestId,
        commandId: id,
        action: 'MEMBERSHIP_PENDING_CREATE' as const,
        targetIds: [r.admissionId],
        intentDigest: hash,
      };
      const proof = await this.security.prepare(handle, binding, password, transport);
      return tenantTransaction(this.pool, context, async (client) => {
        const facts = await client.query<{
          fact_kind: string;
          tenant_id: string;
          tenant_status: string | null;
          tenant_revision: string | null;
          membership_id: string | null;
          user_id: string | null;
          user_status: string | null;
          user_revision: string | null;
        }>('SELECT * FROM zhiban_identity.identity_member_admission_state($1,$2,$3)', [
          r.tenantId,
          r.actorMembershipId,
          r.admissionId,
        ]);
        integrity(
          facts.command === 'SELECT' &&
            facts.rowCount === facts.rows.length &&
            facts.rows.length >= 3 &&
            facts.rows.length <= 258,
        );
        integrity(
          facts.rows.every(
            (f) =>
              Object.keys(f).sort().join(',') ===
                'fact_kind,membership_id,tenant_id,tenant_revision,tenant_status,user_id,user_revision,user_status' &&
              f.tenant_id === r.tenantId,
          ),
        );
        const headers = facts.rows.filter((f) => f.fact_kind === 'TENANT'),
          subjects = facts.rows.filter((f) => f.fact_kind === 'ADMISSION_USER');
        integrity(
          headers.length === 1 &&
            subjects.length === 1 &&
            headers[0].tenant_status === 'ACTIVE' &&
            headers[0].tenant_revision !== null,
        );
        expectedRevision(repositoryRevision(headers[0].tenant_revision), r.expectedTenantRevision);
        const subject = subjects[0];
        integrity(
          subject.user_id !== null &&
            subject.user_revision !== null &&
            subject.user_status === 'ACTIVE',
        );
        userId(subject.user_id);
        repositoryRevision(subject.user_revision);
        await this.security.assertSession(client, handle);
        await this.security.assertProof(client, handle, proof, binding);
        const manager = await loadMembershipOnClient(client, r.tenantId, r.actorMembershipId, true);
        integrity(
          manager !== null &&
            manager.value.userId === actor &&
            manager.value.authorizationVersion === r.expectedActorAuthorizationVersion,
        );
        expectedRevision(manager.revision, r.expectedActorRevision);
        const actorFact = facts.rows.find(
          (f) => f.fact_kind === 'USER' && f.membership_id === r.actorMembershipId,
        );
        integrity(
          actorFact !== undefined &&
            actorFact.user_id === actor &&
            actorFact.user_status === 'ACTIVE',
        );
        const source = oneRow(
          await client.query<{
            user_id: string;
            subject_user_revision: string;
            issued_at: string;
            expires_at: string;
            purpose: string;
            repository_revision: string;
            membership_id: string | null;
            command_id: string | null;
          }>(
            'SELECT user_id,subject_user_revision,issued_at,expires_at,purpose,repository_revision,membership_id,command_id FROM zhiban_identity.identity_member_admissions WHERE tenant_id=$1 AND admission_id=$2 FOR UPDATE',
            [r.tenantId, r.admissionId],
          ),
          'SELECT',
        );
        integrity(
          source !== null &&
            source.purpose === 'INVITE' &&
            source.user_id === subject.user_id &&
            source.subject_user_revision === subject.user_revision,
        );
        const check = (at: number) => {
          integrity(
            BigInt(source.issued_at) <= BigInt(at) && BigInt(at) < BigInt(source.expires_at),
          );
          integrity(
            evaluateAuthorization({
              actorUserId: actor,
              userStatus: 'ACTIVE',
              tenantId: r.tenantId,
              tenantStatus: 'ACTIVE',
              membership: manager.value,
              catalog: catalog.snapshot,
              rule: {
                action: 'MEMBERSHIP_PENDING_CREATE',
                version: 'identity-v1',
                requiredPermissions: [permission('membership:manage')],
                targetScopes: ['TENANT'],
                tenantCoversTarget: false,
              },
              resource: {
                tenantId: r.tenantId,
                resourceId: r.admissionId,
                scope: tenantScope(),
                subjectUserId: userId(subject.user_id!),
                subjectMembershipId: null,
                relationshipSatisfied: true,
                stateAllowed: true,
              },
              now: instant(at),
            }).decision === 'ALLOW',
          );
        };
        const at = await now(client);
        check(at);
        const old = await prior(
          client,
          r.tenantId,
          actor,
          'MEMBERSHIP_PENDING_CREATE',
          r.idempotencyKey,
        );
        if (old !== null) {
          integrity(
            old.command_id === id &&
              old.intent_digest === hash &&
              source.repository_revision === '2' &&
              source.command_id === id &&
              source.membership_id !== null,
          );
          const m = await loadMembershipOnClient(
            client,
            r.tenantId,
            membershipId(source.membership_id),
            true,
          );
          integrity(
            m !== null &&
              m.value.userId === subject.user_id &&
              m.value.status === 'PENDING' &&
              m.revision === '1' &&
              m.value.authorizationVersion === 0 &&
              m.value.roleGrants.length === 0,
          );
        } else {
          integrity(source.repository_revision === '1' && source.membership_id === null);
          await capacity(client, this.policy.tenantRecordCapacity);
          const member = Membership.create({
            id: this.ids.nextMembershipId(),
            userId: userId(subject.user_id),
            tenantId: r.tenantId,
            now: at,
          });
          const saved = await createMembershipOnClient(client, context, member);
          const event = await appendMemberAudit(client, {
            type: 'MEMBERSHIP_PENDING_CREATED',
            tenantId: r.tenantId,
            userId: member.userId,
            membershipId: member.id,
            authorizationVersionBefore: null,
            authorizationVersionAfter: 0,
            occurredAt: at,
            actor: { kind: 'USER', userId: actor },
            reason: 'ADMIN_REQUEST',
            requestId: r.requestId,
          });
          changed(
            await client.query(
              `UPDATE zhiban_identity.identity_member_admissions SET repository_revision=2,consumed_at=$1,membership_id=$2,command_id=$3,audit_event_id=$4
            WHERE tenant_id=$5 AND admission_id=$6 AND repository_revision=1`,
              [at.toString(), member.id, id, event, r.tenantId, r.admissionId],
            ),
            'UPDATE',
          );
          await command(
            client,
            r.tenantId,
            actor,
            r.actorMembershipId,
            'MEMBERSHIP_PENDING_CREATE',
            r.idempotencyKey,
            hash,
            r.requestId,
            id,
            at,
          );
          changed(
            await client.query(
              `INSERT INTO zhiban_identity.identity_tenant_command_effects
            (tenant_id,command_id,target_ordinal,target_user_id,membership_id,after_revision,after_auth_version,after_status,admission_id,audit_event_id)
            VALUES($1,$2,0,$3,$4,$5,0,'PENDING',$6,$7)`,
              [r.tenantId, id, member.userId, member.id, saved.revision, r.admissionId, event],
            ),
            'INSERT',
          );
        }
        await this.security.assertSession(client, handle);
        await this.security.assertProof(client, handle, proof, binding);
        const final = await now(client);
        integrity(final >= at);
        check(final);
        integrity((await this.catalog.load()).contentDigest === catalog.contentDigest);
        return outcome(client, r.tenantId, id);
      });
    });
  }
  consent(handle: AuthenticatedRequestHandle, input: MembershipConsentRequest) {
    return membershipBoundary(async () => {
      closedCompositionRecord(input, [
        'tenantId',
        'admissionId',
        'controlApprovalRef',
        'expectedMemberRevision',
        'expectedAuthorizationVersion',
        'idempotencyKey',
        'requestId',
      ]);
      const r = Object.freeze({ ...input }),
        actor = this.security.actor(handle);
      tenantId(r.tenantId);
      ref(r.idempotencyKey);
      ref(r.requestId);
      integrity((r.admissionId === null) !== (r.controlApprovalRef === null));
      if (r.admissionId !== null) userId(r.admissionId);
      if (r.expectedMemberRevision !== null) repositoryRevision(r.expectedMemberRevision);
      if (r.expectedAuthorizationVersion !== null) version(r.expectedAuthorizationVersion);
      const catalog = await this.catalog.load();
      let approval: string | null = null,
        manifestDigest: string | null = null;
      if (r.controlApprovalRef !== null) {
        ref(r.controlApprovalRef);
        integrity(this.store !== null);
        const loaded = await this.store.load(r.controlApprovalRef);
        integrity(loaded !== null);
        const manifest = controlManifest(
          loaded,
          this.policy.environmentRef,
          catalog.contentDigest,
          this.policy.sourceTtlMs,
        );
        integrity(
          manifest.approval_ref === r.controlApprovalRef &&
            manifest.purpose === 'FIRST_TENANT_ADMIN' &&
            manifest.target_user_id === actor &&
            manifest.tenant_id === r.tenantId,
        );
        approval = manifest.approval_id;
        manifestDigest = manifest.manifest_digest;
      }
      return tenantTransaction(this.pool, tenantScopeContext(r.tenantId), async (client) => {
        const state = await this.security.consentContext(
          client,
          handle,
          r.tenantId,
          r.admissionId,
          approval,
        );
        const session = await this.security.assertSession(client, handle);
        integrity(
          state.member_revision === r.expectedMemberRevision &&
            (state.auth_version === null ? null : Number(BigInt(state.auth_version))) ===
              r.expectedAuthorizationVersion,
        );
        if (state.membership_id !== null) {
          const m = await loadMembershipOnClient(
            client,
            r.tenantId,
            membershipId(state.membership_id),
            true,
          );
          integrity(
            m !== null &&
              m.value.userId === actor &&
              m.revision === r.expectedMemberRevision &&
              m.value.authorizationVersion === r.expectedAuthorizationVersion,
          );
        }
        const at = await now(client);
        integrity(BigInt(state.expires_at) > BigInt(at));
        const hash = digest([
          'identity-self-consent-v1',
          r.tenantId,
          actor,
          r.admissionId,
          approval,
          manifestDigest,
          state.purpose,
        ]);
        const old = await prior(
          client,
          r.tenantId,
          actor,
          'MEMBERSHIP_CONSENT_RECORD',
          r.idempotencyKey,
        );
        const id = old?.command_id ?? this.ids.nextCommandId();
        userId(id);
        let consentExpires: bigint;
        if (old !== null) {
          integrity(old.intent_digest === hash);
          const e = oneRow(
            await client.query<{
              consent_id: string;
              after_revision: string | null;
              after_auth_version: string | null;
              membership_id: string | null;
            }>(
              'SELECT consent_id,after_revision,after_auth_version,membership_id FROM zhiban_identity.identity_tenant_command_effects WHERE tenant_id=$1 AND command_id=$2 AND target_ordinal=0',
              [r.tenantId, id],
            ),
            'SELECT',
          );
          integrity(
            e !== null &&
              e.membership_id === state.membership_id &&
              e.after_revision === state.member_revision &&
              e.after_auth_version === state.auth_version,
          );
          const c = oneRow(
            await client.query<{ subject_user_revision: string; expires_at: string }>(
              'SELECT subject_user_revision,expires_at FROM zhiban_identity.identity_member_consents WHERE tenant_id=$1 AND consent_id=$2',
              [r.tenantId, e.consent_id],
            ),
            'SELECT',
          );
          integrity(
            c !== null &&
              c.subject_user_revision === session.userRevision &&
              BigInt(c.expires_at) > BigInt(at),
          );
          consentExpires = BigInt(c.expires_at);
        } else {
          await capacity(client, this.policy.tenantRecordCapacity);
          const consent = this.ids.nextCommandId();
          const expires =
            BigInt(at) + BigInt(this.policy.sourceTtlMs) < BigInt(state.expires_at)
              ? BigInt(at) + BigInt(this.policy.sourceTtlMs)
              : BigInt(state.expires_at);
          consentExpires = expires;
          const event = await appendMemberAudit(client, {
            type: 'MEMBERSHIP_CONSENT_RECORDED',
            tenantId: r.tenantId,
            userId: actor,
            membershipId: state.membership_id === null ? null : membershipId(state.membership_id),
            purpose: state.purpose as 'ACTIVATE' | 'REACTIVATE' | 'REJOIN' | 'FIRST_TENANT_ADMIN',
            authorizationVersionBefore: r.expectedAuthorizationVersion,
            authorizationVersionAfter: r.expectedAuthorizationVersion,
            occurredAt: at,
            actor: { kind: 'USER', userId: actor },
            reason: 'USER_REQUEST',
            requestId: r.requestId,
          });
          changed(
            await client.query(
              `INSERT INTO zhiban_identity.identity_member_consents
            (consent_id,tenant_id,user_id,subject_user_revision,purpose,admission_id,membership_id,control_approval_id,expected_member_revision,expected_auth_version,manifest_digest,issued_at,expires_at,request_id,command_id,audit_event_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
              [
                consent,
                r.tenantId,
                actor,
                session.userRevision,
                state.purpose,
                r.admissionId,
                state.membership_id,
                approval,
                state.member_revision,
                state.auth_version,
                manifestDigest ?? hash,
                at.toString(),
                expires.toString(),
                r.requestId,
                id,
                event,
              ],
            ),
            'INSERT',
          );
          await command(
            client,
            r.tenantId,
            actor,
            null,
            'MEMBERSHIP_CONSENT_RECORD',
            r.idempotencyKey,
            hash,
            r.requestId,
            id,
            at,
          );
          changed(
            await client.query(
              `INSERT INTO zhiban_identity.identity_tenant_command_effects
            (tenant_id,command_id,target_ordinal,target_user_id,membership_id,before_revision,after_revision,before_auth_version,after_auth_version,after_status,admission_id,consent_id,audit_event_id)
            VALUES($1,$2,0,$3,$4,$5,$5,$6,$6,$7,$8,$9,$10)`,
              [
                r.tenantId,
                id,
                actor,
                state.membership_id,
                state.member_revision,
                state.auth_version,
                state.membership_id === null
                  ? null
                  : state.purpose === 'ACTIVATE'
                    ? 'PENDING'
                    : state.purpose === 'REACTIVATE'
                      ? 'DISABLED'
                      : 'LEFT',
                r.admissionId,
                consent,
                event,
              ],
            ),
            'INSERT',
          );
        }
        const final = await this.security.consentContext(
          client,
          handle,
          r.tenantId,
          r.admissionId,
          approval,
        );
        await this.security.assertSession(client, handle);
        const finalAt = await now(client);
        integrity(
          final.member_revision === state.member_revision &&
            final.auth_version === state.auth_version &&
            finalAt >= at &&
            BigInt(finalAt) < consentExpires,
        );
        return outcome(client, r.tenantId, id);
      });
    });
  }
}
