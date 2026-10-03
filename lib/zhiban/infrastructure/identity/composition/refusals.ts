import { AsyncLocalStorage } from 'node:async_hooks';
import {
  IdentityPortError,
  type IdentityPortErrorCode,
} from '@/lib/zhiban/application/identity/ports/errors';

export type Refusal =
  | 'SESSION_REJECTED'
  | 'REAUTH_REJECTED'
  | 'TARGET_HIDDEN'
  | 'POLICY_DENIED'
  | 'REQUEST_STALE'
  | 'ADMISSION_DENIED'
  | 'PASSWORD_POLICY_REJECTED';
const scopes = new AsyncLocalStorage<WeakMap<object, Refusal>>();
/** Private collaborator: only an immediately thrown, trusted refusal can be observed. */
export function refuse(tag: Refusal, code: IdentityPortErrorCode = 'CONFLICT'): never {
  const error = new IdentityPortError(code);
  scopes.getStore()?.set(error, tag);
  throw error;
}
/** Sanitization preserves authority by object identity, never by a caller error field. */
export function preserveRefusal(source: unknown, sanitized: IdentityPortError) {
  const scope = scopes.getStore();
  if (typeof source === 'object' && source !== null) {
    const tag = scope?.get(source);
    if (tag) scope!.set(sanitized, tag);
  }
  return sanitized;
}
export async function observeOperation<T>(
  work: () => Promise<T>,
): Promise<
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: Refusal | null }
> {
  return scopes.run(new WeakMap(), async () => {
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      return {
        ok: false,
        refusal:
          typeof error === 'object' && error !== null
            ? (scopes.getStore()!.get(error) ?? null)
            : null,
      };
    }
  });
}
