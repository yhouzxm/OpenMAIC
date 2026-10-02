import { instant, userId } from '@/lib/zhiban/domain/identity';
import { sessionId, tokenDigest, type SessionRecord } from '@/lib/zhiban/application/identity/ports/session-repository';
import { repositoryRevision, type Loaded, type RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { securityEpoch } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { checkedInteger, checkedUuid, instantMaximum } from '../mappers/checked-values';
import { integrity } from './repository-support';

export const sessionColumns = 'session_id, user_id, token_digest, created_at, last_seen_at, absolute_expires_at, idle_expires_at, revoked_at, repository_revision, security_epoch, user_revision';
export interface SessionRow { session_id: string; user_id: string; token_digest: string; created_at: string; last_seen_at: string; absolute_expires_at: string; idle_expires_at: string; revoked_at: string | null; repository_revision: string; security_epoch: string | null; user_revision: string | null }
export interface BoundSession extends SessionRecord { readonly securityEpoch: string; readonly userRevision: RepositoryRevision }
export function sessionFromRow(row: SessionRow): Loaded<BoundSession> {
  integrity(typeof row === 'object' && row !== null && Object.getPrototypeOf(row) === Object.prototype && Reflect.ownKeys(row).length === 11);
  for (const key of sessionColumns.split(', ')) {
    const descriptor = Object.getOwnPropertyDescriptor(row, key);
    integrity(descriptor !== undefined && 'value' in descriptor && (typeof descriptor.value === 'string' || key === 'revoked_at' && descriptor.value === null));
  }
  checkedUuid(row.user_id);
  integrity(/^ses_[A-Za-z0-9_-]{43}$(?![\s\S])/.test(row.session_id) && /^[0-9a-f]{64}$(?![\s\S])/.test(row.token_digest));
  const time = (value: string) => instant(Number(checkedInteger(value, instantMaximum)));
  const value: BoundSession = Object.freeze({ id: sessionId(row.session_id), userId: userId(row.user_id), tokenDigest: tokenDigest(row.token_digest), createdAt: time(row.created_at), lastSeenAt: time(row.last_seen_at), absoluteExpiresAt: time(row.absolute_expires_at), idleExpiresAt: time(row.idle_expires_at), revokedAt: row.revoked_at === null ? null : time(row.revoked_at), securityEpoch: securityEpoch(row.security_epoch!), userRevision: repositoryRevision(row.user_revision!) });
  integrity(value.securityEpoch !== '0' && value.createdAt <= value.lastSeenAt && value.lastSeenAt < value.idleExpiresAt && value.idleExpiresAt <= value.absoluteExpiresAt && (value.revokedAt === null || value.revokedAt >= value.lastSeenAt));
  return Object.freeze({ value, revision: repositoryRevision(row.repository_revision) });
}
