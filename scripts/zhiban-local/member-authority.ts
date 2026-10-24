/** Explicit synthetic authority for the owned LOCAL PG16 host only; never a web endpoint. */
import { generateKeyPairSync, sign, verify, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { Pool } from 'pg';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  controlManifestDigest,
  type ControlApprovalManifest,
  type MembershipOperatorApprovalStore,
} from '@/lib/zhiban/infrastructure/identity/composition/control-approval';
import {
  createIdentityComposition,
  type IdentityCompositionConfig,
} from '@/lib/zhiban/infrastructure/identity/composition/root';
import { observedTransport } from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { bearerForCookie } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
function check(v: unknown): asserts v {
  if (!v) throw Error('LOCAL member authority rejected');
}
async function privatePath(p: string, dir = false) {
  const s = await lstat(p);
  check(
    !s.isSymbolicLink() &&
      s.uid === process.getuid?.() &&
      !(s.mode & 0o077) &&
      (dir ? s.isDirectory() : s.isFile()),
  );
}
export type Authority = {
  root: string;
  environment: string;
  operatorPublic: string;
  approverPublic: string;
};
export async function createLocalAuthority(root: string, environment: string): Promise<Authority> {
  check(dirname(root) === tmpdir() && root.startsWith(join(tmpdir(), 'zhiban-trial-content-')));
  await privatePath(root, true);
  await mkdir(join(root, 'member-approvals'), { mode: 0o700 });
  const keys = ['operator', 'approver'] as const;
  const out: Record<string, string> = {};
  for (const role of keys) {
    const k = generateKeyPairSync('ed25519');
    out[role] = String(k.publicKey.export({ format: 'pem', type: 'spki' }));
    await writeFile(
      join(root, `member-${role}.pem`),
      k.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      { mode: 0o600, flag: 'wx' },
    );
  }
  return { root, environment, operatorPublic: out.operator, approverPublic: out.approver };
}
export function localAuthorityStore(a: Authority): MembershipOperatorApprovalStore {
  const pins = [a.operatorPublic, a.approverPublic];
  check(pins[0] !== pins[1]);
  return Object.freeze({
    async load(ref: string) {
      check(/^[0-9a-f-]{36}$/.test(ref));
      await privatePath(a.root, true);
      await privatePath(join(a.root, 'member-approvals'), true);
      const path = join(a.root, 'member-approvals', ref + '.json');
      await privatePath(path);
      const e = JSON.parse(await readFile(path, 'utf8'));
      check(
        Object.keys(e).sort().join(',') ===
          'approverSignature,evidenceOrigin,githubActions,kind,manifest,operatorSignature',
      );
      check(
        e.kind === 'LOCAL_SYNTHETIC_TWO_AUTHORITY_MEMBER_ADMISSION' &&
          e.evidenceOrigin === 'LOCAL' &&
          e.githubActions === false,
      );
      const bytes = Buffer.from(JSON.stringify(e.manifest));
      check(
        verify(null, bytes, pins[0], Buffer.from(e.operatorSignature, 'base64')) &&
          verify(null, bytes, pins[1], Buffer.from(e.approverSignature, 'base64')),
      );
      check(
        e.manifest.environment_ref === a.environment &&
          e.manifest.purpose === 'MEMBER_ADMISSION' &&
          e.manifest.approval_ref === ref &&
          e.manifest.operator_ref === 'LOCAL_SYNTHETIC_OPERATOR' &&
          e.manifest.approver_ref === 'LOCAL_SYNTHETIC_APPROVER',
      );
      return Object.freeze(e.manifest) as ControlApprovalManifest;
    },
  });
}
export type MemberControlConfig = {
  kind: 'LOCAL_SYNTHETIC_MEMBER_CONTROL';
  authority: Authority;
  teacherRelationshipFingerprint?: string;
  operator: { uid: string; password: string; grant: string };
  composition: Omit<IdentityCompositionConfig, 'admission' | 'membership'> & {
    admission: Omit<IdentityCompositionConfig['admission'], 'hmacKey'> & { hmacKey: string };
    membership: {
      policy: {
        environmentRef: string;
        approvalRef: string;
        tenantRecordCapacity: number;
        controlRecordCapacity: number;
        sourceTtlMs: number;
      };
    };
  };
};
export async function issueLocalAdmission(
  a: Authority,
  c: Awaited<ReturnType<typeof createIdentityComposition>>,
  controlPool: Pool,
  operator: MemberControlConfig['operator'],
  tenant: string,
  uid: string,
  purpose: 'INVITE' | 'REACTIVATE' | 'REJOIN',
  versions: { id: string; revision: string; authorizationVersion: number } | null,
) {
  const ids = new IdentityIds(),
    snapshot = await c.catalog.load(),
    at = Date.now();
  check(c.control);
  const user = (
    await controlPool.query(
      'SELECT repository_revision FROM zhiban_identity.users WHERE user_id=$1',
      [uid],
    )
  ).rows[0];
  const t = (
    await controlPool.query(
      'SELECT repository_revision FROM zhiban_identity.tenants WHERE tenant_id=$1',
      [tenant],
    )
  ).rows[0];
  // No tenant-row direct access through C: caller supplies current member versions via a safe point read below.
  const transport = observedTransport('127.0.0.1');
  const logged = await c.security.login(
    operator.uid,
    operator.password,
    transport,
    ids.nextCommandId(),
  );
  check(logged.status === 'ISSUED');
  const h = await c.security.authenticate(bearerForCookie(logged.bearer));
  check(h && user && t);
  const draft: ControlApprovalManifest = {
    approval_id: ids.nextCommandId(),
    purpose: 'MEMBER_ADMISSION',
    environment_ref: a.environment,
    approval_ref: ids.nextCommandId(),
    operator_ref: 'LOCAL_SYNTHETIC_OPERATOR',
    approver_ref: 'LOCAL_SYNTHETIC_APPROVER',
    operator_user_id: operator.uid,
    expected_operator_user_revision: '1',
    system_admin_grant_id: operator.grant,
    expected_admin_grant_revision: '1',
    command_id: ids.nextCommandId(),
    manifest_digest: '0'.repeat(64),
    catalog_digest: snapshot.contentDigest,
    action_version: 'identity-v1',
    delegation_version: 'identity-v1',
    target_user_id: uid,
    tenant_id: tenant,
    planned_user_id: null,
    planned_tenant_id: null,
    planned_membership_id: null,
    planned_grant_id: null,
    target_membership_id: versions?.id ?? null,
    expected_user_revision: String(user.repository_revision),
    expected_tenant_revision: String(t.repository_revision),
    expected_member_revision: versions?.revision ?? null,
    expected_auth_version: versions ? String(versions.authorizationVersion) : null,
    valid_until: null,
    tenant_code: null,
    tenant_display_name: null,
    admission_purpose: purpose,
    issued_at: String(at - 1000),
    expires_at: String(at + 1799000),
    reason: 'ADMIN_REQUEST',
  };
  const m = { ...draft, manifest_digest: controlManifestDigest(draft) },
    bytes = Buffer.from(JSON.stringify(m));
  const signatures = [];
  for (const role of ['operator', 'approver']) {
    const p = join(a.root, `member-${role}.pem`);
    await privatePath(p);
    signatures.push(sign(null, bytes, await readFile(p)).toString('base64'));
  }
  await writeFile(
    join(a.root, 'member-approvals', m.approval_ref + '.json'),
    JSON.stringify({
      kind: 'LOCAL_SYNTHETIC_TWO_AUTHORITY_MEMBER_ADMISSION',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      manifest: m,
      operatorSignature: signatures[0],
      approverSignature: signatures[1],
    }),
    { mode: 0o400, flag: 'wx' },
  );
  try {
    await c.control.registerApproval(
      h,
      m.approval_ref,
      operator.password,
      transport,
      ids.nextCommandId(),
    );
    const result = await c.control.execute(
      h,
      {
        approvalRef: m.approval_ref,
        idempotencyKey: m.command_id,
        requestId: ids.nextCommandId(),
        expectedUserRevision: repositoryRevision(m.expected_user_revision!),
        expectedTenantRevision: repositoryRevision(m.expected_tenant_revision!),
      },
      operator.password,
      transport,
    );
    check(result.admissionId);
    return result.admissionId;
  } finally {
    await c.security.logout(h, ids.nextCommandId());
  }
}
export async function writeControlConfig(path: string, value: MemberControlConfig) {
  const bytes = JSON.stringify(value);
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  return hash(bytes);
}
