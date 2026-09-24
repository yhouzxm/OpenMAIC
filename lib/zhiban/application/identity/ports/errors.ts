export type IdentityPortErrorCode =
  | 'CONFLICT'
  | 'STALE_WRITE'
  | 'TENANT_SCOPE_VIOLATION'
  | 'INTEGRITY_FAILURE'
  | 'UNAVAILABLE';

/** Infrastructure details and credentials must not be placed in this message. */
export class IdentityPortError extends Error {
  constructor(public readonly code: IdentityPortErrorCode) {
    super(code);
    this.name = 'IdentityPortError';
  }
}
