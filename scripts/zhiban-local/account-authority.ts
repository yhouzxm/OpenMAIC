/** LOCAL synthetic independent operator; no web caller signs global/credential approvals. */
import { randomBytes, sign, verify } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import {
  controlManifestDigest,
  type ControlApprovalManifest,
  type MembershipOperatorApprovalStore,
} from '@/lib/zhiban/infrastructure/identity/composition/control-approval';
import { observedTransport } from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { bearerForCookie } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import {
  onboardingDigest,
  ticketDigest,
  type OrdinaryAccountManifest,
} from '@/lib/zhiban/domain/onboarding/model';
import type { MemberControlConfig } from './member-authority';
import { loadOnboarding } from './onboarding';
function check(value: unknown): asserts value {
  if (!value) throw Error('LOCAL ordinary account authority rejected');
}
async function privatePath(path: string, dir = false) {
  const s = await lstat(path);
  check(
    !s.isSymbolicLink() &&
      s.uid === process.getuid?.() &&
      !(s.mode & 0o077) &&
      (dir ? s.isDirectory() : s.isFile()),
  );
}
export interface AccountEnvelope {
  kind: 'LOCAL_SYNTHETIC_ORDINARY_ACCOUNT';
  evidenceOrigin: 'LOCAL';
  githubActions: false;
  manifest: OrdinaryAccountManifest;
  control: ControlApprovalManifest;
  operatorSignature: string;
  approverSignature: string;
}
const envelopeFields = [
  'kind',
  'evidenceOrigin',
  'githubActions',
  'manifest',
  'control',
  'operatorSignature',
  'approverSignature',
];
export async function loadAccountEnvelope(
  cfg: MemberControlConfig,
  ref: string,
): Promise<AccountEnvelope> {
  check(/^[0-9a-f-]{36}$/.test(ref));
  const root = cfg.authority.root,
    dir = join(root, 'account-approvals'),
    path = join(dir, ref + '.json');
  for (const p of [root, dir]) await privatePath(p, true);
  await privatePath(path);
  const e = JSON.parse(await readFile(path, 'utf8')) as AccountEnvelope;
  check(
    Object.keys(e).sort().join() === envelopeFields.sort().join() &&
      e.kind === 'LOCAL_SYNTHETIC_ORDINARY_ACCOUNT' &&
      e.evidenceOrigin === 'LOCAL' &&
      e.githubActions === false,
  );
  const m = e.manifest,
    c = e.control,
    bytes = Buffer.from(JSON.stringify({ manifest: m, control: c }));
  check(cfg.authority.operatorPublic !== cfg.authority.approverPublic);
  for (const [pin, sig] of [
    [cfg.authority.operatorPublic, e.operatorSignature],
    [cfg.authority.approverPublic, e.approverSignature],
  ])
    check(verify(null, bytes, pin, Buffer.from(sig, 'base64')));
  check(
    m.kind === 'ORDINARY_FIRST_PASSWORD' &&
      m.evidenceOrigin === 'LOCAL' &&
      m.githubActions === false &&
      m.environment === cfg.authority.environment &&
      m.sourceRef === ref &&
      m.operatorRef === 'LOCAL_SYNTHETIC_OPERATOR' &&
      m.approverRef === 'LOCAL_SYNTHETIC_APPROVER',
  );
  check(
    m.expectedUserRevision === '1' &&
      Number.isSafeInteger(m.issuedAt) &&
      Number.isSafeInteger(m.expiresAt) &&
      m.expiresAt > m.issuedAt &&
      m.expiresAt - m.issuedAt <= 1800000 &&
      m.subjectBindingRef === `LOCAL_SYNTHETIC_SUBJECT:${m.requestId}` &&
      m.recipientDeliveryRef === `LOCAL_SYNTHETIC_RECIPIENT:${m.requestId}`,
  );
  check(
    c.purpose === 'USER_CREATE' &&
      c.planned_user_id === m.userId &&
      c.approval_id === m.controlApprovalId &&
      c.command_id === m.controlCommandId &&
      c.manifest_digest === m.controlManifestDigest &&
      c.manifest_digest === controlManifestDigest(c) &&
      c.environment_ref === m.environment,
  );
  check(
    c.target_user_id === null &&
      c.tenant_id === null &&
      c.planned_tenant_id === null &&
      c.expected_user_revision === null &&
      c.expected_tenant_revision === null &&
      c.planned_membership_id === null &&
      c.planned_grant_id === null &&
      c.admission_purpose === null,
  );
  check(m.operatorUserId === cfg.operator.uid && m.systemAdminGrantId === cfg.operator.grant);
  return e;
}
export function accountAuthorityStore(cfg: MemberControlConfig): MembershipOperatorApprovalStore {
  return Object.freeze({
    load: async (ref: string) => {
      const e = await loadAccountEnvelope(cfg, ref);
      check(e.control.approval_ref === ref && e.manifest.sourceRef === ref);
      return e.control;
    },
  });
}
async function saveEnvelope(
  cfg: MemberControlConfig,
  manifest: OrdinaryAccountManifest,
  control: ControlApprovalManifest,
) {
  const root = cfg.authority.root,
    dir = join(root, 'account-approvals');
  await mkdir(dir, { mode: 0o700, recursive: true });
  await privatePath(dir, true);
  const bytes = Buffer.from(JSON.stringify({ manifest, control })),
    signatures = [];
  for (const role of ['operator', 'approver']) {
    const path = join(root, `member-${role}.pem`);
    await privatePath(path);
    signatures.push(sign(null, bytes, await readFile(path)).toString('base64'));
  }
  const value: AccountEnvelope = {
    kind: 'LOCAL_SYNTHETIC_ORDINARY_ACCOUNT',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    manifest,
    control,
    operatorSignature: signatures[0],
    approverSignature: signatures[1],
  };
  await writeFile(join(dir, manifest.sourceRef + '.json'), JSON.stringify(value), {
    mode: 0o400,
    flag: 'wx',
  });
  return value;
}
type Pools = { auth: Pool; tenant: Pool; control: Pool; business: Pool };
export async function approveLocalAccount(
  cfg: MemberControlConfig,
  pools: Pools,
  id: string,
  reissue = false,
) {
  check(await loadOnboarding(pools.business));
  const ids = new IdentityIds(),
    q = pools.control;
  let r = (
    await q.query('SELECT *,revision::text FROM zhiban_onboarding.requests WHERE id=$1', [id])
  ).rows[0];
  check(r);
  const composition = await createIdentityComposition(
    { auth: pools.auth, tenant: pools.tenant, control: q },
    {
      ...cfg.composition,
      admission: {
        ...cfg.composition.admission,
        hmacKey: Buffer.from(cfg.composition.admission.hmacKey, 'hex'),
      },
      membership: {
        policy: cfg.composition.membership.policy,
        operator: accountAuthorityStore(cfg),
      },
    },
  );
  check(composition.control);
  const transport = observedTransport('127.0.0.1');
  const logged = await composition.security.login(
    cfg.operator.uid,
    cfg.operator.password,
    transport,
    ids.nextCommandId(),
  );
  check(logged.status === 'ISSUED');
  const operatorHandle = await composition.security.authenticate(bearerForCookie(logged.bearer));
  check(operatorHandle);
  const sessionGuard = await composition.security.membershipSecurity();
  try {
    let envelope: AccountEnvelope;
    const clock = Date.now(),
      op = (
        await q.query(
          "SELECT repository_revision::text FROM zhiban_identity.users WHERE user_id=$1 AND status='ACTIVE'",
          [cfg.operator.uid],
        )
      ).rows[0],
      grant = (
        await q.query(
          'SELECT repository_revision::text FROM zhiban_identity.system_admin_grants WHERE grant_id=$1 AND user_id=$2 AND revoked_at IS NULL AND valid_from<=$3 AND (valid_until IS NULL OR valid_until>$3)',
          [cfg.operator.grant, cfg.operator.uid, clock],
        )
      ).rows[0];
    check(op && grant);
    if (r.state === 'REQUESTED') {
      check(!reissue);
      const snapshot = await composition.catalog.load(),
        source = ids.nextCommandId(),
        uid = ids.nextUserId();
      const draft: ControlApprovalManifest = {
        approval_id: ids.nextCommandId(),
        purpose: 'USER_CREATE',
        environment_ref: cfg.authority.environment,
        approval_ref: source,
        operator_ref: 'LOCAL_SYNTHETIC_OPERATOR',
        approver_ref: 'LOCAL_SYNTHETIC_APPROVER',
        operator_user_id: cfg.operator.uid,
        expected_operator_user_revision: op.repository_revision,
        system_admin_grant_id: cfg.operator.grant,
        expected_admin_grant_revision: grant.repository_revision,
        command_id: ids.nextCommandId(),
        manifest_digest: '0'.repeat(64),
        catalog_digest: snapshot.contentDigest,
        action_version: 'identity-v1',
        delegation_version: 'identity-v1',
        target_user_id: null,
        tenant_id: null,
        planned_user_id: uid,
        planned_tenant_id: null,
        target_membership_id: null,
        planned_membership_id: null,
        planned_grant_id: null,
        expected_user_revision: null,
        expected_tenant_revision: null,
        expected_member_revision: null,
        expected_auth_version: null,
        valid_until: null,
        tenant_code: null,
        tenant_display_name: null,
        admission_purpose: null,
        issued_at: String(clock - 1000),
        expires_at: String(clock + 1799000),
        reason: 'ADMIN_REQUEST',
      };
      const control = { ...draft, manifest_digest: controlManifestDigest(draft) };
      const manifest: OrdinaryAccountManifest = {
        kind: 'ORDINARY_FIRST_PASSWORD',
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        environment: cfg.authority.environment,
        requestId: id,
        requestDigest: r.request_digest,
        userId: uid,
        expectedUserRevision: '1',
        claimId: ids.nextCommandId(),
        controlApprovalId: control.approval_id,
        controlCommandId: control.command_id,
        controlManifestDigest: control.manifest_digest,
        sourceRef: source,
        subjectBindingRef: `LOCAL_SYNTHETIC_SUBJECT:${id}`,
        recipientDeliveryRef: `LOCAL_SYNTHETIC_RECIPIENT:${id}`,
        operatorRef: 'LOCAL_SYNTHETIC_OPERATOR',
        approverRef: 'LOCAL_SYNTHETIC_APPROVER',
        operatorUserId: cfg.operator.uid,
        operatorUserRevision: op.repository_revision,
        systemAdminGrantId: cfg.operator.grant,
        adminGrantRevision: grant.repository_revision,
        issuedAt: clock - 1000,
        expiresAt: clock + 1799000,
        supersedesClaimId: null,
      };
      envelope = await saveEnvelope(cfg, manifest, control);
      const c = await q.connect();
      try {
        await c.query('BEGIN');
        const updated = await c.query(
          "UPDATE zhiban_onboarding.requests SET state='APPROVED',revision=revision+1,planned_user_id=$3,control_approval_id=$4,control_command_id=$5,control_manifest_digest=$6,source_ref=$7,updated_at=$8 WHERE id=$1 AND revision=$2 AND state='REQUESTED' RETURNING *",
          [
            id,
            r.revision,
            uid,
            control.approval_id,
            control.command_id,
            control.manifest_digest,
            source,
            clock,
          ],
        );
        check(updated.rows.length === 1);
        r = updated.rows[0];
        await c.query('INSERT INTO zhiban_onboarding.events VALUES($1,$2,$3,$4,$5,$6,$7)', [
          r.tenant_id,
          ids.nextCommandId(),
          id,
          'PLATFORM_APPROVED',
          cfg.operator.uid,
          JSON.stringify({ sourceRef: source, plannedUserId: uid }),
          clock,
        ]);
        check((await c.query('COMMIT')).command === 'COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    } else {
      check(
        ['APPROVED', 'READY', 'REVOKED'].includes(r.state) && (r.state !== 'REVOKED' || reissue),
      );
      envelope = await loadAccountEnvelope(cfg, r.source_ref);
    }
    let m = envelope.manifest;
    check(m.requestDigest === r.request_digest && m.userId === r.planned_user_id);
    let creationProved =
      r.state === 'APPROVED' &&
      (await q.query('SELECT zhiban_onboarding.creation_proved($1) AS ok', [id])).rows[0].ok ===
        true;
    if (r.state === 'APPROVED' && m.expiresAt <= clock && !creationProved) {
      check(reissue);
      check(
        !(await q.query('SELECT user_id FROM zhiban_identity.users WHERE user_id=$1', [m.userId]))
          .rows.length,
      );
      const sourceRef = ids.nextCommandId();
      const draft = {
        ...envelope.control,
        approval_id: ids.nextCommandId(),
        command_id: ids.nextCommandId(),
        approval_ref: sourceRef,
        expected_operator_user_revision: op.repository_revision,
        expected_admin_grant_revision: grant.repository_revision,
        issued_at: String(clock - 1000),
        expires_at: String(clock + 1799000),
        manifest_digest: '0'.repeat(64),
      };
      const control = { ...draft, manifest_digest: controlManifestDigest(draft) };
      const manifest = {
        ...m,
        claimId: ids.nextCommandId(),
        sourceRef,
        controlApprovalId: control.approval_id,
        controlCommandId: control.command_id,
        controlManifestDigest: control.manifest_digest,
        operatorUserRevision: op.repository_revision,
        adminGrantRevision: grant.repository_revision,
        issuedAt: clock - 1000,
        expiresAt: clock + 1799000,
        supersedesClaimId: null,
      };
      envelope = await saveEnvelope(cfg, manifest, control);
      const c = await q.connect();
      try {
        await c.query('BEGIN');
        await sessionGuard.assertSession(c, operatorHandle);
        const updated = await c.query(
          "UPDATE zhiban_onboarding.requests SET revision=revision+1,control_approval_id=$3,control_command_id=$4,control_manifest_digest=$5,source_ref=$6,updated_at=$7 WHERE id=$1 AND revision=$2 AND state='APPROVED' RETURNING *",
          [
            id,
            r.revision,
            control.approval_id,
            control.command_id,
            control.manifest_digest,
            sourceRef,
            clock,
          ],
        );
        check(updated.rows.length === 1);
        r = updated.rows[0];
        await c.query('INSERT INTO zhiban_onboarding.events VALUES($1,$2,$3,$4,$5,$6,$7)', [
          r.tenant_id,
          ids.nextCommandId(),
          id,
          'PLATFORM_SOURCE_RENEWED',
          cfg.operator.uid,
          JSON.stringify({ sourceRef, plannedUserId: m.userId }),
          clock,
        ]);
        await sessionGuard.assertSession(c, operatorHandle);
        check((await c.query('COMMIT')).command === 'COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
      m = manifest;
    }
    if (r.state === 'APPROVED' && !creationProved) {
      const handle = operatorHandle;
      await composition.control.registerApproval(
        handle,
        envelope.control.approval_ref,
        cfg.operator.password,
        transport,
        ids.nextCommandId(),
      );
      const user = (
        await q.query(
          'SELECT repository_revision::text FROM zhiban_identity.users WHERE user_id=$1',
          [m.userId],
        )
      ).rows[0];
      const result = await composition.control.execute(
        handle,
        {
          approvalRef: envelope.control.approval_ref,
          idempotencyKey: envelope.control.command_id,
          requestId: ids.nextCommandId(),
          expectedUserRevision: user ? repositoryRevision(user.repository_revision) : null,
          expectedTenantRevision: null,
        },
        cfg.operator.password,
        transport,
      );
      check(result.userId === m.userId);
      creationProved = true;
    }
    let selected = envelope;
    if (reissue) {
      check(r.claim_id || creationProved);
      const manifest = {
        ...m,
        claimId: ids.nextCommandId(),
        sourceRef: ids.nextCommandId(),
        operatorUserRevision: op.repository_revision,
        adminGrantRevision: grant.repository_revision,
        issuedAt: clock - 1000,
        expiresAt: clock + 1799000,
        supersedesClaimId: r.claim_id ?? null,
      };
      selected = await saveEnvelope(cfg, manifest, envelope.control);
    } else if (r.state === 'READY' || r.state === 'REVOKED') {
      // No new ticket after an uncertain result. Existing protected delivery is the only retry result.
      const ready = await loadAccountEnvelope(
        cfg,
        (
          await q.query(
            "SELECT facts->>'sourceRef' AS ref FROM zhiban_onboarding.events WHERE request_id=$1 AND action='DELIVERY_READY' ORDER BY created_at DESC LIMIT 1",
            [id],
          )
        ).rows[0]?.ref ?? r.source_ref,
      );
      selected = ready;
    }
    const current = selected.manifest;
    check(current.expiresAt > Date.now());
    const deliveryDir = join(cfg.authority.root, 'account-delivery');
    await mkdir(deliveryDir, { mode: 0o700, recursive: true });
    await privatePath(deliveryDir, true);
    const path = join(deliveryDir, current.claimId + '.json');
    let delivery: {
      ticket: string;
      claimId: string;
      userId: string;
      sourceDigest: string;
      recipientDeliveryRef: string;
    };
    try {
      await privatePath(path);
      delivery = JSON.parse(await readFile(path, 'utf8'));
      check(
        delivery.claimId === current.claimId &&
          delivery.userId === current.userId &&
          delivery.sourceDigest === onboardingDigest(current) &&
          delivery.recipientDeliveryRef === current.recipientDeliveryRef,
      );
    } catch (e) {
      if ((e as { code?: string }).code !== 'ENOENT') throw e;
      delivery = {
        ticket: current.claimId + '.' + randomBytes(32).toString('base64url'),
        claimId: current.claimId,
        userId: current.userId,
        sourceDigest: onboardingDigest(current),
        recipientDeliveryRef: current.recipientDeliveryRef,
      };
      await writeFile(
        path,
        JSON.stringify({
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          kind: 'RECIPIENT_FIRST_PASSWORD_TICKET',
          ...delivery,
          setupUrl: cfg.composition.origin + '/zhiban/activate-account',
          expiresAt: current.expiresAt,
        }),
        { mode: 0o400, flag: 'wx' },
      );
    }
    r = (await q.query('SELECT *,revision::text FROM zhiban_onboarding.requests WHERE id=$1', [id]))
      .rows[0];
    if (r.claim_id !== current.claimId) {
      const c = await q.connect();
      try {
        await c.query('BEGIN');
        await c.query(
          'SELECT user_id FROM zhiban_identity.users WHERE user_id IN($1,$2) ORDER BY user_id FOR UPDATE',
          [cfg.operator.uid, current.userId],
        );
        await sessionGuard.assertSession(c, operatorHandle);
        await c.query('SELECT zhiban_onboarding.register_claim($1,$2,$3,$4,$5)', [
          id,
          r.revision,
          JSON.stringify(current),
          onboardingDigest(current),
          ticketDigest(delivery.ticket),
        ]);
        await sessionGuard.assertSession(c, operatorHandle);
        check((await c.query('COMMIT')).command === 'COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    }
    check(
      (await q.query('SELECT claim_id FROM zhiban_onboarding.requests WHERE id=$1', [id])).rows[0]
        .claim_id === current.claimId,
    );
    return {
      requestId: id,
      userId: current.userId,
      claimId: current.claimId,
      deliveryFile: path,
      setupUrl: cfg.composition.origin + '/zhiban/activate-account',
      expiresAt: current.expiresAt,
      syntheticAuthority: true,
    };
  } finally {
    await composition.security.logout(operatorHandle, ids.nextCommandId());
  }
}

/** Private control operation; reauthenticates the operator, then guards that Session at commit. */
export async function revokeLocalAccount(cfg: MemberControlConfig, pools: Pools, id: string) {
  check(await loadOnboarding(pools.business));
  const r = (
    await pools.control.query(
      'SELECT claim_id,source_ref,planned_user_id FROM zhiban_onboarding.requests WHERE id=$1',
      [id],
    )
  ).rows[0];
  check(r?.claim_id);
  await loadAccountEnvelope(cfg, r.source_ref);
  const c = await createIdentityComposition(
      { auth: pools.auth, tenant: pools.tenant, control: pools.control },
      {
        ...cfg.composition,
        admission: {
          ...cfg.composition.admission,
          hmacKey: Buffer.from(cfg.composition.admission.hmacKey, 'hex'),
        },
        membership: {
          policy: cfg.composition.membership.policy,
          operator: accountAuthorityStore(cfg),
        },
      },
    ),
    ids = new IdentityIds();
  const login = await c.security.login(
    cfg.operator.uid,
    cfg.operator.password,
    observedTransport('127.0.0.1'),
    ids.nextCommandId(),
  );
  check(login.status === 'ISSUED');
  const handle = await c.security.authenticate(bearerForCookie(login.bearer));
  check(handle);
  const guard = await c.security.membershipSecurity();
  try {
    const client = await pools.control.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT user_id FROM zhiban_identity.users WHERE user_id IN($1,$2) ORDER BY user_id FOR UPDATE',
        [cfg.operator.uid, r.planned_user_id],
      );
      await guard.assertSession(client, handle);
      await client.query('SELECT zhiban_onboarding.revoke_claim($1,$2,$3)', [
        r.claim_id,
        cfg.operator.uid,
        cfg.operator.grant,
      ]);
      await guard.assertSession(client, handle);
      check((await client.query('COMMIT')).command === 'COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { requestId: id, claimId: r.claim_id, status: 'REVOKED_UNUSED_DELIVERY' };
  } finally {
    await c.security.logout(handle, ids.nextCommandId());
  }
}
