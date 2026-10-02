import { hash, verify, type Options } from '@node-rs/argon2';
import type { PasswordHashingPort, PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';
import type { PasswordScreeningPort } from '@/lib/zhiban/application/identity/ports/password-screening';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { issueRehashProof, issueVerifier, validateVerifier, verifierMaterial } from './verifier-material';
import { sanitizedCredentialError } from './credential-errors';

// OWASP minimum is 19 MiB/t=2/p=1. One policy in production AND tests.
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
// Provider's ambient const enum values: Argon2id=2, V0x13=1 (isolatedModules compatible).
export const PASSWORD_HASH_POLICY: Readonly<Options> = Object.freeze({ algorithm: 2, version: 1, memoryCost: 32768, timeCost: 3, parallelism: 1, outputLen: 32 });
// Baseline obvious/common patterns are always rejected. Full compromised-corpus screening
// is mandatory for real password creation; no configured screening => fail closed.
const blocked = new Set(['passwordpassword', '123456789012345', 'qwertyqwertyqwerty', 'letmeinletmeinletmein', 'footballfootball', 'basketballbasketball', 'mychemicalromance', 'qwertyuiopasdfghjkl']);
let activeKdfJobs = 0;
export function validSecret(secret: unknown, creation = false): secret is string {
  return typeof secret === 'string' && secret.length <= 1024 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(secret) &&
    Buffer.byteLength(secret, 'utf8') <= 1024 && [...secret].length >= (creation ? 15 : 1) && (!creation || !blocked.has(secret.toLowerCase()));
}
/** Bounded KDF admission: no queued raw secrets, no lower-cost test policy. */
export class Argon2PasswordHasher implements PasswordHashingPort {
  constructor(private readonly screening: PasswordScreeningPort) {}
  private async work<T>(fn: () => Promise<T>): Promise<T> {
    if (activeKdfJobs >= 2) throw new IdentityPortError('UNAVAILABLE');
    activeKdfJobs++;
    try { return await fn(); }
    catch (error) {
      // Even an injected screening/provider IdentityPortError may carry a secret cause.
      throw new IdentityPortError(sanitizedCredentialError(error).code === 'INTEGRITY_FAILURE' ? 'INTEGRITY_FAILURE' : 'UNAVAILABLE');
    }
    finally { activeKdfJobs--; }
  }
  async hash(secret: string) {
    if (!validSecret(secret, true)) throw new IdentityPortError('INTEGRITY_FAILURE');
    return this.work(async () => {
      if (!this.screening || await this.screening.isCompromised(secret) !== false) throw new IdentityPortError('INTEGRITY_FAILURE');
      return issueVerifier(await hash(secret, PASSWORD_HASH_POLICY));
    });
  }
  async verify(secret: string, verifier: PasswordVerifierHandle) {
    const encoded = verifierMaterial(verifier);
    validateVerifier(encoded);
    if (!validSecret(secret)) return false;
    return this.work(() => verify(encoded, secret));
  }
  needsRehash(verifier: PasswordVerifierHandle) {
    const policy = validateVerifier(verifierMaterial(verifier));
    // Never downgrade a stronger accepted encoding.
    return policy.memoryCost <= 32768 && policy.timeCost <= 3 && (policy.memoryCost < 32768 || policy.timeCost < 3);
  }
  async rehashVerified(secret: string, verifier: PasswordVerifierHandle) {
    if (!await this.verify(secret, verifier) || !this.needsRehash(verifier)) return null;
    return this.work(async () => issueRehashProof(verifierMaterial(verifier), await hash(secret, PASSWORD_HASH_POLICY)));
  }
}
