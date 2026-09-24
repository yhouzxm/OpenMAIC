export type IdentityErrorCode =
  | 'INVALID_ID'
  | 'INVALID_TIME'
  | 'INVALID_SCOPE'
  | 'INVALID_PERMISSION'
  | 'INVALID_ROLE'
  | 'INVALID_ROLE_GRANT'
  | 'INVALID_STATE_TRANSITION'
  | 'INVALID_VALIDITY_WINDOW'
  | 'INVALID_ENTITY'
  | 'REACTIVATION_MODE_REQUIRED'
  | 'UNAPPROVED_GRANT_REACTIVATION'
  | 'AUTHORIZATION_VERSION_CONFLICT';

export class IdentityDomainError extends Error {
  constructor(
    public readonly code: IdentityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityDomainError';
  }
}

export function invariant(
  condition: unknown,
  code: IdentityErrorCode,
  message: string,
): asserts condition {
  if (!condition) throw new IdentityDomainError(code, message);
}

export function nonBlank(value: string): string {
  invariant(
    typeof value === 'string' && value.trim().length > 0,
    'INVALID_ENTITY',
    'Text is required.',
  );
  return value.trim();
}
