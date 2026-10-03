import { createHash } from 'node:crypto';
import {
  userId,
  tenantId,
  membershipId,
  roleGrantId,
  systemAdminGrantId,
} from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { IdentityAuditReason } from '@/lib/zhiban/application/identity/ports/audit';
import { controlCommandActions } from '@/lib/zhiban/application/identity/ports/membership-composition';
import { checkRow, checkedInteger, checkedText } from '../postgres/mappers/checked-values';
import { integrity } from '../postgres/repositories/repository-support';
import { ref } from './support';

/** Exact persisted safe fields. This record is not an Application/API DTO. */
export interface ControlApprovalFields {
  readonly approval_id: string;
  readonly purpose: string;
  readonly environment_ref: string;
  readonly approval_ref: string;
  readonly operator_ref: string;
  readonly approver_ref: string;
  readonly operator_user_id: string;
  readonly expected_operator_user_revision: string;
  readonly system_admin_grant_id: string;
  readonly expected_admin_grant_revision: string;
  readonly command_id: string;
  readonly manifest_digest: string;
  readonly catalog_digest: string;
  readonly action_version: string;
  readonly delegation_version: string;
  readonly target_user_id: string | null;
  readonly tenant_id: string | null;
  readonly planned_user_id: string | null;
  readonly planned_tenant_id: string | null;
  readonly target_membership_id: string | null;
  readonly planned_membership_id: string | null;
  readonly planned_grant_id: string | null;
  readonly expected_user_revision: string | null;
  readonly expected_tenant_revision: string | null;
  readonly expected_member_revision: string | null;
  readonly expected_auth_version: string | null;
  readonly valid_until: string | null;
  readonly tenant_code: string | null;
  readonly tenant_display_name: string | null;
  readonly admission_purpose: string | null;
  readonly issued_at: string;
  readonly expires_at: string;
}
export interface ControlApprovalManifest extends ControlApprovalFields {
  readonly reason: IdentityAuditReason;
}
/** Trusted independent evidence store must validate environment, two-person authority,
 * signature/approval and immutable full manifest. No default, HTTP/argv or fixture store. */
export interface MembershipOperatorApprovalStore {
  load(approvalRef: string): Promise<ControlApprovalManifest | null>;
}
export const controlApprovalFields = [
  'approval_id',
  'purpose',
  'environment_ref',
  'approval_ref',
  'operator_ref',
  'approver_ref',
  'operator_user_id',
  'expected_operator_user_revision',
  'system_admin_grant_id',
  'expected_admin_grant_revision',
  'command_id',
  'manifest_digest',
  'catalog_digest',
  'action_version',
  'delegation_version',
  'target_user_id',
  'tenant_id',
  'planned_user_id',
  'planned_tenant_id',
  'target_membership_id',
  'planned_membership_id',
  'planned_grant_id',
  'expected_user_revision',
  'expected_tenant_revision',
  'expected_member_revision',
  'expected_auth_version',
  'valid_until',
  'tenant_code',
  'tenant_display_name',
  'admission_purpose',
  'issued_at',
  'expires_at',
] as const;
export const nullableControlApprovalFields = [
  'target_user_id',
  'tenant_id',
  'planned_user_id',
  'planned_tenant_id',
  'target_membership_id',
  'planned_membership_id',
  'planned_grant_id',
  'expected_user_revision',
  'expected_tenant_revision',
  'expected_member_revision',
  'expected_auth_version',
  'valid_until',
  'tenant_code',
  'tenant_display_name',
  'admission_purpose',
] as const;
export function controlManifestDigest(input: ControlApprovalManifest) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'identity-control-manifest-v1',
        ...controlApprovalFields.filter((k) => k !== 'manifest_digest').map((k) => [k, input[k]]),
        ['reason', input.reason],
      ]),
    )
    .digest('hex');
}
export function controlManifest(
  input: ControlApprovalManifest,
  environment: string,
  catalogDigest: string,
  ttl: number,
) {
  checkRow(input, [...controlApprovalFields, 'reason'], nullableControlApprovalFields);
  integrity(
    controlCommandActions.includes(input.purpose as (typeof controlCommandActions)[number]),
  );
  for (const name of [
    'approval_id',
    'operator_user_id',
    'command_id',
    'target_user_id',
    'planned_user_id',
  ] as const)
    if (input[name] !== null) userId(input[name]);
  for (const name of ['tenant_id', 'planned_tenant_id'] as const)
    if (input[name] !== null) tenantId(input[name]);
  for (const name of ['target_membership_id', 'planned_membership_id'] as const)
    if (input[name] !== null) membershipId(input[name]);
  if (input.planned_grant_id !== null) roleGrantId(input.planned_grant_id);
  systemAdminGrantId(input.system_admin_grant_id);
  for (const name of ['environment_ref', 'approval_ref', 'operator_ref', 'approver_ref'] as const)
    ref(input[name]);
  integrity(
    input.environment_ref === environment &&
      input.operator_ref !== input.approver_ref &&
      input.catalog_digest === catalogDigest &&
      input.action_version === 'identity-v1' &&
      input.delegation_version === 'identity-v1',
  );
  for (const name of [
    'expected_operator_user_revision',
    'expected_admin_grant_revision',
    'expected_user_revision',
    'expected_tenant_revision',
    'expected_member_revision',
  ] as const)
    if (input[name] !== null) repositoryRevision(input[name]);
  if (input.expected_auth_version !== null)
    checkedInteger(input.expected_auth_version, BigInt('9007199254740991'));
  for (const name of ['issued_at', 'expires_at', 'valid_until'] as const)
    if (input[name] !== null) checkedInteger(input[name], BigInt('8640000000000000'));
  integrity(
    BigInt(input.expires_at) > BigInt(input.issued_at) &&
      BigInt(input.expires_at) - BigInt(input.issued_at) <= BigInt(ttl),
  );
  if (input.tenant_code !== null)
    integrity(/^[a-z][a-z0-9_-]{0,63}$(?![\s\S])/.test(input.tenant_code));
  if (input.tenant_display_name !== null) {
    checkedText(input.tenant_display_name);
    integrity(
      Buffer.byteLength(input.tenant_display_name, 'utf8') <= 256 &&
        input.tenant_display_name.trim().length > 0,
    );
  }
  integrity(
    [
      'ADMIN_REQUEST',
      'USER_REQUEST',
      'ACCESS_REVIEW',
      'SECURITY_POLICY',
      'INVITATION_EXPIRED',
      'ACCOUNT_RECOVERY',
      'CREDENTIAL_REJECTED',
      'SYSTEM_MAINTENANCE',
    ].includes(input.reason),
  );
  // Recovery is not authorized by using a pre-existing audit reason label.
  integrity(
    input.reason !== 'ACCOUNT_RECOVERY' &&
      /^[a-f0-9]{64}$(?![\s\S])/.test(input.manifest_digest) &&
      controlManifestDigest(input) === input.manifest_digest,
  );
  return Object.freeze({ ...input });
}
export function controlIntentDigest(manifest: ControlApprovalManifest) {
  const safeFields = controlApprovalFields.filter((k) => !k.startsWith('expected_'));
  return createHash('sha256')
    .update(
      JSON.stringify([
        'identity-control-command-v1',
        ...safeFields.map((k) => [k, manifest[k]]),
        ['reason', manifest.reason],
      ]),
    )
    .digest('hex');
}
