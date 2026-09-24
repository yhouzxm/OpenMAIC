import type { Instant, UserId } from '@/lib/zhiban/domain/identity';
import type { Loaded, RepositoryRevision } from './repository-types';

declare const sessionIdBrand: unique symbol;
declare const tokenDigestBrand: unique symbol;
export type SessionId = string & { readonly [sessionIdBrand]: 'SessionId' };
export type TokenDigest = string & { readonly [tokenDigestBrand]: 'TokenDigest' };

export function sessionId(value: string): SessionId {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('SessionId required.');
  return value as SessionId;
}

export function tokenDigest(value: string): TokenDigest {
  if (typeof value !== 'string' || value.trim() === '')
    throw new TypeError('TokenDigest required.');
  return value as TokenDigest;
}

/** Only global identity and session lifecycle data; no tenant or authorization snapshot. */
export interface SessionRecord {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly tokenDigest: TokenDigest;
  readonly createdAt: Instant;
  readonly lastSeenAt: Instant;
  readonly absoluteExpiresAt: Instant;
  readonly idleExpiresAt: Instant;
  readonly revokedAt: Instant | null;
}

export interface SessionRepositoryPort {
  create(session: SessionRecord): Promise<Loaded<SessionRecord>>;
  findByDigest(digest: TokenDigest): Promise<Loaded<SessionRecord> | null>;
  /**
   * Atomic compare-and-touch only for an unrevoked session. It may update only
   * lastSeenAt/idleExpiresAt; it must never clear revokedAt. A stale revision,
   * including one invalidated by revoke, fails with STALE_WRITE. A currently
   * revoked session returns null without changing the record.
   */
  touch(
    id: SessionId,
    lastSeenAt: Instant,
    idleExpiresAt: Instant,
    expectedRevision: RepositoryRevision,
  ): Promise<Loaded<SessionRecord> | null>;
  /** Idempotent atomic revoke wins over a competing touch and advances its revision. */
  revoke(id: SessionId, at: Instant): Promise<void>;
  /** Same semantics for each session of the global User; no Membership coupling. */
  revokeAllForUser(userId: UserId, at: Instant): Promise<void>;
}
