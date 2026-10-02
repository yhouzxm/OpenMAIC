import type { PasswordRehashHandle, PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';

// Exact-import Infrastructure boundary. Never re-export through a business barrel.
const verifiers = new WeakMap<object, string>();
const proofs = new WeakMap<object, { before: string; after: string }>();
function invalid(): never { throw new IdentityPortError('INTEGRITY_FAILURE'); }
export function validateVerifier(encoded: unknown): { memoryCost: number; timeCost: number } {
  if (typeof encoded !== 'string' || encoded.length > 1024) invalid();
  const match = /^\$argon2id\$v=19\$m=([1-9][0-9]{0,5}),t=([1-9][0-9]?),p=1\$([A-Za-z0-9+/]{22,43})\$([A-Za-z0-9+/]{43})$/.exec(encoded);
  if (!match) invalid();
  const memoryCost = Number(match[1]), timeCost = Number(match[2]);
  if (memoryCost < 19456 || memoryCost > 65536 || timeCost < 2 || timeCost > 4) invalid();
  for (const part of [match[3], match[4]]) {
    const bytes = Buffer.from(part, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== part) invalid();
  }
  return { memoryCost, timeCost };
}
export function issueVerifier(encoded: string): PasswordVerifierHandle {
  validateVerifier(encoded);
  const handle = Object.freeze({ kind: 'PASSWORD_VERIFIER_HANDLE' as const });
  verifiers.set(handle, encoded);
  return handle;
}
export function verifierMaterial(handle: PasswordVerifierHandle): string {
  const value = typeof handle === 'object' && handle !== null ? verifiers.get(handle) : undefined;
  if (value === undefined) invalid();
  return value;
}
export function issueRehashProof(before: string, after: string): PasswordRehashHandle {
  validateVerifier(before); validateVerifier(after);
  const handle = Object.freeze({ kind: 'PASSWORD_REHASH_HANDLE' as const });
  proofs.set(handle, { before, after });
  return handle;
}
export function rehashMaterial(proof: PasswordRehashHandle, current: string): string {
  const value = typeof proof === 'object' && proof !== null ? proofs.get(proof) : undefined;
  if (!value || value.before !== current) invalid();
  return value.after;
}
