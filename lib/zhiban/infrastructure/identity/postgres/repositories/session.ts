import type { PoolClient } from 'pg';
import { instant, type Instant, type UserId } from '@/lib/zhiban/domain/identity';
import type { SessionId, SessionRecord, SessionRepositoryPort, TokenDigest } from '@/lib/zhiban/application/identity/ports/session-repository';
import type { Loaded, RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { createIdentityAuditEvent } from '@/lib/zhiban/application/identity/ports/audit';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { credentialId, securityEpoch } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { controlTransaction, type TransactionPool } from '../transactions';
import { userFromRow, type UserRow } from '../mappers/user';
import { checkedUuid } from '../mappers/checked-values';
import { sanitizedCredentialError } from '../../credentials/credential-errors';
import { digestBearer, newApprovedSession, sessionApproval, sessionPolicy, type SessionPolicy } from '../../sessions/session-material';
import { atPortBoundary, expectedRevision, integrity, nextRevision, oneRow } from './repository-support';
import { sessionColumns, sessionFromRow, type SessionRow, type BoundSession } from './session-records';

type Client = Pick<PoolClient, 'query' | 'release'>;
const userColumns = 'user_id, status, created_at, updated_at, disabled_at, disabled_reason, repository_revision';
interface Slot { user_id: string; active_credential_id: string | null; repository_revision: string; security_epoch: string }
/** auth runtime pool only. No TenantContext, no permissions snapshot, no automatic retry. */
export class PostgresSessionRepository implements SessionRepositoryPort {
  readonly policy: SessionPolicy;
  constructor(private readonly authPool: TransactionPool, policy?: SessionPolicy) { this.policy = sessionPolicy(policy); }
  private async run<T>(work: (client: Client) => Promise<T>) {
    try { return await atPortBoundary(() => controlTransaction(this.authPool, work), ['sessions_pkey', 'sessions_token_digest_key']); }
    catch (error) { throw sanitizedCredentialError(error); }
  }
  private async barrier(client: Client, id: UserId, exclusive = false) {
    checkedUuid(id);
    await client.query(`SELECT pg_advisory_xact_lock${exclusive ? '' : '_shared'}(hashtextextended('zhiban-session-user:' || $1::text, 0))`, [id]);
  }
  private async user(client: Client, id: UserId) {
    const row = oneRow(await client.query<UserRow>(`SELECT ${userColumns} FROM zhiban_identity.users WHERE user_id=$1`, [id]), 'SELECT', true);
    integrity(row === null || row.user_id === id);
    return row === null ? null : userFromRow(row);
  }
  /** Read before crypto; issue rechecks this exact revision after crypto. */
  authenticationUserRevision(id: UserId) { return this.run(async client => { checkedUuid(id); const current = await this.user(client, id); return current?.value.status === 'ACTIVE' ? current.revision : null; }); }
  private async slot(client: Client, id: UserId, lock = true) {
    const row = oneRow(await client.query<Slot>(`SELECT user_id, active_credential_id, repository_revision, security_epoch FROM zhiban_identity.credential_slots WHERE user_id=$1${lock ? ' FOR SHARE' : ''}`, [id]), 'SELECT', true);
    integrity(row === null || row.user_id === id);
    if (row) { repositoryRevision(row.repository_revision); integrity(securityEpoch(row.security_epoch) !== '0'); if (row.active_credential_id !== null) credentialId(row.active_credential_id); }
    return row;
  }
  private async byId(client: Client, id: SessionId, lock = false) {
    const row = oneRow(await client.query<SessionRow>(`SELECT ${sessionColumns} FROM zhiban_identity.sessions WHERE session_id=$1${lock ? ' FOR UPDATE' : ''}`, [id]), 'SELECT', true);
    integrity(row === null || row.session_id === id);
    return row === null ? null : sessionFromRow(row);
  }
  private async byDigest(client: Client, digest: TokenDigest) {
    integrity(typeof digest === 'string' && /^[0-9a-f]{64}$(?![\s\S])/.test(digest));
    const row = oneRow(await client.query<SessionRow>(`SELECT ${sessionColumns} FROM zhiban_identity.sessions WHERE token_digest=$1`, [digest]), 'SELECT', true);
    integrity(row === null || row.token_digest === digest);
    return row === null ? null : sessionFromRow(row);
  }
  findByDigest(digest: TokenDigest) { return this.run(client => this.byDigest(client, digest)); }
  private async insert(client: Client, record: SessionRecord) {
    const binding = sessionApproval(record);
    const row = oneRow(await client.query<SessionRow>(`INSERT INTO zhiban_identity.sessions (session_id,user_id,token_digest,created_at,last_seen_at,absolute_expires_at,idle_expires_at,revoked_at,repository_revision,security_epoch,user_revision) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,1,$8,$9) RETURNING ${sessionColumns}`, [record.id, record.userId, record.tokenDigest, record.createdAt.toString(), record.lastSeenAt.toString(), record.absoluteExpiresAt.toString(), record.idleExpiresAt.toString(), binding.epoch, binding.userRevision]), 'INSERT');
    integrity(row !== null);
    const stored = sessionFromRow(row);
    integrity(stored.revision === '1' && stored.value.id === record.id && stored.value.tokenDigest === record.tokenDigest && stored.value.userId === record.userId && stored.value.securityEpoch === binding.epoch && stored.value.userRevision === binding.userRevision && stored.value.createdAt === record.createdAt && stored.value.lastSeenAt === record.lastSeenAt && stored.value.absoluteExpiresAt === record.absoluteExpiresAt && stored.value.idleExpiresAt === record.idleExpiresAt && stored.value.revokedAt === null);
    return stored;
  }
  create(record: SessionRecord): Promise<Loaded<SessionRecord>> {
    return this.run(async client => {
      const binding = sessionApproval(record);
      integrity(binding.userId === record.userId && record.revokedAt === null);
      // Complete FK key-share BEFORE advisory barrier: frozen User save first
      // locks users FOR UPDATE. Failed final check rolls back this uncommitted row.
      const stored = await this.insert(client, record);
      await this.barrier(client, binding.userId);
      const slot = await this.slot(client, binding.userId), current = await this.user(client, binding.userId);
      if (!current || current.value.status !== 'ACTIVE' || current.revision !== binding.userRevision || !slot || slot.active_credential_id !== binding.credentialId || slot.repository_revision !== binding.credentialRevision || slot.security_epoch !== binding.epoch) throw new IdentityPortError('STALE_WRITE');
      return stored;
    });
  }
  private live(stored: Loaded<BoundSession>, at: Instant, current: Awaited<ReturnType<PostgresSessionRepository['user']>>, slot: Slot | null) {
    return stored.value.revokedAt === null && at >= stored.value.lastSeenAt && at < stored.value.absoluteExpiresAt && at < stored.value.idleExpiresAt && current?.value.status === 'ACTIVE' && current.revision === stored.value.userRevision && slot !== null && slot.active_credential_id !== null && slot.security_epoch === stored.value.securityEpoch;
  }
  private async updateTouch(client: Client, stored: Loaded<BoundSession>, at: Instant, idle: Instant) {
    integrity(idle > at && idle <= stored.value.absoluteExpiresAt && idle >= stored.value.idleExpiresAt);
    if (at === stored.value.lastSeenAt && idle === stored.value.idleExpiresAt) return stored;
    const next = nextRevision(stored.revision);
    const row = oneRow(await client.query<SessionRow>(`UPDATE zhiban_identity.sessions SET last_seen_at=$1,idle_expires_at=$2,repository_revision=repository_revision+1 WHERE session_id=$3 AND repository_revision=$4 AND revoked_at IS NULL RETURNING ${sessionColumns}`, [at.toString(), idle.toString(), stored.value.id, stored.revision]), 'UPDATE', true);
    if (!row) throw new IdentityPortError('STALE_WRITE');
    const result = sessionFromRow(row);
    integrity(result.revision === next && result.value.id === stored.value.id && result.value.userId === stored.value.userId && result.value.tokenDigest === stored.value.tokenDigest && result.value.securityEpoch === stored.value.securityEpoch && result.value.userRevision === stored.value.userRevision && result.value.createdAt === stored.value.createdAt && result.value.absoluteExpiresAt === stored.value.absoluteExpiresAt && result.value.revokedAt === null && result.value.lastSeenAt === at && result.value.idleExpiresAt === idle);
    return result;
  }
  touch(id: SessionId, at: Instant, idle: Instant, revision: RepositoryRevision) {
    return this.run(async client => {
      at = instant(at); idle = instant(idle);
      const hint = await this.byId(client, id); if (!hint) return null;
      await this.barrier(client, hint.value.userId);
      const slot = await this.slot(client, hint.value.userId), current = await this.user(client, hint.value.userId);
      const stored = await this.byId(client, id, true); if (!stored) return null;
      expectedRevision(stored.revision, revision); // Always before no-op/revoked checks.
      if (!this.live(stored, at, current, slot)) return null;
      return this.updateTouch(client, stored, at, idle);
    });
  }
  /** Only authenticated UserId after a committed CAS touch; storage failure never authenticates. */
  validateAndTouch(raw: unknown, at: Instant): Promise<UserId | null> {
    const digest = digestBearer(raw); if (!digest) return Promise.resolve(null);
    return this.run(async client => {
      at = instant(at);
      const hint = await this.byDigest(client, digest); if (!hint) return null;
      await this.barrier(client, hint.value.userId);
      const slot = await this.slot(client, hint.value.userId), current = await this.user(client, hint.value.userId);
      const stored = await this.byId(client, hint.value.id, true); if (!stored || !this.live(stored, at, current, slot)) return null;
      expectedRevision(stored.revision, hint.revision);
      const idle = instant(Math.min(at + this.policy.idleMs, stored.value.absoluteExpiresAt));
      await this.updateTouch(client, stored, at, idle);
      return stored.value.userId;
    });
  }
  private async revokeLocked(client: Client, id: SessionId, idUser: UserId, revision: RepositoryRevision, at: Instant) {
    nextRevision(revision);
    const result = await client.query('UPDATE zhiban_identity.sessions SET revoked_at=$1,repository_revision=repository_revision+1 WHERE session_id=$2 AND repository_revision=$3 AND revoked_at IS NULL', [at.toString(), id, revision]);
    integrity(result.command === 'UPDATE' && result.rowCount === 1 && result.rows.length === 0);
    const event = createIdentityAuditEvent({ type: 'SESSION_REVOKED', sessionId: id, userId: idUser, occurredAt: at, actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: null });
    const audit = await client.query("INSERT INTO zhiban_identity.audit_events (event_shape_version,event_type,event_scope,occurred_at,actor_type,reason,subject_user_id,event_payload) VALUES(1,'SESSION_REVOKED','GLOBAL',$1,'SYSTEM',$2,$3,$4::jsonb)", [event.occurredAt.toString(), event.reason, idUser, JSON.stringify({ sessionId: id })]);
    integrity(audit.command === 'INSERT' && audit.rowCount === 1 && audit.rows.length === 0);
  }
  revoke(id: SessionId, at: Instant) { return this.run(async client => {
    at = instant(at);
    const hint = await this.byId(client, id); if (!hint) return;
    await this.barrier(client, hint.value.userId);
    const stored = await this.byId(client, id, true); if (!stored || stored.value.revokedAt !== null) return;
    integrity(at >= stored.value.lastSeenAt);
    await this.revokeLocked(client, id, stored.value.userId, stored.revision, at);
  }); }
  revokeAllForUser(id: UserId, at: Instant) { return this.run(async client => {
    checkedUuid(id); at = instant(at);
    await this.barrier(client, id, true); // Excludes issue/rotation and all touches for this User.
    const result = await client.query<SessionRow>(`SELECT ${sessionColumns} FROM zhiban_identity.sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY session_id FOR UPDATE`, [id]);
    integrity(result.command === 'SELECT' && result.rowCount === result.rows.length);
    for (const row of result.rows) { const stored = sessionFromRow(row); integrity(stored.value.userId === id && at >= stored.value.lastSeenAt); await this.revokeLocked(client, stored.value.id, id, stored.revision, at); }
  }); }
  rotate(raw: unknown, at: Instant, revision: RepositoryRevision) {
    const digest = digestBearer(raw); if (!digest) return Promise.resolve(null);
    return this.run(async client => {
      at = instant(at);
      const hint = await this.byDigest(client, digest); if (!hint) return null;
      expectedRevision(hint.revision, revision);
      const initialSlot = await this.slot(client, hint.value.userId, false);
      if (hint.value.revokedAt !== null || at < hint.value.lastSeenAt || at >= hint.value.idleExpiresAt || at >= hint.value.absoluteExpiresAt || !initialSlot?.active_credential_id || initialSlot.security_epoch !== hint.value.securityEpoch) return null;
      // Complete FK key-share before User barrier, then revalidate under locks.
      // Rotation without new credential verification preserves absolute deadline.
      const remaining = hint.value.absoluteExpiresAt - at;
      const issued = newApprovedSession({ userId: hint.value.userId, credentialId: credentialId(initialSlot.active_credential_id), revision: repositoryRevision(initialSlot.repository_revision), epoch: initialSlot.security_epoch }, hint.value.userRevision, at, sessionPolicy({ absoluteMs: remaining, idleMs: Math.min(remaining, this.policy.idleMs) }));
      const session = await this.insert(client, issued.record);
      await this.barrier(client, hint.value.userId);
      const slot = await this.slot(client, hint.value.userId), current = await this.user(client, hint.value.userId);
      const stored = await this.byId(client, hint.value.id, true); if (!stored) throw new IdentityPortError('STALE_WRITE');
      expectedRevision(stored.revision, revision);
      if (!this.live(stored, at, current, slot)) throw new IdentityPortError('STALE_WRITE');
      await this.revokeLocked(client, stored.value.id, stored.value.userId, stored.revision, at);
      return Object.freeze({ session, bearer: issued.bearer });
    });
  }
}
