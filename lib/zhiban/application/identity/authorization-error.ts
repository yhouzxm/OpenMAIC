import type { DenialReason } from '@/lib/zhiban/domain/identity/policies/authorization';

const reasons: readonly DenialReason[] = [
  'INVALID_FACTS',
  'INACTIVE_IDENTITY',
  'TENANT_MISMATCH',
  'NO_EFFECTIVE_GRANT',
  'UNSUPPORTED_ACTION',
  'CATALOG_UNAVAILABLE',
  'PERMISSION_SCOPE_MISMATCH',
  'RELATIONSHIP_DENIED',
  'RESOURCE_STATE_DENIED',
  'STALE_AUTHORIZATION',
  'DELEGATION_DENIED',
  'LAST_ADMIN_REQUIRED',
  'STORAGE_UNAVAILABLE',
];
const issued = new WeakSet<object>();

/** Closed internal error, never SQL/driver details. Public normalization belongs to 1B-8. */
export class AuthorizationRejected extends Error {
  public readonly reason: DenialReason;
  constructor(reason: DenialReason) {
    super('Authorization rejected.');
    this.reason = reasons.includes(reason) ? reason : 'INVALID_FACTS';
    this.name = 'AuthorizationRejected';
    issued.add(this);
    Object.freeze(this);
  }
}

/** Prevent a forged Error prototype/cause from bypassing Port sanitization. */
export function isAuthorizationRejected(value: unknown): value is AuthorizationRejected {
  return typeof value === 'object' && value !== null && issued.has(value);
}
