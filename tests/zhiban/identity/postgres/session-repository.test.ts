import { describe, expect, it } from 'vitest';
import { instant, userId } from '@/lib/zhiban/domain/identity';
import { credentialId } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import {
  newApprovedSession,
  DEFAULT_SESSION_POLICY,
  bearerForCookie,
} from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import { sessionFromRow } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session-records';
import { sessionSqlHarness, uid, cid } from '../sessions/sql-harness';

async function fixture() {
  const db = sessionSqlHarness(),
    repo = new PostgresSessionRepository(db.pool);
  const issued = newApprovedSession(
    {
      userId: userId(uid),
      credentialId: credentialId(cid),
      revision: repositoryRevision('1'),
      epoch: '1',
    },
    repositoryRevision('1'),
    instant(1000),
    DEFAULT_SESSION_POLICY,
  );
  const stored = await repo.create(issued.record);
  return { db, repo, issued, stored, raw: bearerForCookie(issued.bearer) };
}
describe('Postgres Session contracts and SQL unit proofs (NOT real PG16)', () => {
  it('inserts digest and bindings only; FK insert precedes User barrier; fresh slot share/User check precede commit', async () => {
    const { db, issued, raw } = await fixture();
    const insert = db.calls.findIndex((call) =>
      call.sql.startsWith('INSERT INTO zhiban_identity.sessions'),
    );
    const barrier = db.calls.findIndex((call) => call.sql.startsWith('SELECT pg_advisory'));
    const slot = db.calls.findIndex((call) => call.sql.endsWith('FOR SHARE'));
    expect(insert).toBeLessThan(barrier);
    expect(barrier).toBeLessThan(slot);
    expect(db.calls[insert].values).toEqual([
      issued.record.id,
      uid,
      issued.record.tokenDigest,
      '1000',
      '1000',
      '28801000',
      '1801000',
      '1',
      '1',
    ]);
    expect(db.calls.at(-1)?.sql).toBe('COMMIT');
    expect(db.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(JSON.stringify(db.calls).includes(raw)).toBe(false);
  });
  it('forged/copied create input has no verification approval; no INSERT occurs', async () => {
    const { db, repo, issued } = await fixture();
    db.calls.length = 0;
    await expect(repo.create({ ...issued.record })).rejects.toMatchObject({
      code: 'INTEGRITY_FAILURE',
    });
    expect(db.calls.some((call) => call.sql.startsWith('INSERT'))).toBe(false);
  });
  it('lookup is digest-scoped and unknown/wrong token does not authenticate', async () => {
    const { repo, issued } = await fixture();
    expect((await repo.findByDigest(issued.record.tokenDigest))?.value.id).toBe(issued.record.id);
    expect(await repo.validateAndTouch('A'.repeat(43), instant(2000))).toBeNull();
  });
  it('validation returns only UserId after committed CAS; touch changes revision once and bounds idle to absolute', async () => {
    const { db, repo, raw } = await fixture();
    db.calls.length = 0;
    expect(await repo.validateAndTouch(raw, instant(2000))).toBe(uid);
    expect(db.state().rows[0]).toMatchObject({
      repository_revision: '2',
      last_seen_at: '2000',
      idle_expires_at: '1802000',
    });
    const update = db.calls.find((call) => call.sql.startsWith('UPDATE'))!;
    expect(update.sql).toContain('AND repository_revision=$4 AND revoked_at IS NULL');
    expect(update.values.slice(0, 2)).toEqual(['2000', '1802000']);
    expect(update.values[3]).toBe('1');
    expect(db.calls.at(-1)?.sql).toBe('COMMIT');
  });
  it('current complete no-op keeps revision; stale no-op rejects first', async () => {
    const { repo, stored, db } = await fixture();
    db.calls.length = 0;
    expect(
      (
        await repo.touch(
          stored.value.id,
          stored.value.lastSeenAt,
          stored.value.idleExpiresAt,
          stored.revision,
        )
      )?.revision,
    ).toBe('1');
    expect(db.calls.some((call) => call.sql.startsWith('UPDATE'))).toBe(false);
    await expect(
      repo.touch(
        stored.value.id,
        stored.value.lastSeenAt,
        stored.value.idleExpiresAt,
        repositoryRevision('2'),
      ),
    ).rejects.toMatchObject({ code: 'STALE_WRITE' });
  });
  it.each(['idle', 'absolute', 'epoch', 'disabled', 'restored'])(
    'fails closed on %s without touching',
    async (mode) => {
      const { repo, db, raw } = await fixture();
      if (mode === 'epoch') db.slot.security_epoch = '2';
      if (mode === 'disabled') {
        db.user.status = 'DISABLED';
        db.user.updated_at = '2000';
        db.user.disabled_at = '2000';
        db.user.disabled_reason = 'security-test';
      }
      if (mode === 'restored') db.user.repository_revision = '3';
      db.calls.length = 0;
      expect(
        await repo.validateAndTouch(
          raw,
          instant(mode === 'idle' ? 1801000 : mode === 'absolute' ? 28801000 : 2000),
        ),
      ).toBeNull();
      expect(db.calls.some((call) => call.sql.startsWith('UPDATE'))).toBe(false);
    },
  );
  it('revoke is atomic/audited/idempotent, stale touch cannot revive it', async () => {
    const { repo, db, stored, raw } = await fixture();
    await repo.revoke(stored.value.id, instant(2000));
    await repo.revoke(stored.value.id, instant(3000));
    expect(db.state().rows[0]).toMatchObject({
      revoked_at: '2000',
      repository_revision: '2',
      last_seen_at: '1000',
    });
    expect(db.state().audit).toHaveLength(1);
    expect(JSON.parse(String(db.state().audit[0][3]))).toEqual({ sessionId: stored.value.id });
    expect(JSON.stringify(db.state().audit).includes(raw)).toBe(false);
    await expect(
      repo.touch(stored.value.id, instant(2000), instant(1802000), stored.revision),
    ).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect(
      await repo.touch(stored.value.id, instant(2000), instant(1802000), repositoryRevision('2')),
    ).toBeNull();
    expect(await repo.validateAndTouch(raw, instant(3000))).toBeNull();
  });
  it('revokeAll shares one transaction and exclusive User barrier, includes all active rows', async () => {
    const { repo, db, stored } = await fixture();
    await repo.revokeAllForUser(userId(uid), instant(2000));
    expect(db.state().rows[0].revoked_at).toBe('2000');
    expect(db.calls.some((call) => call.sql.startsWith('SELECT pg_advisory_xact_lock('))).toBe(
      true,
    );
    await expect(
      repo.touch(stored.value.id, instant(2000), instant(1802000), stored.revision),
    ).rejects.toMatchObject({ code: 'STALE_WRITE' });
  });
  it('rotation inserts new then revokes old and audits in same transaction; original absolute deadline preserved', async () => {
    const { repo, db, stored, raw } = await fixture();
    const next = await repo.rotate(raw, instant(2000), stored.revision);
    expect(next !== null).toBe(true);
    expect(next!.session.value.absoluteExpiresAt).toBe(stored.value.absoluteExpiresAt);
    expect(await repo.validateAndTouch(raw, instant(3000))).toBeNull();
    expect(await repo.validateAndTouch(bearerForCookie(next!.bearer), instant(3000))).toBe(uid);
    expect(db.state().audit).toHaveLength(1);
  });
  it.each(['revoke', 'rotate', 'all'])(
    'audit failure rolls back %s entirely and sanitized error has no cause',
    async (operation) => {
      const { repo, db, stored, raw } = await fixture();
      const before = db.state();
      db.fail.set('INSERT INTO zhiban_identity.audit_events', new Error(raw));
      const result =
        operation === 'revoke'
          ? repo.revoke(stored.value.id, instant(2000))
          : operation === 'rotate'
            ? repo.rotate(raw, instant(2000), stored.revision)
            : repo.revokeAllForUser(userId(uid), instant(2000));
      const error = await result.catch((error) => error);
      expect(error.code).toBe('UNAVAILABLE');
      expect('cause' in error).toBe(false);
      expect(error.message.includes(raw)).toBe(false);
      expect(db.state()).toEqual(before);
      expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');
    },
  );
  it('max revision fails mutation closed and does not advance', async () => {
    const { repo, db, raw } = await fixture();
    db.edit((rows) => {
      rows[0].repository_revision = '9223372036854775807';
    });
    await expect(repo.validateAndTouch(raw, instant(2000))).rejects.toMatchObject({
      code: 'INTEGRITY_FAILURE',
    });
    expect(db.state().rows[0].last_seen_at).toBe('1000');
  });
  it.each(['40001', '40P01'])('classifies %s but never retries and releases once', async (code) => {
    const { repo, db, raw } = await fixture();
    db.release.mockClear();
    db.fail.set('UPDATE', { code });
    await expect(repo.validateAndTouch(raw, instant(2000))).rejects.toMatchObject({
      code: 'RETRYABLE_PERSISTENCE_FAILURE',
    });
    expect(db.release).toHaveBeenCalledTimes(1);
  });
  it.each([
    'security_epoch',
    'user_revision',
    'token_digest',
    'idle_expires_at',
    'repository_revision',
  ])('malformed persisted %s never authenticates', async (field) => {
    const { db } = await fixture();
    const row = db.state().rows[0];
    expect(() => sessionFromRow({ ...row, [field]: 'invalid' })).toThrow();
  });
});
