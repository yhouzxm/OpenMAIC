import type { PasswordHashingPort } from '@/lib/zhiban/application/identity/ports/password-hashing';
import type { TransactionPool } from '../postgres/transactions';
import { PostgresCredentialRepository } from '../postgres/repositories/credential';
import {
  sessionColumns,
  sessionFromRow,
  type SessionRow,
} from '../postgres/repositories/session-records';
import { digestBearer } from '../sessions/session-material';
import { run } from '../composition/support';
import { oneRow } from '../postgres/repositories/repository-support';
import { userId } from '@/lib/zhiban/domain/identity';
import { must, RecoveryError, time, revision } from './values';
import { randomLocator, sameSecret } from './material';
export interface RecoveryProof {
  readonly kind: 'RECOVERY_REQUEST_PROOF';
}
interface Proof {
  digest: string;
  user: string;
  userRevision: string;
  slotRevision: string;
  epoch: string;
  sessionId: string;
  intent: string;
  wall: number;
  mono: number;
  until: number;
}
/** Dedicated registry: cannot consume public/Membership/FIRST proof handles. */
export class RecoverySecurity {
  #proofs = new WeakMap<object, Proof>();
  #csrf = new Map<string, { proof: string; deadline: number }>();
  constructor(
    private readonly pool: TransactionPool,
    private readonly credentials: PostgresCredentialRepository,
    private readonly hashing: PasswordHashingPort,
    private readonly maximum: number,
  ) {}
  private async snapshot(raw: unknown) {
    const digest = digestBearer(raw);
    must(digest !== null);
    return run(this.pool, async (client) => {
      const row = oneRow(
        await client.query<SessionRow>(
          `SELECT ${sessionColumns} FROM zhiban_identity.sessions WHERE token_digest=$1`,
          [digest],
        ),
        'SELECT',
        true,
      );
      must(row !== null);
      const s = sessionFromRow(row);
      const result = oneRow(
        await client.query<{ status: string; repository_revision: string }>(
          'SELECT status,repository_revision FROM zhiban_identity.users WHERE user_id=$1',
          [s.value.userId],
        ),
        'SELECT',
      );
      must(
        result !== null &&
          result.status === 'ACTIVE' &&
          result.repository_revision === s.value.userRevision &&
          s.value.revokedAt === null,
      );
      const wall = Date.now();
      must(
        wall >= s.value.lastSeenAt &&
          wall < s.value.absoluteExpiresAt &&
          wall < s.value.idleExpiresAt,
      );
      return {
        digest,
        user: s.value.userId,
        userRevision: result.repository_revision,
        sessionId: s.value.id,
        epoch: s.value.securityEpoch,
        wall,
        until: Math.min(s.value.absoluteExpiresAt, s.value.idleExpiresAt),
      };
    });
  }
  async context(raw: unknown) {
    const s = await this.snapshot(raw),
      credential = await this.credentials.verificationSnapshot(userId(s.user));
    must(credential !== null && credential.epoch === s.epoch);
    const live = await this.snapshot(raw);
    must(live.userRevision === s.userRevision && live.sessionId === s.sessionId);
    for (const [k, v] of this.#csrf) if (Date.now() >= v.deadline) this.#csrf.delete(k);
    if (!this.#csrf.has(s.digest) && this.#csrf.size >= this.maximum)
      throw new RecoveryError('RECOVERY_UNAVAILABLE');
    const proof = randomLocator('mcsrf1_');
    this.#csrf.set(s.digest, { proof, deadline: s.until });
    return { csrf: proof, userId: s.user, deadline: s.until };
  }
  async stepUp(
    raw: unknown,
    csrf: unknown,
    password: string,
    intent: string,
  ): Promise<RecoveryProof> {
    const s = await this.snapshot(raw),
      token = this.#csrf.get(s.digest);
    must(token !== undefined && Date.now() < token.deadline && sameSecret(csrf, token.proof));
    const c = await this.credentials.verificationSnapshot(userId(s.user));
    must(c !== null && c.epoch === s.epoch);
    must((await this.hashing.verify(password, c.verifier)) === true);
    const proof = Object.freeze({ kind: 'RECOVERY_REQUEST_PROOF' as const });
    this.#proofs.set(proof, {
      ...s,
      slotRevision: c.revision,
      epoch: c.epoch,
      intent,
      mono: performance.now(),
      wall: Date.now(),
      until: Math.min(s.until, Date.now() + 300000),
    });
    return proof;
  }
  take(handle: RecoveryProof, intent: string) {
    const p = this.#proofs.get(handle);
    must(p !== undefined && p.intent === intent);
    this.#proofs.delete(handle);
    this.fresh(p);
    return p;
  }
  fresh(p: Proof, at = Date.now()) {
    const elapsed = performance.now() - p.mono;
    must(
      at >= p.wall &&
        Date.now() >= p.wall &&
        elapsed >= 0 &&
        elapsed < 300000 &&
        at < p.until &&
        Date.now() < p.until,
    );
  }
  check(p: Proof, row: Record<string, string | null>, at: number) {
    this.fresh(p, at);
    revision(row.actor_user_revision);
    revision(row.actor_slot_revision);
    revision(row.actor_security_epoch);
    revision(row.admin_grant_revision);
    must(
      row.actor_user_id === p.user &&
        row.actor_user_revision === p.userRevision &&
        row.actor_slot_revision === p.slotRevision &&
        row.actor_security_epoch === p.epoch,
    );
    must(
      at < time(row.absolute_expires_at) &&
        at < time(row.idle_expires_at) &&
        (row.grant_valid_until === null || at < time(row.grant_valid_until)),
    );
  }
}
