import {
  userId,
  tenantId,
  membershipId,
  roleGrantId,
  parseScope,
  roleCode,
  instant,
} from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { MembershipCommandTarget } from '@/lib/zhiban/application/identity/ports/membership-composition';
import { validSecret } from '../credentials/argon2-password-hasher';
import { ProtocolRefusal, invalid, record, integer, text } from './protocol';

export const actions = Object.freeze({
  activate: 'MEMBERSHIP_ACTIVATE',
  disable: 'MEMBERSHIP_DISABLE',
  leave: 'MEMBERSHIP_LEAVE_ADMIN',
  reactivate: 'MEMBERSHIP_REACTIVATE',
  rejoin: 'MEMBERSHIP_REJOIN',
  grant: 'ROLE_GRANT',
  'revoke-grant': 'ROLE_REVOKE',
  'replace-grants': 'ROLE_REPLACE',
} as const);
export const envelopeKeys = [
  'actorMembershipId',
  'expectedActorRevision',
  'expectedActorAuthorizationVersion',
  'expectedTenantRevision',
] as const;
export function validated<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof ProtocolRefusal) throw error;
    return invalid();
  }
}
export const uuid = (x: unknown) => validated(() => userId(x));
export const revision = (x: unknown) =>
  validated(() => repositoryRevision(text(x, /^[1-9][0-9]*$/)));
export const reference = (x: unknown) => text(x, /^[A-Za-z0-9._:-]{1,128}$/);
export function password(x: unknown, creation = false): string {
  if (!validSecret(x, creation)) invalid();
  return x;
}
export function envelope(b: Record<string, unknown>) {
  return {
    actorMembershipId: validated(() => membershipId(b.actorMembershipId)),
    expectedActorRevision: revision(b.expectedActorRevision),
    expectedActorAuthorizationVersion: integer(b.expectedActorAuthorizationVersion),
    expectedTenantRevision: revision(b.expectedTenantRevision),
  };
}
export function proposals(x: unknown) {
  if (!Array.isArray(x) || x.length > 16) invalid();
  return x.map((v) => {
    const r = record(v, ['roleCode', 'scope', 'validUntil']);
    const scope = record(r.scope, ['type', 'scopeId']);
    return {
      roleCode: validated(() => roleCode(r.roleCode)),
      scope: validated(() => parseScope(scope.type, scope.scopeId)),
      validUntil:
        r.validUntil === null
          ? null
          : validated(() => instant(integer(r.validUntil, 8640000000000000))),
    };
  });
}
export function targetFields(action: MembershipCommandTarget['action']): string[] {
  const base = ['expectedRevision', 'expectedAuthorizationVersion'];
  switch (action) {
    case 'MEMBERSHIP_ACTIVATE':
    case 'MEMBERSHIP_REJOIN':
      return [...base, 'admissionId', 'consentId', 'grants'];
    case 'MEMBERSHIP_REACTIVATE':
      return [...base, 'admissionId', 'consentId', 'mode'];
    case 'MEMBERSHIP_DISABLE':
      return [...base, 'reason'];
    case 'ROLE_GRANT':
      return [...base, 'grant'];
    case 'ROLE_REVOKE':
      return [...base, 'revokeGrantId'];
    case 'ROLE_REPLACE':
      return [...base, 'grants'];
    default:
      return base;
  }
}
export function target(
  b: Record<string, unknown>,
  action: MembershipCommandTarget['action'],
  user: unknown,
  member: unknown,
): MembershipCommandTarget {
  let grants: MembershipCommandTarget['grants'] = [],
    preserve: MembershipCommandTarget['preserveGrantIds'] = [],
    mode: MembershipCommandTarget['mode'] = null;
  if (['MEMBERSHIP_ACTIVATE', 'MEMBERSHIP_REJOIN', 'ROLE_REPLACE'].includes(action))
    grants = proposals(b.grants);
  if (action === 'ROLE_GRANT') grants = proposals([b.grant]);
  if (action === 'MEMBERSHIP_REACTIVATE') {
    if (b.mode === 'REPLACE_GRANTS') {
      mode = b.mode;
      grants = proposals(b.grants);
    } else if (b.mode === 'PRESERVE_EXISTING_VALID_GRANTS') {
      mode = b.mode;
      if (!Array.isArray(b.preserveGrantIds) || b.preserveGrantIds.length > 16) invalid();
      preserve = b.preserveGrantIds.map((x) => validated(() => roleGrantId(x)));
    } else invalid();
  }
  const sourced = ['MEMBERSHIP_ACTIVATE', 'MEMBERSHIP_REACTIVATE', 'MEMBERSHIP_REJOIN'].includes(
    action,
  );
  let reason: MembershipCommandTarget['reason'] = 'ADMIN_REQUEST';
  if (action === 'MEMBERSHIP_DISABLE') {
    if (!['ADMIN_REQUEST', 'ACCESS_REVIEW', 'SECURITY_POLICY'].includes(b.reason as string))
      invalid();
    reason = b.reason as typeof reason;
  }
  return {
    userId: uuid(user),
    membershipId: validated(() => membershipId(member)),
    expectedRevision: revision(b.expectedRevision),
    expectedAuthorizationVersion: integer(b.expectedAuthorizationVersion),
    action,
    admissionId: sourced ? uuid(b.admissionId) : null,
    consentId: sourced ? uuid(b.consentId) : null,
    grants,
    preserveGrantIds: preserve,
    revokeGrantId: action === 'ROLE_REVOKE' ? validated(() => roleGrantId(b.revokeGrantId)) : null,
    mode,
    reason,
  };
}
export function targetKeys(b: Record<string, unknown>, action: MembershipCommandTarget['action']) {
  return [
    ...targetFields(action),
    ...(action === 'MEMBERSHIP_REACTIVATE'
      ? [b.mode === 'PRESERVE_EXISTING_VALID_GRANTS' ? 'preserveGrantIds' : 'grants']
      : []),
  ];
}
export const tenant = (x: unknown) => validated(() => tenantId(x));
