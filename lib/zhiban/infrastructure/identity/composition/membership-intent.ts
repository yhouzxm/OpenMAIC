import { createHash } from 'node:crypto';
import {
  userId,
  membershipId,
  tenantId,
  roleGrantId,
  roleCode,
  parseScope,
  instant,
} from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import {
  membershipCommandActions,
  controlCommandActions,
  type CompositionAction,
  type MembershipCommandTarget,
  type MembershipGrantProposal,
  type MembershipCommandRequest,
  type MembershipCompositionPolicy,
} from '@/lib/zhiban/application/identity/ports/membership-composition';
import { integrity, atPortBoundary } from '../postgres/repositories/repository-support';
import { sanitizedCredentialError } from '../credentials/credential-errors';
import { ref } from './support';

/** Only data properties of a closed record are accepted; accessors are never invoked. */
export function closedCompositionRecord(value: unknown, keys: readonly string[]) {
  integrity(
    typeof value === 'object' &&
      value !== null &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  integrity(
    Reflect.ownKeys(value).length === keys.length &&
      keys.every((k) => Object.hasOwn(descriptors, k) && 'value' in descriptors[k]),
  );
}
const record = closedCompositionRecord;
/** Dense ordinary arrays only; sparse slots/accessors/custom keys cannot alter
 * the intent between validation and the immutable command copy. */
export function closedCompositionArray(value: unknown, minimum: number, maximum: number) {
  integrity(
    Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length >= minimum &&
      value.length <= maximum,
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  integrity(
    Reflect.ownKeys(value).length === value.length + 1 &&
      Array.from({ length: value.length }, (_, i) => String(i)).every(
        (k) => Object.hasOwn(descriptors, k) && 'value' in descriptors[k],
      ),
  );
}
/** Fresh closed errors, including failures from trusted stores; no cause/custom properties survive. */
export async function membershipBoundary<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await atPortBoundary(work);
  } catch (error) {
    throw sanitizedCredentialError(error);
  }
}
function authVersion(value: unknown): asserts value is number {
  integrity(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}
export function compositionAction(value: unknown): CompositionAction {
  integrity(
    typeof value === 'string' &&
      [...membershipCommandActions, ...controlCommandActions].includes(value as CompositionAction),
  );
  return value as CompositionAction;
}
export function membershipCompositionPolicy(value: MembershipCompositionPolicy) {
  record(value, [
    'environmentRef',
    'approvalRef',
    'tenantRecordCapacity',
    'controlRecordCapacity',
    'sourceTtlMs',
  ]);
  ref(value.environmentRef);
  ref(value.approvalRef);
  for (const capacity of [value.tenantRecordCapacity, value.controlRecordCapacity])
    integrity(Number.isSafeInteger(capacity) && capacity > 0 && capacity <= 1000000);
  integrity(
    Number.isSafeInteger(value.sourceTtlMs) &&
      value.sourceTtlMs > 0 &&
      value.sourceTtlMs <= 86400000,
  );
  return Object.freeze({ ...value });
}
/** Canonical safe intent deliberately excludes concurrency conditions and ephemeral material. */
export function membershipIntent(request: MembershipCommandRequest, catalogDigest: string) {
  record(request, [
    'tenantId',
    'actorMembershipId',
    'expectedActorRevision',
    'expectedActorAuthorizationVersion',
    'expectedTenantRevision',
    'action',
    'idempotencyKey',
    'requestId',
    'targets',
  ]);
  tenantId(request.tenantId);
  membershipId(request.actorMembershipId);
  repositoryRevision(request.expectedActorRevision);
  repositoryRevision(request.expectedTenantRevision);
  authVersion(request.expectedActorAuthorizationVersion);
  ref(request.idempotencyKey);
  ref(request.requestId);
  integrity(
    membershipCommandActions.includes(request.action) &&
      /^[a-f0-9]{64}$(?![\s\S])/.test(catalogDigest),
  );
  closedCompositionArray(request.targets, 1, 2);
  const targets = request.targets.map((target: MembershipCommandTarget) => {
    record(target, [
      'userId',
      'membershipId',
      'expectedRevision',
      'expectedAuthorizationVersion',
      'action',
      'admissionId',
      'consentId',
      'grants',
      'preserveGrantIds',
      'revokeGrantId',
      'mode',
      'reason',
    ]);
    userId(target.userId);
    membershipId(target.membershipId);
    repositoryRevision(target.expectedRevision);
    authVersion(target.expectedAuthorizationVersion);
    integrity(
      membershipCommandActions.includes(target.action) &&
        ![
          'MEMBERSHIP_PENDING_CREATE',
          'MEMBERSHIP_CONSENT_RECORD',
          'MEMBERSHIP_ATOMIC_TRANSFER',
        ].includes(target.action),
    );
    integrity(request.action === 'MEMBERSHIP_ATOMIC_TRANSFER' || request.action === target.action);
    for (const locator of [target.admissionId, target.consentId, target.revokeGrantId])
      if (locator !== null) userId(locator);
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
      ].includes(target.reason),
    );
    integrity(target.reason !== 'ACCOUNT_RECOVERY' && target.reason !== 'CREDENTIAL_REJECTED');
    integrity(
      target.mode === null ||
        target.mode === 'PRESERVE_EXISTING_VALID_GRANTS' ||
        target.mode === 'REPLACE_GRANTS',
    );
    closedCompositionArray(target.grants, 0, 16);
    closedCompositionArray(target.preserveGrantIds, 0, 16);
    integrity(target.grants.length + target.preserveGrantIds.length <= 16);
    integrity((target.action === 'MEMBERSHIP_REACTIVATE') === (target.mode !== null));
    integrity(
      ['MEMBERSHIP_ACTIVATE', 'MEMBERSHIP_REACTIVATE', 'MEMBERSHIP_REJOIN'].includes(
        target.action,
      ) === (target.admissionId !== null && target.consentId !== null),
    );
    if (
      !['MEMBERSHIP_ACTIVATE', 'MEMBERSHIP_REACTIVATE', 'MEMBERSHIP_REJOIN'].includes(target.action)
    )
      integrity(target.admissionId === null && target.consentId === null);
    integrity((target.action === 'ROLE_REVOKE') === (target.revokeGrantId !== null));
    integrity(
      target.mode === 'PRESERVE_EXISTING_VALID_GRANTS'
        ? target.grants.length === 0
        : target.preserveGrantIds.length === 0,
    );
    if (['MEMBERSHIP_DISABLE', 'MEMBERSHIP_LEAVE_ADMIN', 'ROLE_REVOKE'].includes(target.action))
      integrity(target.grants.length === 0);
    if (target.action === 'ROLE_GRANT') integrity(target.grants.length === 1);
    const grants = target.grants
      .map((grant: MembershipGrantProposal) => {
        record(grant, ['roleCode', 'scope', 'validUntil']);
        const role = roleCode(grant.roleCode);
        record(grant.scope, ['type', 'scopeId']);
        const scope = parseScope(grant.scope.type, grant.scope.scopeId);
        const until = grant.validUntil === null ? null : instant(grant.validUntil);
        return [role, scope.type, scope.scopeId, until] as const;
      })
      .sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0,
      );
    const preserve = target.preserveGrantIds.map(roleGrantId).sort();
    integrity(
      new Set(preserve).size === preserve.length &&
        new Set(grants.map((g) => JSON.stringify(g))).size === grants.length,
    );
    return [
      target.userId,
      target.membershipId,
      target.action,
      target.admissionId,
      target.consentId,
      grants,
      preserve,
      target.revokeGrantId,
      target.mode,
      target.reason,
    ] as const;
  });
  integrity(new Set(targets.map((t) => t[1])).size === targets.length);
  // Target ordinal has transaction semantics; unlike grant sets, it is not sorted.
  return createHash('sha256')
    .update(
      JSON.stringify([
        'identity-member-command-v1',
        request.tenantId,
        request.actorMembershipId,
        request.action,
        targets,
        catalogDigest,
        'identity-v1',
        'identity-v1',
      ]),
    )
    .digest('hex');
}
