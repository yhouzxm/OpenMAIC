import {
  IdentityPortError,
  type IdentityPortErrorCode,
} from '@/lib/zhiban/application/identity/ports/errors';
import { preserveRefusal } from '../composition/refusals';

const codes: readonly IdentityPortErrorCode[] = [
  'CONFLICT',
  'STALE_WRITE',
  'TENANT_SCOPE_VIOLATION',
  'INTEGRITY_FAILURE',
  'RETRYABLE_PERSISTENCE_FAILURE',
  'UNAVAILABLE',
];

/** Credential boundary: never forward caller/provider/driver errors, causes or custom fields. */
export function sanitizedCredentialError(error: unknown): IdentityPortError {
  let code: unknown;
  try {
    if (error instanceof IdentityPortError) {
      const field = Object.getOwnPropertyDescriptor(error, 'code');
      code = field && 'value' in field ? field.value : undefined;
    }
  } catch {
    /* A hostile Proxy is not a source of error details. */
  }
  return preserveRefusal(
    error,
    new IdentityPortError(
      typeof code === 'string' && codes.includes(code as IdentityPortErrorCode)
        ? (code as IdentityPortErrorCode)
        : 'UNAVAILABLE',
    ),
  );
}
