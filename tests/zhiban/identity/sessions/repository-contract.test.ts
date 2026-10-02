import { describe, expect, it } from 'vitest';
import { instant, userId } from '@/lib/zhiban/domain/identity';
import { credentialId } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { SessionRepositoryPort } from '@/lib/zhiban/application/identity/ports/session-repository';
import { sessionId, tokenDigest } from '@/lib/zhiban/application/identity/ports/session-repository';
import { FakeSessionRepository } from '../contracts/fakes';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import { newApprovedSession, DEFAULT_SESSION_POLICY } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { sessionSqlHarness, uid, cid } from './sql-harness';

// Shared frozen Port lifecycle contract. Fake is NOT epoch/ACL/PG16 signoff.
for (const [name, factory] of [
  ['Fake', () => new FakeSessionRepository()],
  ['Postgres SQL unit adapter', () => new PostgresSessionRepository(sessionSqlHarness().pool)],
] as const) describe(`SessionRepositoryPort shared contract: ${name}`, () => {
  async function fixture() {
    const repo: SessionRepositoryPort = factory();
    const issued = newApprovedSession({ userId: userId(uid), credentialId: credentialId(cid), revision: repositoryRevision('1'), epoch: '1' }, repositoryRevision('1'), instant(1000), DEFAULT_SESSION_POLICY);
    const stored = await repo.create(issued.record); return { repo, issued, stored };
  }
  it('duplicate create conflicts, lookup preserves identity', async () => {
    const { repo, issued } = await fixture();
    await expect(repo.create(issued.record)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await repo.findByDigest(issued.record.tokenDigest))?.value.id).toBe(issued.record.id);
    if (name === 'Fake') {
      const extra = await repo.create({ ...issued.record, id: sessionId('closed-projection-fixture'), tokenDigest: tokenDigest('fixture-digest'), rawToken: 'synthetic-sensitive-extra' } as Parameters<SessionRepositoryPort['create']>[0]);
      expect('rawToken' in extra.value).toBe(false);
    }
  });
  it('complete no-op keeps revision; stale checked first', async () => {
    const { repo, stored } = await fixture();
    expect((await repo.touch(stored.value.id, stored.value.lastSeenAt, stored.value.idleExpiresAt, stored.revision))?.revision).toBe(stored.revision);
    await expect(repo.touch(stored.value.id, stored.value.lastSeenAt, stored.value.idleExpiresAt, repositoryRevision('2'))).rejects.toMatchObject({ code: 'STALE_WRITE' });
  });
  it('touch then revoke advances once each and cannot revive; idempotent revoke', async () => {
    const { repo, stored, issued } = await fixture();
    expect((await repo.touch(stored.value.id, instant(2000), instant(1802000), stored.revision))?.revision).toBe('2');
    await repo.revoke(stored.value.id, instant(3000)); await repo.revoke(stored.value.id, instant(4000));
    const current = (await repo.findByDigest(issued.record.tokenDigest))!;
    expect(current.revision).toBe('3'); expect(current.value.revokedAt).toBe(3000);
    await expect(repo.touch(stored.value.id, instant(4000), instant(1804000), stored.revision)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect(await repo.touch(stored.value.id, instant(4000), instant(1804000), current.revision)).toBeNull();
  });
  it('batch revoke invalidates stale snapshot', async () => {
    const { repo, stored } = await fixture(); await repo.revokeAllForUser(stored.value.userId, instant(2000));
    await expect(repo.touch(stored.value.id, instant(3000), instant(1803000), stored.revision)).rejects.toMatchObject({ code: 'STALE_WRITE' });
  });
});
