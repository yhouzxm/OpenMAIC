import { beforeAll, describe, expect, it } from 'vitest';
import { instant, userId } from '@/lib/zhiban/domain/identity';
import { credentialId, securityEpoch, type CredentialAuditContext, type CredentialRepositoryPort } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { FakeCredentialRepository } from './fakes';
import { credentialSqlHarness } from './sql-harness';
import { hash } from '@node-rs/argon2';
import { PASSWORD_HASH_POLICY } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { issueVerifier } from '@/lib/zhiban/infrastructure/identity/credentials/verifier-material';

export const uid = userId('018f0000-0000-7000-8000-000000000001');
export const cid = credentialId('018f0000-0000-7000-8000-000000000002');
export const nextId = credentialId('018f0000-0000-7000-8000-000000000003');
export const audit: CredentialAuditContext = { actor: { kind: 'SERVICE', serviceCode: 'credential-service' }, requestId: null, reason: 'USER_REQUEST' };
let verifier: PasswordVerifierHandle;
beforeAll(async () => { verifier = await new Argon2PasswordHasher(syntheticPasswordScreening).hash('Synthetic contract password!'); });
for (const kind of ['Fake', 'Postgres SQL unit adapter'] as const) {
  const factory = (): CredentialRepositoryPort => kind === 'Fake' ? new FakeCredentialRepository([uid]) : new PostgresCredentialRepository(credentialSqlHarness().pool);
  describe.sequential(`${kind}: same credential repository contract (not PG16 evidence)`, () => {
    for (const boundary of ['revision', 'epoch'] as const) it(`int8 ${boundary} maximum rejects mutation but keeps revoked true no-op`, async () => {
      const db = kind === 'Postgres SQL unit adapter' ? credentialSqlHarness() : null;
      const repo = db ? new PostgresCredentialRepository(db.pool) : new FakeCredentialRepository([uid]);
      await repo.createPassword(uid, cid, verifier, instant(1000), audit);
      await repo.revokePassword(uid, repositoryRevision('1'), cid, instant(2000), audit);
      const revision = repositoryRevision(boundary === 'revision' ? '9223372036854775807' : '2');
      const epoch = securityEpoch(boundary === 'epoch' ? '9223372036854775807' : '2');
      if (repo instanceof FakeCredentialRepository) repo.setVersionBoundaryForTest(uid, revision, epoch);
      else {
        const state = db!.state(); state.slot!.repository_revision = revision; state.slot!.security_epoch = epoch;
        state.rows[0].slot_revision = revision; db!.seed(state); db!.calls.length = 0;
      }
      const before = await repo.findSlot(uid), history = await repo.findHistory(uid);
      expect(await repo.revokePassword(uid, revision, null, instant(3000), audit)).toEqual(before);
      await expect(repo.revokePassword(uid, repositoryRevision('1'), null, instant(3000), audit)).rejects.toMatchObject({ code: 'STALE_WRITE' });
      await expect(repo.replacePassword(uid, revision, null, nextId, verifier, instant(3000), audit)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
      expect(await repo.findSlot(uid)).toEqual(before); expect(await repo.findHistory(uid)).toEqual(history);
      if (db) expect(db.calls.some(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql))).toBe(false);
    });
    it('verified technical rehash preserves credential identity/generation/epoch and rejects stale proof use', async () => {
      const repo = factory(), provider = new Argon2PasswordHasher(syntheticPasswordScreening);
      const legacy = issueVerifier(await hash('Synthetic technical-rehash contract!',{ ...PASSWORD_HASH_POLICY,memoryCost:19456,timeCost:2 }));
      await repo.createPassword(uid,cid,legacy,instant(1000),audit);
      const proof = await provider.rehashVerified('Synthetic technical-rehash contract!',legacy); expect(proof).not.toBeNull();
      expect(await repo.rehashPassword(uid,repositoryRevision('1'),cid,proof!,instant(2000),audit)).toMatchObject({ revision:'2',value:{ securityEpoch:'1',generation:'1',activeCredentialId:cid } });
      expect(await repo.findHistory(uid)).toHaveLength(1);
      await expect(repo.rehashPassword(uid,repositoryRevision('1'),cid,proof!,instant(3000),audit)).rejects.toMatchObject({ code:'STALE_WRITE' });
    });
    it('missing slot/history; initial create safe Loaded revision=epoch=generation=1', async () => {
      const repo = factory(); expect(await repo.findSlot(uid)).toBeNull(); expect(await repo.findHistory(uid)).toEqual([]);
      const loaded = await repo.createPassword(uid, cid, verifier, instant(1000), audit);
      expect(loaded).toEqual({ revision: '1', value: { userId: uid, type: 'PASSWORD', activeCredentialId: cid, generation: '1', securityEpoch: '1', createdAt: 1000, updatedAt: 1000 } });
      expect(Object.keys(loaded.value).sort()).toEqual(['activeCredentialId','createdAt','generation','securityEpoch','type','updatedAt','userId']);
      await expect(repo.createPassword(uid, nextId, verifier, instant(2000), audit)).rejects.toMatchObject({ code: 'CONFLICT' });
    });
    it('replacement always mutation even identical password; clears old material, preserves safe history', async () => {
      const repo = factory(); await repo.createPassword(uid, cid, verifier, instant(1000), audit);
      const replaced = await repo.replacePassword(uid, repositoryRevision('1'), cid, nextId, verifier, instant(2000), audit);
      expect(replaced).toMatchObject({ revision: '2', value: { activeCredentialId: nextId, securityEpoch: '2', generation: '2' } });
      expect(await repo.findHistory(uid)).toMatchObject([{ credentialId: cid, status: 'REPLACED', replacedAt: 2000, replacedByCredentialId: nextId }, { credentialId: nextId, status: 'ACTIVE' }]);
      expect(JSON.stringify(await repo.findHistory(uid))).not.toMatch(/verifier|hash|secret/i);
      await expect(repo.replacePassword(uid, repositoryRevision('1'), cid, credentialId('018f0000-0000-7000-8000-000000000004'), verifier, instant(3000), audit)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    });
    it('revoke then current-revision true no-op; stale BEFORE no-op; fresh replacement after revoke', async () => {
      const repo = factory(); await repo.createPassword(uid, cid, verifier, instant(1000), audit);
      const revoked = await repo.revokePassword(uid, repositoryRevision('1'), cid, instant(2000), audit);
      expect(revoked).toMatchObject({ revision: '2', value: { activeCredentialId: null, securityEpoch: '2', generation: '1' } });
      expect(await repo.revokePassword(uid, repositoryRevision('2'), null, instant(3000), audit)).toEqual(revoked);
      await expect(repo.revokePassword(uid, repositoryRevision('1'), null, instant(3000), audit)).rejects.toMatchObject({ code: 'STALE_WRITE' });
      await expect(repo.replacePassword(uid, repositoryRevision('2'), null, cid, verifier, instant(3000), audit)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await repo.replacePassword(uid, repositoryRevision('2'), null, nextId, verifier, instant(3000), audit)).toMatchObject({ revision: '3', value: { securityEpoch: '3', generation: '2' } });
      expect((await repo.findHistory(uid))[0].status).toBe('REVOKED');
    });
    it('wrong current target/new reused ID and forged handle fail before state commit', async () => {
      const repo = factory(); const initial = await repo.createPassword(uid, cid, verifier, instant(1000), audit);
      await expect(repo.revokePassword(uid, repositoryRevision('1'), nextId, instant(2000), audit)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(repo.replacePassword(uid, repositoryRevision('1'), cid, nextId, Object.freeze({ ...verifier }), instant(2000), audit)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
      expect(await repo.findSlot(uid)).toEqual(initial);
    });
  });
}
import { syntheticPasswordScreening } from './fixture-policy';
