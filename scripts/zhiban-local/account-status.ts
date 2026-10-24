/** Independent LOCAL global state control. Never imported by a web request handler. */
import { sign, verify } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { userId } from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { controlTransaction } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  controlManifest,
  controlManifestDigest,
  controlIntentDigest,
  type ControlApprovalManifest,
  type MembershipOperatorApprovalStore,
} from '@/lib/zhiban/infrastructure/identity/composition/control-approval';
import { bearerForCookie } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { observedTransport } from '@/lib/zhiban/infrastructure/identity/composition/admission';
import type { MemberControlConfig } from './member-authority';
type Pools = { auth: Pool; tenant: Pool; control: Pool };
export const statusReasons = [
  'ADMIN_REQUEST',
  'ACCESS_REVIEW',
  'SECURITY_POLICY',
  'SYSTEM_MAINTENANCE',
  'USER_REQUEST',
] as const;
export type StatusReason = (typeof statusReasons)[number];
export type StatusAction = 'USER_DISABLE' | 'USER_RESTORE';
function check(value: unknown): asserts value {
  if (!value) throw Error('LOCAL global account control rejected');
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
function validate(
  m: ControlApprovalManifest,
  cfg: MemberControlConfig,
  digest: string,
  ref: string,
) {
  const checked = controlManifest(
    m,
    cfg.authority.environment,
    digest,
    cfg.composition.membership.policy.sourceTtlMs,
  );
  check(
    checked.approval_ref === ref &&
      ['USER_DISABLE', 'USER_RESTORE'].includes(checked.purpose) &&
      checked.operator_ref === 'LOCAL_SYNTHETIC_OPERATOR' &&
      checked.approver_ref === 'LOCAL_SYNTHETIC_APPROVER' &&
      checked.operator_user_id === cfg.operator.uid &&
      checked.system_admin_grant_id === cfg.operator.grant &&
      checked.target_user_id !== null &&
      checked.target_user_id !== cfg.operator.uid &&
      checked.expected_user_revision !== null &&
      statusReasons.includes(checked.reason as StatusReason),
  );
  for (const k of [
    'tenant_id',
    'planned_user_id',
    'planned_tenant_id',
    'target_membership_id',
    'planned_membership_id',
    'planned_grant_id',
    'expected_tenant_revision',
    'expected_member_revision',
    'expected_auth_version',
    'valid_until',
    'tenant_code',
    'tenant_display_name',
    'admission_purpose',
  ] as const)
    check(checked[k] === null);
  return checked;
}
export function accountStatusStore(
  cfg: MemberControlConfig,
  digest: string,
): MembershipOperatorApprovalStore {
  return Object.freeze({
    async load(ref: string) {
      userId(ref);
      const dir = join(cfg.authority.root, 'account-status-approvals'),
        path = join(dir, ref + '.json');
      await privatePath(cfg.authority.root, true);
      await privatePath(dir, true);
      await privatePath(path);
      const e = JSON.parse(await readFile(path, 'utf8'));
      check(
        Object.keys(e).sort().join() ===
          [
            'approverSignature',
            'evidenceOrigin',
            'githubActions',
            'kind',
            'manifest',
            'operatorSignature',
          ].join() &&
          e.kind === 'LOCAL_SYNTHETIC_GLOBAL_ACCOUNT_STATUS' &&
          e.evidenceOrigin === 'LOCAL' &&
          e.githubActions === false &&
          cfg.authority.operatorPublic !== cfg.authority.approverPublic,
      );
      const bytes = Buffer.from(JSON.stringify(e.manifest));
      check(
        verify(
          null,
          bytes,
          cfg.authority.operatorPublic,
          Buffer.from(e.operatorSignature, 'base64'),
        ) &&
          verify(
            null,
            bytes,
            cfg.authority.approverPublic,
            Buffer.from(e.approverSignature, 'base64'),
          ),
      );
      return validate(e.manifest, cfg, digest, ref);
    },
  });
}
async function operator<T>(
  cfg: MemberControlConfig,
  pools: Pools,
  work: (ctx: {
    c: Awaited<ReturnType<typeof createIdentityComposition>>;
    handle: NonNullable<
      Awaited<
        ReturnType<
          Awaited<ReturnType<typeof createIdentityComposition>>['security']['authenticate']
        >
      >
    >;
    ids: IdentityIds;
    store: MembershipOperatorApprovalStore;
  }) => Promise<T>,
) {
  const ids = new IdentityIds();
  // Catalog pin comes from the existing approved composition, not from a request or new self-derived profile.
  const digest = cfg.composition.catalog.expectedDigest;
  const store = accountStatusStore(cfg, digest);
  const c = await createIdentityComposition(
    { auth: pools.auth, tenant: pools.tenant, control: pools.control },
    {
      ...cfg.composition,
      admission: {
        ...cfg.composition.admission,
        hmacKey: Buffer.from(cfg.composition.admission.hmacKey, 'hex'),
      },
      membership: { policy: cfg.composition.membership.policy, operator: store },
    },
  );
  const logged = await c.security.login(
    cfg.operator.uid,
    cfg.operator.password,
    observedTransport('127.0.0.1'),
    ids.nextCommandId(),
  );
  check(logged.status === 'ISSUED');
  const handle = await c.security.authenticate(bearerForCookie(logged.bearer));
  check(handle && c.control);
  try {
    return await work({ c, handle, ids, store });
  } finally {
    await c.security.logout(handle, ids.nextCommandId());
  }
}
/** The read has its own current operator/Session checks; no unguarded global status/list endpoint. */
async function readGuarded<T>(
  cfg: MemberControlConfig,
  pools: Pools,
  ctx: Parameters<Parameters<typeof operator>[2]>[0],
  target: string,
  work: (
    client: Pick<import('pg').PoolClient, 'query'>,
    facts: { userRevision: string; grantRevision: string },
  ) => Promise<T>,
) {
  userId(target);
  check(target !== cfg.operator.uid);
  const guard = await ctx.c.security.membershipSecurity();
  return controlTransaction(pools.control, async (client) => {
    for (const uid of [cfg.operator.uid, target].sort())
      await client.query('SELECT user_id FROM zhiban_identity.users WHERE user_id=$1 FOR SHARE', [
        uid,
      ]);
    await guard.assertSession(client, ctx.handle);
    const {
      rows: [r],
    } = await client.query(
      `SELECT u.repository_revision::text AS ur,g.repository_revision::text AS gr
      FROM zhiban_identity.users u JOIN zhiban_identity.system_admin_grants g ON g.user_id=u.user_id
      WHERE u.user_id=$1 AND u.status='ACTIVE' AND g.grant_id=$2 AND g.revoked_at IS NULL
      AND g.valid_from<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint
      AND (g.valid_until IS NULL OR g.valid_until>floor(extract(epoch FROM clock_timestamp())*1000)::bigint) FOR SHARE OF g`,
      [cfg.operator.uid, cfg.operator.grant],
    );
    check(r);
    const result = await work(client, { userRevision: r.ur, grantRevision: r.gr });
    await guard.assertSession(client, ctx.handle);
    // Time may have passed while waiting for a concurrent command. Recheck qualification before returning.
    const final = await client.query(
      `SELECT 1 FROM zhiban_identity.system_admin_grants WHERE grant_id=$1 AND user_id=$2
      AND repository_revision=$3 AND revoked_at IS NULL AND valid_from<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint
      AND (valid_until IS NULL OR valid_until>floor(extract(epoch FROM clock_timestamp())*1000)::bigint)`,
      [cfg.operator.grant, cfg.operator.uid, r.gr],
    );
    check(final.rowCount === 1);
    return result;
  });
}
export async function prepareAccountStatus(
  cfg: MemberControlConfig,
  pools: Pools,
  target: string,
  action: StatusAction,
  reason: StatusReason,
) {
  userId(target);
  check(['USER_DISABLE', 'USER_RESTORE'].includes(action) && statusReasons.includes(reason));
  return operator(cfg, pools, async (ctx) => {
    const draft = await readGuarded(cfg, pools, ctx, target, async (client, facts) => {
      const {
        rows: [u],
      } = await client.query(
        'SELECT status,repository_revision::text AS revision FROM zhiban_identity.users WHERE user_id=$1',
        [target],
      );
      check(u && u.status === (action === 'USER_DISABLE' ? 'ACTIVE' : 'DISABLED'));
      const at = Date.now();
      const m: ControlApprovalManifest = {
        approval_id: ctx.ids.nextCommandId(),
        purpose: action,
        environment_ref: cfg.authority.environment,
        approval_ref: ctx.ids.nextCommandId(),
        operator_ref: 'LOCAL_SYNTHETIC_OPERATOR',
        approver_ref: 'LOCAL_SYNTHETIC_APPROVER',
        operator_user_id: cfg.operator.uid,
        expected_operator_user_revision: facts.userRevision,
        system_admin_grant_id: cfg.operator.grant,
        expected_admin_grant_revision: facts.grantRevision,
        command_id: ctx.ids.nextCommandId(),
        manifest_digest: '0'.repeat(64),
        catalog_digest: (await ctx.c.catalog.load()).contentDigest,
        action_version: 'identity-v1',
        delegation_version: 'identity-v1',
        target_user_id: target,
        expected_user_revision: u.revision,
        tenant_id: null,
        planned_user_id: null,
        planned_tenant_id: null,
        target_membership_id: null,
        planned_membership_id: null,
        planned_grant_id: null,
        expected_tenant_revision: null,
        expected_member_revision: null,
        expected_auth_version: null,
        valid_until: null,
        tenant_code: null,
        tenant_display_name: null,
        admission_purpose: null,
        issued_at: String(at - 1),
        expires_at: String(
          at + Math.min(1799999, cfg.composition.membership.policy.sourceTtlMs - 1),
        ),
        reason,
      };
      return { ...m, manifest_digest: controlManifestDigest(m) };
    });
    const dir = join(cfg.authority.root, 'account-status-approvals');
    await mkdir(dir, { mode: 0o700, recursive: true });
    await privatePath(dir, true);
    const bytes = Buffer.from(JSON.stringify(draft)),
      signatures = [];
    for (const role of ['operator', 'approver']) {
      const p = join(cfg.authority.root, `member-${role}.pem`);
      await privatePath(p);
      signatures.push(sign(null, bytes, await readFile(p)).toString('base64'));
    }
    await writeFile(
      join(dir, draft.approval_ref + '.json'),
      JSON.stringify({
        kind: 'LOCAL_SYNTHETIC_GLOBAL_ACCOUNT_STATUS',
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        manifest: draft,
        operatorSignature: signatures[0],
        approverSignature: signatures[1],
      }),
      { mode: 0o400, flag: 'wx' },
    );
    return {
      operationRef: draft.approval_ref,
      commandId: draft.command_id,
      userId: target,
      action,
      reason,
      expectedRevision: draft.expected_user_revision,
      expectedStatus: action === 'USER_DISABLE' ? 'ACTIVE' : 'DISABLED',
      resultStatus: action === 'USER_DISABLE' ? 'DISABLED' : 'ACTIVE',
      expiresAt: draft.expires_at,
      impact:
        'ALL_SPACES; disable revokes all existing sessions; restore requires fresh login and current memberships/grants/Enrollment',
      state: 'PREPARED_NOT_APPLIED',
    };
  });
}
async function inspectIn(
  cfg: MemberControlConfig,
  pools: Pools,
  ctx: Parameters<Parameters<typeof operator>[2]>[0],
  m: ControlApprovalManifest,
) {
  return readGuarded(cfg, pools, ctx, m.target_user_id!, async (client) => {
    const {
      rows: [u],
    } = await client.query(
      'SELECT status,repository_revision::text AS revision FROM zhiban_identity.users WHERE user_id=$1',
      [m.target_user_id],
    );
    check(u);
    const {
      rows: [a],
    } = await client.query(
      'SELECT consumed_at FROM zhiban_identity.identity_control_approvals WHERE approval_id=$1',
      [m.approval_id],
    );
    const {
      rows: [proof],
    } = await client.query(
      `SELECT c.action,c.actor_user_id,c.intent_digest,c.approval_id,c.outcome_kind,e.target_kind,e.target_user_id,
      e.before_revision::text,e.after_revision::text,e.after_status,e.audit_event_id::text
      FROM zhiban_identity.identity_control_commands c JOIN zhiban_identity.identity_control_command_effects e USING(command_id)
      WHERE c.command_id=$1`,
      [m.command_id],
    );
    if (proof)
      check(
        a?.consumed_at !== null &&
          a &&
          proof.action === m.purpose &&
          proof.actor_user_id === m.operator_user_id &&
          proof.intent_digest === controlIntentDigest(m) &&
          proof.approval_id === m.approval_id &&
          proof.target_kind === 'USER' &&
          proof.target_user_id === m.target_user_id &&
          proof.before_revision === m.expected_user_revision &&
          proof.after_status === (m.purpose === 'USER_DISABLE' ? 'DISABLED' : 'ACTIVE') &&
          typeof proof.audit_event_id === 'string' &&
          /^[1-9][0-9]*$/.test(proof.audit_event_id),
      );
    else check(!a || a.consumed_at === null);
    return {
      operationRef: m.approval_ref,
      commandId: m.command_id,
      userId: m.target_user_id,
      action: m.purpose,
      reason: m.reason,
      approvalRegistered: !!a,
      sourceExpired: BigInt(m.expires_at) <= BigInt(Date.now()),
      status: u.status,
      revision: u.revision,
      outcome: proof
        ? u.revision === proof.after_revision && u.status === proof.after_status
          ? 'APPLIED_CURRENT'
          : 'APPLIED_SUPERSEDED'
        : 'NOT_APPLIED',
      auditEventId: proof?.audit_event_id ?? null,
      appliedRevision: proof?.after_revision ?? null,
    };
  });
}
export async function inspectAccountStatus(cfg: MemberControlConfig, pools: Pools, ref: string) {
  return operator(cfg, pools, async (ctx) => {
    const m = await ctx.store.load(ref);
    check(m);
    return inspectIn(cfg, pools, ctx, m);
  });
}
export async function executeAccountStatus(
  cfg: MemberControlConfig,
  pools: Pools,
  ref: string,
  confirmation = false,
) {
  return operator(cfg, pools, async (ctx) => {
    const m = await ctx.store.load(ref);
    check(m && ctx.c.control);
    let revision = m.expected_user_revision!;
    if (confirmation) {
      const state = await inspectIn(cfg, pools, ctx, m);
      check(state.outcome === 'APPLIED_CURRENT');
      revision = state.revision;
    } else {
      const {
        rows: [a],
      } = await pools.control.query(
        'SELECT consumed_at FROM zhiban_identity.identity_control_approvals WHERE approval_id=$1',
        [m.approval_id],
      );
      check(!a || a.consumed_at === null); // Unknown completed outcome requires explicit inspect/confirm, never automatic replay.
      if (!a)
        await ctx.c.control.registerApproval(
          ctx.handle,
          ref,
          cfg.operator.password,
          observedTransport('127.0.0.1'),
          ctx.ids.nextCommandId(),
        );
    }
    const result = await ctx.c.control.execute(
      ctx.handle,
      {
        approvalRef: ref,
        idempotencyKey: m.command_id,
        requestId: ctx.ids.nextCommandId(),
        expectedUserRevision: repositoryRevision(revision),
        expectedTenantRevision: null,
      },
      cfg.operator.password,
      observedTransport('127.0.0.1'),
    );
    return {
      operationRef: ref,
      ...result,
      globalStatus: m.purpose === 'USER_DISABLE' ? 'DISABLED' : 'ACTIVE',
      confirmation,
    };
  });
}
