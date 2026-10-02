import { randomBytes } from 'node:crypto';
import { userId } from '@/lib/zhiban/domain/identity';
import type { CredentialVerificationRequest, CredentialVerificationResult, CredentialVerifierPort } from '@/lib/zhiban/application/identity/ports/credential-verifier';
import type { PasswordHashingPort, PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import type { PostgresCredentialRepository } from '../postgres/repositories/credential';
import { validSecret } from './argon2-password-hasher';
import { sanitizedCredentialError } from './credential-errors';

type VerificationStore = Pick<PostgresCredentialRepository, 'verificationSnapshot' | 'stillCurrent'>;
const rejected = Object.freeze({ status: 'REJECTED' as const });
const dummyInput = 'invalid-input-verification-only';
/** Process-local bounded admission. Public/IP/distributed budgets remain mandatory in 1B-8. */
export class CredentialVerifier implements CredentialVerifierPort {
  private active = 0;
  private readonly budgets = new Map<string, { count: number; until: number }>();
  private constructor(private readonly store: VerificationStore, private readonly hashing: PasswordHashingPort, private readonly dummy: PasswordVerifierHandle, private readonly now: () => number) {}
  static async create(store: VerificationStore, hashing: PasswordHashingPort, now: () => number = () => performance.now()) {
    try { return new CredentialVerifier(store, hashing, await hashing.hash(randomBytes(48).toString('base64')), now); }
    catch { throw new IdentityPortError('UNAVAILABLE'); }
  }
  async verifyCredential(request: CredentialVerificationRequest): Promise<CredentialVerificationResult> {
    try { return await this.verifyInput(request); }
    catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  private async verifyInput(request: CredentialVerificationRequest): Promise<CredentialVerificationResult> {
    // Never execute input getters or copy provider/request objects to errors.
    const identifier = typeof request === 'object' && request !== null ? Object.getOwnPropertyDescriptor(request, 'identifier') : undefined;
    const secret = typeof request === 'object' && request !== null ? Object.getOwnPropertyDescriptor(request, 'secret') : undefined;
    const locator: unknown = identifier && 'value' in identifier ? identifier.value : undefined;
    const input: unknown = secret && 'value' in secret ? secret.value : undefined;
    const canonical = typeof locator === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/.test(locator);
    const key = canonical ? locator : 'invalid';
    const now = this.now();
    let budget = this.budgets.get(key);
    if (!budget || now >= budget.until) { budget = { count: 0, until: now + 60000 }; this.budgets.delete(key); this.budgets.set(key, budget); }
    if (this.budgets.size > 1024) this.budgets.delete(this.budgets.keys().next().value!);
    if (this.active >= 2 || budget.count >= 10) throw new IdentityPortError('UNAVAILABLE');
    budget.count++; this.active++;
    try {
      const snapshot = canonical ? await this.store.verificationSnapshot(userId(locator)) : null;
      const valid = validSecret(input);
      const verified = await this.hashing.verify(valid ? input : dummyInput, valid && snapshot !== null ? snapshot.verifier : this.dummy);
      if (!canonical || !valid || snapshot === null || !verified || !await this.store.stillCurrent(snapshot)) return rejected;
      return Object.freeze({ status: 'VERIFIED', userId: snapshot.userId });
    } catch (error) {
      if (error instanceof IdentityPortError) throw error;
      throw new IdentityPortError('UNAVAILABLE');
    } finally { this.active--; }
  }
}
