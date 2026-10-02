/** Security-only exact import. Handles carry no serializable verifier/provider fields. */
export interface PasswordVerifierHandle { readonly kind: 'PASSWORD_VERIFIER_HANDLE' }
export interface PasswordRehashHandle { readonly kind: 'PASSWORD_REHASH_HANDLE' }

export interface PasswordHashingPort {
  hash(secret: string): Promise<PasswordVerifierHandle>;
  verify(secret: string, verifier: PasswordVerifierHandle): Promise<boolean>;
  needsRehash(verifier: PasswordVerifierHandle): boolean;
  /** Issues same-secret proof, not a reset capability; null when wrong/already current. */
  rehashVerified(secret: string, verifier: PasswordVerifierHandle): Promise<PasswordRehashHandle | null>;
}
