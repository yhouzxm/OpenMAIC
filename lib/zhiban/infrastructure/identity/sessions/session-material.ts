import { createHash, randomBytes } from 'node:crypto';
import { instant, type Instant, type UserId } from '@/lib/zhiban/domain/identity';
import { sessionId, tokenDigest, type SessionRecord } from '@/lib/zhiban/application/identity/ports/session-repository';
import type { RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { CredentialId } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';

export interface SessionPolicy { readonly absoluteMs: number; readonly idleMs: number }
export const DEFAULT_SESSION_POLICY: SessionPolicy = Object.freeze({ absoluteMs: 8 * 60 * 60 * 1000, idleMs: 30 * 60 * 1000 });
export function sessionPolicy(policy: SessionPolicy = DEFAULT_SESSION_POLICY): SessionPolicy {
  if (!Number.isSafeInteger(policy.absoluteMs) || !Number.isSafeInteger(policy.idleMs) || policy.absoluteMs <= 0 || policy.idleMs <= 0 || policy.idleMs > policy.absoluteMs) throw new IdentityPortError('INTEGRITY_FAILURE');
  return Object.freeze({ absoluteMs: policy.absoluteMs, idleMs: policy.idleMs });
}
/** Nonserializable capability; only explicit cookie adapter extraction reveals token. */
export interface SessionBearer { readonly kind: 'SESSION_BEARER' }
const bearers = new WeakMap<object, string>();
export function bearerForCookie(handle: SessionBearer): string {
  const value = bearers.get(handle);
  if (!value) throw new IdentityPortError('INTEGRITY_FAILURE');
  return value;
}
export function digestBearer(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$(?![\s\S])/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== 32 || decoded.toString('base64url') !== value) return null;
  return tokenDigest(createHash('sha256').update(value, 'ascii').digest('hex'));
}
export interface SessionBinding { readonly userId: UserId; readonly userRevision: RepositoryRevision; readonly epoch: string; readonly credentialId: string; readonly credentialRevision: RepositoryRevision }
interface VerifiedCredentialMetadata { readonly userId: UserId; readonly credentialId: CredentialId; readonly revision: RepositoryRevision; readonly epoch: string }
const approvals = new WeakMap<object, SessionBinding>();
export function sessionApproval(record: SessionRecord): SessionBinding {
  const binding = approvals.get(record);
  if (!binding) throw new IdentityPortError('INTEGRITY_FAILURE');
  return binding;
}
/** Infrastructure composition only: call AFTER real verification; never a Domain/barrel export. */
export function newApprovedSession(snapshot: VerifiedCredentialMetadata, userRevision: RepositoryRevision, now: Instant, policy: SessionPolicy) {
  policy = sessionPolicy(policy); now = instant(now);
  const raw = randomBytes(32).toString('base64url');
  const bearer: SessionBearer = Object.freeze({ kind: 'SESSION_BEARER' }); bearers.set(bearer, raw);
  // SessionId is independent of bearer token and of Identity Domain IdGenerator.
  const record: SessionRecord = Object.freeze({ id: sessionId(`ses_${randomBytes(32).toString('base64url')}`), userId: snapshot.userId, tokenDigest: digestBearer(raw)!, createdAt: now, lastSeenAt: now, absoluteExpiresAt: instant(now + policy.absoluteMs), idleExpiresAt: instant(now + policy.idleMs), revokedAt: null });
  approvals.set(record, Object.freeze({ userId: snapshot.userId, userRevision, epoch: snapshot.epoch, credentialId: snapshot.credentialId, credentialRevision: snapshot.revision }));
  return Object.freeze({ record, bearer });
}
