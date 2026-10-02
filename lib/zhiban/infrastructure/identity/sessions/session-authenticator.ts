import { AsyncLocalStorage } from 'node:async_hooks';
import type { CredentialVerificationRequest } from '@/lib/zhiban/application/identity/ports/credential-verifier';
import type { PasswordHashingPort } from '@/lib/zhiban/application/identity/ports/password-hashing';
import type { RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { Instant } from '@/lib/zhiban/domain/identity';
import { CredentialVerifier } from '../credentials/credential-verifier';
import { sanitizedCredentialError } from '../credentials/credential-errors';
import type {
  CredentialVerificationSnapshot,
  PostgresCredentialRepository,
} from '../postgres/repositories/credential';
import type { PostgresSessionRepository } from '../postgres/repositories/session';
import { newApprovedSession } from './session-material';

interface Attempt {
  snapshot?: CredentialVerificationSnapshot;
  userRevision?: RepositoryRevision;
}
/** Protocol-neutral credential/session composition. Never caches input secret or returns verifier. */
export class SessionAuthenticator {
  private constructor(
    private readonly verifier: CredentialVerifier,
    private readonly attempts: AsyncLocalStorage<Attempt>,
    private readonly sessions: PostgresSessionRepository,
  ) {}
  static async create(
    credentials: Pick<PostgresCredentialRepository, 'verificationSnapshot' | 'stillCurrent'>,
    sessions: PostgresSessionRepository,
    hashing: PasswordHashingPort,
  ) {
    const attempts = new AsyncLocalStorage<Attempt>();
    const verifier = await CredentialVerifier.create(
      {
        async verificationSnapshot(id) {
          const snapshot = await credentials.verificationSnapshot(id);
          const attempt = attempts.getStore();
          if (snapshot && attempt) {
            const revision = await sessions.authenticationUserRevision(id);
            if (revision !== null) {
              attempt.snapshot = snapshot;
              attempt.userRevision = revision;
            }
          }
          return snapshot;
        },
        stillCurrent: (snapshot) => credentials.stillCurrent(snapshot),
      },
      hashing,
    );
    return new SessionAuthenticator(verifier, attempts, sessions);
  }
  async issue(request: CredentialVerificationRequest, at: Instant) {
    try {
      return await this.attempts.run({}, async () => {
        const result = await this.verifier.verifyCredential(request);
        const attempt = this.attempts.getStore()!;
        if (result.status !== 'VERIFIED' || !attempt.snapshot || !attempt.userRevision) return null;
        const issued = newApprovedSession(
          attempt.snapshot,
          attempt.userRevision,
          at,
          this.sessions.policy,
        );
        const session = await this.sessions.create(issued.record);
        return Object.freeze({ session, bearer: issued.bearer });
      });
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
}
