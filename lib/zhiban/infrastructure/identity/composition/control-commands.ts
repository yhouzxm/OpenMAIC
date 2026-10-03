import {
  User,
  Tenant,
  instant,
  userId,
  tenantId,
  membershipId,
  roleGrantId,
  tenantScope,
} from '@/lib/zhiban/domain/identity';
import { createIdentityAuditEvent } from '@/lib/zhiban/application/identity/ports/audit';
import type {
  ControlCompositionRequest,
  ControlCompositionOutcome,
  MembershipCompositionPolicy,
} from '@/lib/zhiban/application/identity/ports/membership-composition';
import type {
  AuthenticatedRequestHandle,
  AuthenticationTransport,
} from '@/lib/zhiban/application/identity/use-cases/authentication';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { expectedRevision, integrity, oneRow } from '../postgres/repositories/repository-support';
import { loadUserOnClient, writeUserOnClient } from '../postgres/repositories/user';
import { loadTenantOnClient, writeTenantOnClient } from '../postgres/repositories/tenant';
import type { TransactionPool } from '../postgres/transactions';
import { ApprovedIdentityCatalog } from '../authorization/identity-catalog';
import { MembershipSecurity, type MembershipProofIntent } from './membership-security';
import {
  membershipCompositionPolicy,
  closedCompositionRecord,
  membershipBoundary,
} from './membership-intent';
import {
  controlManifest,
  controlIntentDigest,
  controlApprovalFields,
  type ControlApprovalManifest,
  type MembershipOperatorApprovalStore,
} from './control-approval';
import { appendMemberAudit } from './member-audit';
import { IdentityIds } from './ids';
import { changed, now, ref, run, type Client } from './support';

async function appendControlAudit(
  client: Client,
  manifest: ControlApprovalManifest,
  subject: string,
  at: number,
  requestId: string,
) {
  integrity(
    [
      'USER_CREATE',
      'USER_DISABLE',
      'USER_RESTORE',
      'TENANT_CREATE',
      'TENANT_DISABLE',
      'TENANT_RESTORE',
    ].includes(manifest.purpose),
  );
  const type = `${manifest.purpose}D` as
    | 'USER_CREATED'
    | 'USER_DISABLED'
    | 'USER_RESTORED'
    | 'TENANT_CREATED'
    | 'TENANT_DISABLED'
    | 'TENANT_RESTORED';
  const base = {
    type,
    occurredAt: instant(at),
    actor: { kind: 'USER' as const, userId: userId(manifest.operator_user_id) },
    reason: manifest.reason,
    requestId,
  };
  createIdentityAuditEvent(
    type.startsWith('USER_')
      ? {
          ...base,
          type: type as 'USER_CREATED' | 'USER_DISABLED' | 'USER_RESTORED',
          userId: userId(subject),
        }
      : {
          ...base,
          type: type as 'TENANT_CREATED' | 'TENANT_DISABLED' | 'TENANT_RESTORED',
          tenantId: tenantId(subject),
        },
  );
  const seq = oneRow(
    await client.query<{ id: string }>(
      "SELECT nextval('zhiban_identity.audit_events_event_id_seq'::regclass)::text AS id",
    ),
    'SELECT',
  );
  integrity(seq !== null);
  const id = repositoryRevision(seq.id);
  changed(
    await client.query(
      `INSERT INTO zhiban_identity.audit_events
    (event_id,event_shape_version,event_type,event_scope,occurred_at,actor_type,actor_user_id,actor_service_code,request_id,reason,tenant_id,subject_user_id,subject_membership_id,authorization_version_before,authorization_version_after,event_payload)
    OVERRIDING SYSTEM VALUE VALUES ($1,1,$2,'GLOBAL',$3,'USER',$4,NULL,$5,$6,$7,$8,NULL,NULL,NULL,'{}'::jsonb)`,
      [
        id,
        type,
        at.toString(),
        manifest.operator_user_id,
        requestId,
        manifest.reason,
        type.startsWith('TENANT_') ? subject : null,
        type.startsWith('USER_') ? subject : null,
      ],
    ),
    'INSERT',
  );
  return id;
}
function proofIntent(manifest: ControlApprovalManifest, requestId: string): MembershipProofIntent {
  const targets = [
    manifest.target_user_id ?? manifest.planned_user_id,
    manifest.tenant_id ?? manifest.planned_tenant_id,
  ].filter((v): v is string => v !== null);
  integrity(targets.length > 0);
  return {
    requestId,
    commandId: manifest.command_id,
    action: manifest.purpose as MembershipProofIntent['action'],
    targetIds: targets,
    intentDigest: controlIntentDigest(manifest),
  };
}
/** Independent approved manifest, authentic Session and KDF proof are three separate facts. */
export class ControlCommands {
  private readonly policy: MembershipCompositionPolicy;
  constructor(
    private readonly pool: TransactionPool,
    private readonly security: MembershipSecurity,
    private readonly catalog: ApprovedIdentityCatalog,
    private readonly store: MembershipOperatorApprovalStore,
    private readonly ids: IdentityIds,
    policy: MembershipCompositionPolicy,
  ) {
    this.policy = membershipCompositionPolicy(policy);
  }
  private async manifest(refValue: string, handle: AuthenticatedRequestHandle) {
    ref(refValue);
    const catalog = await this.catalog.load(),
      input = await this.store.load(refValue);
    integrity(input !== null);
    const manifest = controlManifest(
      input,
      this.policy.environmentRef,
      catalog.contentDigest,
      this.policy.sourceTtlMs,
    );
    integrity(
      manifest.approval_ref === refValue &&
        manifest.operator_user_id === this.security.actor(handle),
    );
    return manifest;
  }
  private async locks(client: Client, manifest: ControlApprovalManifest, confirmationHint = false) {
    const tenantLocator = manifest.tenant_id ?? manifest.planned_tenant_id;
    const tenant = tenantLocator === null ? null : tenantId(tenantLocator);
    if (tenant !== null) {
      const target = await loadTenantOnClient(client, tenant, true);
      integrity(target !== null || manifest.purpose === 'TENANT_CREATE');
      if (manifest.purpose === 'TENANT_RESTORE')
        await client.query('SELECT zhiban_identity.identity_tenant_restore_guard($1,$2)', [
          tenant,
          manifest.operator_user_id,
        ]);
      if (manifest.purpose === 'FIRST_TENANT_ADMIN' && !confirmationHint) {
        await client.query('SELECT zhiban_identity.identity_first_tenant_admin_lock($1,$2)', [
          tenant,
          manifest.approval_id,
        ]);
      }
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    }
    // Direct target UPDATE, never SHARE then upgrade; no arbitrary Tenant lock for User mutation.
    const users = [
      ...new Set([
        manifest.operator_user_id,
        ...((manifest.target_user_id ?? manifest.planned_user_id) === null
          ? []
          : [manifest.target_user_id ?? manifest.planned_user_id!]),
      ]),
    ].sort();
    for (const id of users) {
      const lock =
        ['USER_DISABLE', 'USER_RESTORE'].includes(manifest.purpose) &&
        id === manifest.target_user_id
          ? 'UPDATE'
          : 'SHARE';
      const loaded = await loadUserOnClient(client, userId(id), lock);
      integrity(
        loaded !== null || (manifest.purpose === 'USER_CREATE' && id === manifest.planned_user_id),
      );
      if (id === manifest.operator_user_id)
        integrity(
          loaded !== null &&
            loaded.value.status === 'ACTIVE' &&
            loaded.revision === manifest.expected_operator_user_revision,
        );
    }
  }
  private async qualify(client: Client, manifest: ControlApprovalManifest, at: number) {
    const grant = oneRow(
      await client.query<{
        user_id: string;
        repository_revision: string;
        valid_from: string;
        valid_until: string | null;
        revoked_at: string | null;
      }>(
        'SELECT user_id,repository_revision,valid_from,valid_until,revoked_at FROM zhiban_identity.system_admin_grants WHERE grant_id=$1 FOR SHARE',
        [manifest.system_admin_grant_id],
      ),
      'SELECT',
    );
    integrity(
      grant !== null &&
        grant.user_id === manifest.operator_user_id &&
        grant.repository_revision === manifest.expected_admin_grant_revision &&
        grant.revoked_at === null &&
        BigInt(grant.valid_from) <= BigInt(at) &&
        (grant.valid_until === null || BigInt(grant.valid_until) > BigInt(at)) &&
        BigInt(manifest.issued_at) <= BigInt(at) &&
        BigInt(manifest.expires_at) > BigInt(at),
    );
    const catalog = await this.catalog.load();
    integrity(
      catalog.contentDigest === manifest.catalog_digest &&
        catalog.actionVersion === manifest.action_version &&
        catalog.delegationVersion === manifest.delegation_version,
    );
  }
  private async capacity(client: Client, addition: number) {
    const row = oneRow(
      await client.query<{ records: number }>(
        `SELECT count(*)::integer AS records FROM (
      SELECT 1 FROM zhiban_identity.identity_control_approvals UNION ALL SELECT 1 FROM zhiban_identity.identity_control_commands
      UNION ALL SELECT 1 FROM zhiban_identity.identity_control_command_effects UNION ALL SELECT 1 FROM zhiban_identity.identity_tenant_onboarding LIMIT $1) AS bounded_records`,
        [this.policy.controlRecordCapacity + 1],
      ),
      'SELECT',
    );
    integrity(
      row !== null &&
        Number.isSafeInteger(row.records) &&
        row.records >= 0 &&
        row.records + addition <= this.policy.controlRecordCapacity,
    );
  }
  registerApproval(
    handle: AuthenticatedRequestHandle,
    approvalRef: string,
    password: string,
    transport: AuthenticationTransport,
    requestId: string,
  ) {
    return membershipBoundary(async () => {
      ref(requestId);
      const manifest = await this.manifest(approvalRef, handle),
        intent = proofIntent(manifest, requestId);
      const proof = await this.security.prepare(handle, intent, password, transport);
      return run(this.pool, async (client) => {
        // FIRST registration precedes its database approval; lock its Tenant/User anchors directly.
        await this.locks(client, manifest, true);
        await this.security.assertSession(client, handle);
        await this.security.assertProof(client, handle, proof, intent);
        const at = await now(client);
        await this.qualify(client, manifest, at);
        if (manifest.target_user_id !== null) {
          const target = await loadUserOnClient(client, userId(manifest.target_user_id));
          integrity(target !== null && target.revision === manifest.expected_user_revision);
        }
        if (manifest.tenant_id !== null) {
          const target = await loadTenantOnClient(client, tenantId(manifest.tenant_id));
          integrity(target !== null && target.revision === manifest.expected_tenant_revision);
        }
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('zhiban-identity-control-commands',0))",
        );
        const existing = oneRow(
          await client.query<Record<string, unknown>>(
            `SELECT ${controlApprovalFields.join(',')} FROM zhiban_identity.identity_control_approvals WHERE approval_ref=$1`,
            [approvalRef],
          ),
          'SELECT',
          true,
        );
        if (existing !== null)
          integrity(controlApprovalFields.every((k) => existing[k] === manifest[k]));
        else {
          await this.capacity(client, 1);
          changed(
            await client.query(
              `INSERT INTO zhiban_identity.identity_control_approvals (${controlApprovalFields.join(',')}) VALUES (${controlApprovalFields.map((_, i) => `$${i + 1}`).join(',')})`,
              controlApprovalFields.map((k) => manifest[k]),
            ),
            'INSERT',
          );
        }
        await this.security.assertSession(client, handle);
        await this.security.assertProof(client, handle, proof, intent);
        const finalAt = await now(client);
        integrity(finalAt >= at);
        await this.qualify(client, manifest, finalAt);
        return Object.freeze({ approvalId: manifest.approval_id });
      });
    });
  }
  execute(
    handle: AuthenticatedRequestHandle,
    request: ControlCompositionRequest,
    password: string,
    transport: AuthenticationTransport,
    consentId: string | null = null,
  ): Promise<ControlCompositionOutcome> {
    return membershipBoundary(async () => {
      closedCompositionRecord(request, [
        'approvalRef',
        'idempotencyKey',
        'requestId',
        'expectedUserRevision',
        'expectedTenantRevision',
      ]);
      request = Object.freeze({ ...request });
      ref(request.idempotencyKey);
      ref(request.requestId);
      if (request.expectedUserRevision !== null) repositoryRevision(request.expectedUserRevision);
      if (request.expectedTenantRevision !== null)
        repositoryRevision(request.expectedTenantRevision);
      const manifest = await this.manifest(request.approvalRef, handle),
        intent = proofIntent(manifest, request.requestId),
        proof = await this.security.prepare(handle, intent, password, transport);
      return run(this.pool, async (client) => {
        const hint = oneRow(
          await client.query<{ consumed_at: string | null }>(
            'SELECT consumed_at FROM zhiban_identity.identity_control_approvals WHERE approval_id=$1',
            [manifest.approval_id],
          ),
          'SELECT',
        );
        integrity(hint !== null);
        await this.locks(client, manifest);
        await this.security.assertSession(client, handle);
        await this.security.assertProof(client, handle, proof, intent);
        const at = await now(client);
        await this.qualify(client, manifest, at);
        const userLocator = manifest.target_user_id ?? manifest.planned_user_id;
        const tenantLocator = manifest.tenant_id ?? manifest.planned_tenant_id;
        if (userLocator !== null) {
          const target = await loadUserOnClient(client, userId(userLocator));
          if (target === null)
            integrity(manifest.purpose === 'USER_CREATE' && request.expectedUserRevision === null);
          else {
            integrity(request.expectedUserRevision !== null);
            expectedRevision(target.revision, request.expectedUserRevision);
          }
        } else integrity(request.expectedUserRevision === null);
        if (tenantLocator !== null) {
          const target = await loadTenantOnClient(client, tenantId(tenantLocator));
          if (target === null)
            integrity(
              manifest.purpose === 'TENANT_CREATE' && request.expectedTenantRevision === null,
            );
          else {
            integrity(request.expectedTenantRevision !== null);
            expectedRevision(target.revision, request.expectedTenantRevision);
          }
        } else integrity(request.expectedTenantRevision === null);
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('zhiban-identity-control-commands',0))",
        );
        const approval = oneRow(
          await client.query<Record<string, unknown>>(
            `SELECT ${controlApprovalFields.join(',')},consumed_at FROM zhiban_identity.identity_control_approvals WHERE approval_id=$1 FOR UPDATE`,
            [manifest.approval_id],
          ),
          'SELECT',
        );
        integrity(
          approval !== null && controlApprovalFields.every((k) => approval[k] === manifest[k]),
        );
        const prior = oneRow(
          await client.query<{
            command_id: string;
            intent_digest: string;
            approval_id: string;
            outcome_kind: 'APPLIED' | 'TRUE_NO_OP';
          }>(
            `SELECT command_id,intent_digest,approval_id,outcome_kind FROM zhiban_identity.identity_control_commands WHERE actor_user_id=$1 AND action=$2 AND idempotency_key=$3`,
            [manifest.operator_user_id, manifest.purpose, request.idempotencyKey],
          ),
          'SELECT',
          true,
        );
        if (prior !== null) {
          integrity(
            prior.command_id === manifest.command_id &&
              prior.approval_id === manifest.approval_id &&
              prior.intent_digest === intent.intentDigest &&
              ['APPLIED', 'TRUE_NO_OP'].includes(prior.outcome_kind) &&
              approval.consumed_at !== null,
          );
          const effect = oneRow(
            await client.query<{
              target_user_id: string | null;
              tenant_id: string | null;
              membership_id: string | null;
              grant_id: string | null;
              admission_id: string | null;
              after_revision: string | null;
              before_revision: string | null;
              after_status: string | null;
              target_kind: string;
            }>(
              `SELECT target_user_id,tenant_id,membership_id,grant_id,admission_id,after_revision,before_revision,after_status,target_kind
            FROM zhiban_identity.identity_control_command_effects WHERE command_id=$1`,
              [manifest.command_id],
            ),
            'SELECT',
          );
          integrity(effect !== null);
          const expectedKind =
            manifest.purpose === 'MEMBER_ADMISSION'
              ? 'ADMISSION'
              : manifest.purpose === 'FIRST_TENANT_ADMIN'
                ? 'FIRST_TENANT_ADMIN'
                : manifest.purpose.startsWith('USER_')
                  ? 'USER'
                  : 'TENANT';
          integrity(
            Object.keys(effect).sort().join(',') ===
              'admission_id,after_revision,after_status,before_revision,grant_id,membership_id,target_kind,target_user_id,tenant_id' &&
              effect.target_kind === expectedKind &&
              effect.target_user_id === (manifest.target_user_id ?? manifest.planned_user_id) &&
              effect.tenant_id === (manifest.tenant_id ?? manifest.planned_tenant_id) &&
              effect.membership_id ===
                (expectedKind === 'FIRST_TENANT_ADMIN' ? manifest.planned_membership_id : null) &&
              effect.grant_id ===
                (expectedKind === 'FIRST_TENANT_ADMIN' ? manifest.planned_grant_id : null) &&
              (expectedKind === 'ADMISSION'
                ? effect.admission_id !== null &&
                  effect.after_status === null &&
                  effect.before_revision === null &&
                  effect.after_revision === null
                : effect.admission_id === null &&
                  ['ACTIVE', 'DISABLED'].includes(effect.after_status ?? '') &&
                  effect.after_revision !== null),
          );
          for (const id of [
            effect.target_user_id,
            effect.tenant_id,
            effect.membership_id,
            effect.grant_id,
            effect.admission_id,
          ])
            if (id !== null) userId(id);
          for (const revision of [effect.before_revision, effect.after_revision])
            if (revision !== null) repositoryRevision(revision);
          if (effect.target_kind === 'ADMISSION') {
            integrity(
              manifest.purpose === 'MEMBER_ADMISSION' &&
                effect.admission_id !== null &&
                effect.target_user_id === manifest.target_user_id &&
                effect.tenant_id === manifest.tenant_id,
            );
            await this.security.registerAdmission(
              client,
              handle,
              manifest.approval_id,
              effect.admission_id,
              this.policy.tenantRecordCapacity,
            );
          } else if (effect.target_kind === 'USER') {
            const target = await loadUserOnClient(client, userId(effect.target_user_id!));
            integrity(
              target !== null &&
                target.revision === effect.after_revision &&
                target.value.status === effect.after_status &&
                effect.before_revision === manifest.expected_user_revision,
            );
          } else if (effect.target_kind === 'TENANT') {
            const target = await loadTenantOnClient(client, tenantId(effect.tenant_id!));
            integrity(
              target !== null &&
                target.revision === effect.after_revision &&
                target.value.status === effect.after_status &&
                effect.before_revision === manifest.expected_tenant_revision,
            );
          } else if (effect.target_kind === 'FIRST_TENANT_ADMIN') {
            const anchor = oneRow(
              await client.query<{
                repository_revision: string;
                command_id: string;
                membership_id: string;
                grant_id: string;
              }>(
                'SELECT repository_revision,command_id,membership_id,grant_id FROM zhiban_identity.identity_tenant_onboarding WHERE tenant_id=$1 FOR UPDATE',
                [manifest.tenant_id],
              ),
              'SELECT',
            );
            integrity(
              anchor !== null &&
                anchor.repository_revision === '2' &&
                anchor.command_id === manifest.command_id &&
                anchor.membership_id === manifest.planned_membership_id &&
                anchor.grant_id === manifest.planned_grant_id,
            );
          }
          await this.security.assertSession(client, handle);
          await this.security.assertProof(client, handle, proof, intent);
          const finalAt = await now(client);
          integrity(finalAt >= at);
          await this.qualify(client, manifest, finalAt);
          if (effect.target_kind === 'ADMISSION')
            await this.security.registerAdmission(
              client,
              handle,
              manifest.approval_id,
              effect.admission_id!,
              this.policy.tenantRecordCapacity,
            );
          if (manifest.purpose === 'TENANT_RESTORE')
            await client.query('SELECT zhiban_identity.identity_tenant_restore_guard($1,$2)', [
              manifest.tenant_id,
              manifest.operator_user_id,
            ]);
          if (manifest.purpose === 'FIRST_TENANT_ADMIN')
            await client.query('SELECT zhiban_identity.identity_first_tenant_admin_lock($1,$2)', [
              manifest.tenant_id,
              manifest.approval_id,
            ]);
          return Object.freeze({
            commandId: manifest.command_id,
            status: prior.outcome_kind,
            userId: effect.target_user_id === null ? null : userId(effect.target_user_id),
            tenantId: effect.tenant_id === null ? null : tenantId(effect.tenant_id),
            membershipId: effect.membership_id === null ? null : membershipId(effect.membership_id),
            grantId: effect.grant_id === null ? null : roleGrantId(effect.grant_id),
            admissionId: effect.admission_id,
            revision:
              effect.after_revision === null ? null : repositoryRevision(effect.after_revision),
          });
        }
        integrity(
          approval.consumed_at === null &&
            request.expectedUserRevision === manifest.expected_user_revision &&
            request.expectedTenantRevision === manifest.expected_tenant_revision,
        );
        await this.capacity(client, manifest.purpose === 'TENANT_CREATE' ? 3 : 2);
        const subjectUser = manifest.target_user_id ?? manifest.planned_user_id,
          subjectTenant = manifest.tenant_id ?? manifest.planned_tenant_id;
        let member: string | null = null,
          grant: string | null = null,
          admission: string | null = null,
          before: string | null = null,
          after: string | null = null,
          status: string | null = null,
          auth: string | null = null,
          event: string | null = null,
          additionalEvent: string | null = null;
        let kind: 'USER' | 'TENANT' | 'ADMISSION' | 'FIRST_TENANT_ADMIN';
        if (manifest.purpose.startsWith('USER_')) {
          kind = 'USER';
          integrity(subjectUser !== null);
          const loaded =
            manifest.purpose === 'USER_CREATE'
              ? null
              : await loadUserOnClient(client, userId(subjectUser));
          const candidate =
            manifest.purpose === 'USER_CREATE'
              ? User.create(userId(subjectUser), at)
              : manifest.purpose === 'USER_DISABLE'
                ? loaded!.value.disable(at, manifest.reason)
                : loaded!.value.restore(at);
          const saved = await writeUserOnClient(client, candidate, loaded?.revision ?? null);
          before = loaded?.revision ?? null;
          after = saved.revision;
          status = saved.value.status;
          if (before !== after)
            event = await appendControlAudit(client, manifest, subjectUser, at, request.requestId);
        } else if (
          ['TENANT_CREATE', 'TENANT_DISABLE', 'TENANT_RESTORE'].includes(manifest.purpose)
        ) {
          kind = 'TENANT';
          integrity(subjectTenant !== null);
          const loaded =
            manifest.purpose === 'TENANT_CREATE'
              ? null
              : await loadTenantOnClient(client, tenantId(subjectTenant));
          const candidate =
            manifest.purpose === 'TENANT_CREATE'
              ? Tenant.create(
                  tenantId(subjectTenant),
                  manifest.tenant_code!,
                  manifest.tenant_display_name!,
                  at,
                )
              : manifest.purpose === 'TENANT_DISABLE'
                ? loaded!.value.disable(at, manifest.reason)
                : loaded!.value.restore(at);
          const saved = await writeTenantOnClient(client, candidate, loaded?.revision ?? null);
          before = loaded?.revision ?? null;
          after = saved.revision;
          status = saved.value.status;
          if (before !== after)
            event = await appendControlAudit(
              client,
              manifest,
              subjectTenant,
              at,
              request.requestId,
            );
          if (manifest.purpose === 'TENANT_CREATE')
            changed(
              await client.query(
                'INSERT INTO zhiban_identity.identity_tenant_onboarding(tenant_id,repository_revision,created_command_id) VALUES ($1,1,$2)',
                [subjectTenant, manifest.command_id],
              ),
              'INSERT',
            );
        } else if (manifest.purpose === 'MEMBER_ADMISSION') {
          kind = 'ADMISSION';
          admission = this.ids.nextCommandId();
          await this.security.registerAdmission(
            client,
            handle,
            manifest.approval_id,
            admission,
            this.policy.tenantRecordCapacity,
          );
        } else {
          kind = 'FIRST_TENANT_ADMIN';
          integrity(consentId !== null);
          userId(consentId);
          const applied = oneRow(
            await client.query<{
              membership_id: string;
              member_revision: string;
              authorization_version: string;
              grant_id: string;
            }>('SELECT * FROM zhiban_identity.identity_first_tenant_admin_apply($1,$2,$3,$4)', [
              manifest.tenant_id,
              manifest.approval_id,
              consentId,
              at.toString(),
            ]),
            'SELECT',
          );
          integrity(
            applied !== null &&
              applied.membership_id === manifest.planned_membership_id &&
              applied.grant_id === manifest.planned_grant_id &&
              applied.member_revision === '2' &&
              applied.authorization_version === '1',
          );
          member = applied.membership_id;
          grant = applied.grant_id;
          after = '2';
          auth = '1';
          status = 'ACTIVE';
          await client.query("SELECT set_config('app.onboarding_approval_id',$1,true)", [
            manifest.approval_id,
          ]);
          event = await appendMemberAudit(client, {
            type: 'MEMBERSHIP_PENDING_CREATED',
            tenantId: tenantId(manifest.tenant_id!),
            userId: userId(manifest.target_user_id!),
            membershipId: membershipId(member),
            authorizationVersionBefore: null,
            authorizationVersionAfter: 0,
            occurredAt: at,
            actor: { kind: 'SERVICE', serviceCode: 'identity_tenant_onboarding' },
            reason: manifest.reason,
            requestId: request.requestId,
          });
          additionalEvent = await appendMemberAudit(client, {
            type: 'MEMBERSHIP_ACTIVATED',
            tenantId: tenantId(manifest.tenant_id!),
            userId: userId(manifest.target_user_id!),
            membershipId: membershipId(member),
            authorizationVersionBefore: 0,
            authorizationVersionAfter: 1,
            priorGrantIds: [],
            approvedGrants: [
              {
                id: roleGrantId(grant),
                roleCode: 'TENANT_ADMIN',
                scope: tenantScope(),
                validFrom: at,
                validUntil:
                  manifest.valid_until === null
                    ? null
                    : instant(Number(BigInt(manifest.valid_until))),
              },
            ],
            occurredAt: at,
            actor: { kind: 'SERVICE', serviceCode: 'identity_tenant_onboarding' },
            reason: manifest.reason,
            requestId: request.requestId,
          });
        }
        const outcomeKind =
          kind === 'USER' || kind === 'TENANT'
            ? before === after
              ? 'TRUE_NO_OP'
              : 'APPLIED'
            : 'APPLIED';
        changed(
          await client.query(
            `INSERT INTO zhiban_identity.identity_control_commands(command_id,actor_user_id,action,idempotency_key,intent_digest,approval_id,request_id,completed_at,outcome_kind)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              manifest.command_id,
              manifest.operator_user_id,
              manifest.purpose,
              request.idempotencyKey,
              intent.intentDigest,
              manifest.approval_id,
              request.requestId,
              at.toString(),
              outcomeKind,
            ],
          ),
          'INSERT',
        );
        changed(
          await client.query(
            `INSERT INTO zhiban_identity.identity_control_command_effects(command_id,target_kind,target_user_id,tenant_id,membership_id,grant_id,admission_id,before_revision,after_revision,after_auth_version,after_status,audit_event_id,additional_audit_event_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              manifest.command_id,
              kind,
              subjectUser,
              subjectTenant,
              member,
              grant,
              admission,
              before,
              after,
              auth,
              status,
              event,
              additionalEvent,
            ],
          ),
          'INSERT',
        );
        changed(
          await client.query(
            'UPDATE zhiban_identity.identity_control_approvals SET consumed_at=$1 WHERE approval_id=$2 AND consumed_at IS NULL',
            [at.toString(), manifest.approval_id],
          ),
          'UPDATE',
        );
        if (kind === 'FIRST_TENANT_ADMIN')
          changed(
            await client.query(
              `UPDATE zhiban_identity.identity_tenant_onboarding
          SET repository_revision=2,completed_at=$1,approval_id=$2,command_id=$3,consent_id=$4,user_id=$5,membership_id=$6,grant_id=$7,pending_event_id=$8,activation_event_id=$9
          WHERE tenant_id=$10 AND repository_revision=1`,
              [
                at.toString(),
                manifest.approval_id,
                manifest.command_id,
                consentId,
                subjectUser,
                member,
                grant,
                event,
                additionalEvent,
                subjectTenant,
              ],
            ),
            'UPDATE',
          );
        await this.security.assertSession(client, handle);
        await this.security.assertProof(client, handle, proof, intent);
        const finalAt = await now(client);
        integrity(finalAt >= at);
        await this.qualify(client, manifest, finalAt);
        if (manifest.purpose === 'TENANT_RESTORE')
          await client.query('SELECT zhiban_identity.identity_tenant_restore_guard($1,$2)', [
            manifest.tenant_id,
            manifest.operator_user_id,
          ]);
        if (manifest.purpose === 'FIRST_TENANT_ADMIN')
          await client.query('SELECT zhiban_identity.identity_first_tenant_admin_lock($1,$2)', [
            manifest.tenant_id,
            manifest.approval_id,
          ]);
        return Object.freeze({
          commandId: manifest.command_id,
          status: outcomeKind,
          userId: subjectUser === null ? null : userId(subjectUser),
          tenantId: subjectTenant === null ? null : tenantId(subjectTenant),
          membershipId: member === null ? null : membershipId(member),
          grantId: grant === null ? null : roleGrantId(grant),
          admissionId: admission,
          revision: after === null ? null : repositoryRevision(after),
        });
      });
    });
  }
}
