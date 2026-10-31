/** Offline proposals only: digests are not approvals. No DB access or automatic signing. */
import { randomBytes } from 'node:crypto';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import { identityPermissions } from '@/lib/zhiban/domain/identity/policies/authorization';
import { ApprovedIdentityCatalog } from '@/lib/zhiban/infrastructure/identity/authorization/identity-catalog';
import {
  purposes,
  admissionPolicyDigest,
  type AdmissionPolicyRecord,
} from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { platformManifestDigest } from '@/lib/zhiban/infrastructure/identity/composition/operator';
import {
  controlManifestDigest,
  type ControlApprovalManifest,
} from '@/lib/zhiban/infrastructure/identity/composition/control-approval';
import { privateJson, saveJson, digest, check } from '@/lib/zhiban/infrastructure/production/files';
interface IdentityProposal {
  origin: string;
  environment: string;
  approvalRef: string;
  catalogApprovalRecord: string;
  corpus: { approvalRef: string; values: string[] };
  sessionPolicy: { absoluteMs: number; idleMs: number };
  membershipPolicy: {
    tenantRecordCapacity: number;
    controlRecordCapacity: number;
    sourceTtlMs: number;
  };
  admissionLimits: {
    windowMs: number;
    globalLimit: number;
    ipLimit: number;
    locatorLimit: number;
    pairLimit: number;
    userLimit: number;
    maxBuckets: number;
  };
  transportApprovalRef: string;
}
export async function identityProposal(path: string, output: string) {
  const c = await privateJson<IdentityProposal>(path),
    ids = new IdentityIds();
  check(
    new URL(c.origin).origin === c.origin &&
      ['http:', 'https:'].includes(new URL(c.origin).protocol),
    'Explicit HTTP or HTTPS origin required',
  );
  for (const ref of [
    c.environment,
    c.approvalRef,
    c.catalogApprovalRecord,
    c.corpus?.approvalRef,
    c.transportApprovalRef,
  ])
    check(
      typeof ref === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(ref),
      'Explicit policy approval references required',
    );
  check(
    Array.isArray(c.corpus.values) &&
      c.corpus.values.length > 0 &&
      c.corpus.values.every((v) => typeof v === 'string' && v.length > 0),
    'Approved compromised-password corpus required',
  );
  for (const policy of [c.sessionPolicy, c.membershipPolicy, c.admissionLimits])
    for (const n of Object.values(policy))
      check(Number.isSafeInteger(n) && n > 0, 'Explicit positive policy capacities required');
  const codes = ['STUDENT', 'TEACHER', 'TENANT_ADMIN'] as const;
  const roleIds = {
    STUDENT: ids.nextRoleId(),
    TEACHER: ids.nextRoleId(),
    TENANT_ADMIN: ids.nextRoleId(),
  };
  const roles = codes.map((code) => ({
    id: roleIds[code],
    code,
    permissions: identityPermissions[code],
  }));
  const catalog = {
    roleIds,
    approvalRecord: c.catalogApprovalRecord,
    expectedDigest: digest(
      JSON.stringify({
        version: 'identity-v1',
        actionVersion: 'identity-v1',
        delegationVersion: 'identity-v1',
        approvalRecord: c.catalogApprovalRecord,
        roles,
      }),
    ),
  };
  new ApprovedIdentityCatalog(catalog);
  const l = c.admissionLimits;
  const policies: AdmissionPolicyRecord[] = purposes.map((purpose) => {
    const initial = purpose === 'INITIAL_PROVISION';
    return {
      purpose,
      approval_ref: c.approvalRef,
      environment_ref: c.environment,
      created_at: String(Date.now()),
      window_ms: String(l.windowMs),
      global_limit: String(l.globalLimit),
      ip_limit: initial ? null : String(l.ipLimit),
      locator_limit: initial ? null : String(l.locatorLimit),
      pair_limit: initial ? null : String(l.pairLimit),
      user_limit: purpose === 'LOGIN' ? null : String(l.userLimit),
      max_buckets: String(l.maxBuckets),
    };
  });
  const policyDigests = Object.fromEntries(
    policies.map((p) => [p.purpose, admissionPolicyDigest(p)]),
  );
  const identity = {
    origin: c.origin,
    sessionPolicy: c.sessionPolicy,
    catalog,
    admission: {
      environment: c.environment,
      approvalRef: c.approvalRef,
      hmacKey: randomBytes(32).toString('hex'),
      policyDigests,
    },
    corpus: { ...c.corpus, expectedDigest: digest(JSON.stringify(c.corpus.values)) },
    operator: null,
    membership: {
      policy: { environmentRef: c.environment, approvalRef: c.approvalRef, ...c.membershipPolicy },
      operator: null,
    },
    transportApprovalRef: c.transportApprovalRef,
    deployment: c.origin.startsWith('https://') ? 'SINGLE_PROCESS_HTTPS' : 'SINGLE_PROCESS_HTTP',
  };
  await saveJson(
    output,
    {
      kind: 'ZHIBAN_IDENTITY_PROPOSAL_V1',
      status: 'REQUIRES_OPERATOR_REVIEW',
      identity,
      admissionPolicies: policies,
    },
    true,
  );
}
export async function firstAdministratorProposal(path: string, output: string) {
  const p = await privateJson<{
      environment: string;
      approvalRef: string;
      operatorRef: string;
      approverRef: string;
      validForSeconds: number;
    }>(path),
    ids = new IdentityIds();
  check(
    p.operatorRef !== p.approverRef &&
      Number.isInteger(p.validForSeconds) &&
      p.validForSeconds >= 60 &&
      p.validForSeconds <= 1800,
    'Independent named authorities and bounded approval TTL required',
  );
  for (const ref of [p.environment, p.approvalRef, p.operatorRef, p.approverRef])
    check(
      typeof ref === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(ref),
      'Explicit first administrator references required',
    );
  const at = Date.now(),
    draft = {
      purpose: 'FIRST_PLATFORM_ADMIN' as const,
      approvalId: ids.nextCommandId(),
      commandId: ids.nextCommandId(),
      userId: ids.nextUserId(),
      existingUserRevision: null,
      grantId: ids.nextSystemAdminGrantId(),
      provisionApprovalId: ids.nextCommandId(),
      environment: p.environment,
      approvalRef: p.approvalRef,
      operatorRef: p.operatorRef,
      approverRef: p.approverRef,
      requestId: ids.nextCommandId(),
      issuedAt: at,
      expiresAt: at + p.validForSeconds * 1000,
    };
  await saveJson(output, { ...draft, manifestDigest: platformManifestDigest(draft) }, true);
}
export async function digestControlProposal(path: string, output: string) {
  const p = await privateJson<ControlApprovalManifest>(path);
  await saveJson(output, { ...p, manifest_digest: controlManifestDigest(p) }, true);
}
