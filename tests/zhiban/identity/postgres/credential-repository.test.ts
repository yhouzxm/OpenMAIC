import { beforeAll, describe, expect, it } from 'vitest';
import { instant, userId } from '@/lib/zhiban/domain/identity';
import { credentialId, type CredentialAuditContext } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { verifierMaterial } from '@/lib/zhiban/infrastructure/identity/credentials/verifier-material';
import type { PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { credentialSqlHarness } from '../credentials/sql-harness';
import { slotColumns, credentialColumns, validateAggregate } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential-records';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { inspect } from 'node:util';
import type { PoolClient } from 'pg';

const uid = userId('018f0000-0000-7000-8000-000000000001'), cid = credentialId('018f0000-0000-7000-8000-000000000002'), next = credentialId('018f0000-0000-7000-8000-000000000003');
const audit: CredentialAuditContext = { actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: null };
const password = 'Synthetic SQL parameter fixture!';
let verifier: PasswordVerifierHandle;
function expectPrivateStateUnchanged(actual: ReturnType<ReturnType<typeof credentialSqlHarness>['state']>, before: typeof actual) {
  // Retain exact material equality, but never send material to Vitest's failure renderer.
  expect(actual.rows.map((row, index) => row.verifier_material === before.rows[index]?.verifier_material)).toEqual(before.rows.map(() => true));
  const safe = (state: typeof actual) => ({ ...state, rows: state.rows.map(({ verifier_material, ...metadata }) => ({ ...metadata, verifierPresent: verifier_material !== null })) });
  expect(safe(actual)).toEqual(safe(before));
}
beforeAll(async () => { verifier = await new Argon2PasswordHasher(syntheticPasswordScreening).hash(password); });
async function setup() {
  const db = credentialSqlHarness(), repo = new PostgresCredentialRepository(db.pool);
  await repo.createPassword(uid, cid, verifier, instant(1000), audit); db.calls.length = 0; db.release.mockClear();
  return { db, repo };
}
describe.sequential('Credential PostgreSQL unit SQL/security/atomicity', () => {
  it('initial create independently checks exact anchor/history SQL and parameters before audit/commit', async () => {
    const db = credentialSqlHarness(), repo = new PostgresCredentialRepository(db.pool);
    await repo.createPassword(uid, cid, verifier, instant(1000), audit);
    expect(db.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'INSERT', 'INSERT', 'INSERT', 'SELECT', 'SELECT', 'COMMIT']);
    expect(db.calls[1].sql).toBe("INSERT INTO zhiban_identity.credential_slots (user_id, credential_type, active_credential_id, generation, repository_revision, security_epoch, created_at, updated_at) VALUES ($1,'PASSWORD',$2,1,1,1,$3,$3)");
    expect(db.calls[1].values).toEqual([uid, cid, '1000']);
    expect(db.calls[2].sql).toBe("INSERT INTO zhiban_identity.credentials (credential_id, user_id, credential_type, generation, status, slot_revision, verifier_material, created_at, updated_at, replaced_at, revoked_at, replaced_by_credential_id) VALUES ($1,$2,'PASSWORD',$3,'ACTIVE',$4,$5,$6,$6,NULL,NULL,NULL)");
    expect([...db.calls[2].values.slice(0, 4), db.calls[2].values[4] === verifierMaterial(verifier), db.calls[2].values[5]]).toEqual([cid, uid, '1', '1', true, '1000']);
    expect(db.calls[3].sql.startsWith('INSERT INTO zhiban_identity.audit_events')).toBe(true);
    expect(JSON.parse(String(db.calls[3].values[8]))).toEqual({ credentialId: cid, repositoryRevisionAfter: '1', securityEpochAfter: '1' });
    expect(JSON.stringify(db.calls).includes(password)).toBe(false);
    expect(db.pool.connect).toHaveBeenCalledTimes(1); expect(db.release).toHaveBeenCalledTimes(1);
  });
  it('revoke independently checks CAS-before-terminalize-before-audit and no new generation', async () => {
    const { db, repo } = await setup();
    await repo.revokePassword(uid, repositoryRevision('1'), cid, instant(2000), audit);
    expect(db.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'SELECT', 'UPDATE', 'UPDATE', 'INSERT', 'SELECT', 'SELECT', 'COMMIT']);
    expect(db.calls[3].sql).toContain('WHERE user_id = $5 AND repository_revision = $6 RETURNING');
    expect(db.calls[3].values).toEqual([null, '1', '2', '2000', uid, '1']);
    expect(db.calls[4].sql).toBe("UPDATE zhiban_identity.credentials SET status = $1, verifier_material = NULL, slot_revision = $2, updated_at = $3, replaced_at = $4, revoked_at = $5, replaced_by_credential_id = $6 WHERE user_id = $7 AND credential_id = $8 AND status = 'ACTIVE'");
    expect(db.calls[4].values).toEqual(['REVOKED', '2', '2000', null, '2000', null, uid, cid]);
    expect(db.calls[5].sql.startsWith('INSERT INTO zhiban_identity.audit_events')).toBe(true);
    expect(JSON.parse(String(db.calls[5].values[8]))).toEqual({ credentialId: cid, repositoryRevisionBefore: '1', repositoryRevisionAfter: '2', securityEpochBefore: '1', securityEpochAfter: '2' });
    expect(db.release).toHaveBeenCalledTimes(1);
  });
  it('real security-record mapper/User mapper path rejects disabled before snapshot and after crypto snapshot', async () => {
    const { db,repo } = await setup();
    const snapshot = await repo.verificationSnapshot(uid); expect(snapshot).not.toBeNull();
    db.disableUser();
    expect(await repo.stillCurrent(snapshot!)).toBe(false);
    expect(await repo.verificationSnapshot(uid)).toBeNull();
    expect(db.calls.filter(call => call.sql.includes('FROM zhiban_identity.users'))).toHaveLength(3);
  });
  it('explicit SQL, all mutation ordering/params, same client audit, no tenant GUC/raw password', async () => {
    const { db, repo } = await setup();
    const loaded = await repo.replacePassword(uid, repositoryRevision('1'), cid, next, verifier, instant(2000), audit);
    expect(loaded.revision).toBe('2');
    const sql = db.calls.map(call => call.sql);
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED'); expect(sql.at(-1)).toBe('COMMIT');
    expect(sql[1]).toBe(`SELECT ${slotColumns} FROM zhiban_identity.credential_slots WHERE user_id = $1 FOR UPDATE`);
    expect(sql[2]).toBe(`SELECT ${credentialColumns} FROM zhiban_identity.credentials WHERE user_id = $1 ORDER BY generation`);
    expect(db.calls[3].values).toEqual([next, '2', '2', '2000', uid, '1']);
    expect(sql[3]).toContain('repository_revision = repository_revision + 1'); expect(sql[3]).toContain('AND repository_revision = $6 RETURNING');
    expect(db.calls[4].values).toEqual(['REPLACED', '2', '2000', '2000', null, next, uid, cid]);
    expect(sql[4]).toContain('verifier_material = NULL');
    // Boolean secret comparison prevents a failed assertion from dumping PHC parameters.
    expect([...db.calls[5].values.slice(0,4), db.calls[5].values[4] === verifierMaterial(verifier), db.calls[5].values[5]]).toEqual([next, uid, '2', '2', true, '2000']);
    expect(sql[6]).toContain('INSERT INTO zhiban_identity.audit_events');
    expect(JSON.parse(String(db.calls[6].values[8]))).toEqual({ priorCredentialId: cid, credentialId: next, repositoryRevisionBefore: '1', repositoryRevisionAfter: '2', securityEpochBefore: '1', securityEpochAfter: '2' });
    expect(JSON.stringify(db.calls[6]).includes(verifierMaterial(verifier))).toBe(false);
    expect(JSON.stringify(db.calls).includes(password)).toBe(false);
    expect(sql.join('\n')).not.toMatch(/SELECT \*|set_config|xmin/);
    expect(sql.filter(value => !value.startsWith('INSERT INTO zhiban_identity.audit_events')).join('\n')).not.toContain('tenant_id');
    expect(db.pool.connect).toHaveBeenCalledTimes(2); expect(db.release).toHaveBeenCalledTimes(1);
  });
  it('no-op at max revision AND epoch returns stored state, no write/audit, stale still rejects', async () => {
    const { db, repo } = await setup(); await repo.revokePassword(uid, repositoryRevision('1'), cid, instant(2000), audit);
    const state = db.state(); state.slot!.repository_revision = '9223372036854775807'; state.slot!.security_epoch = '9223372036854775807'; state.rows[0].slot_revision = state.slot!.repository_revision; db.seed(state);
    db.calls.length = 0;
    expect(await repo.revokePassword(uid, repositoryRevision('9223372036854775807'), null, instant(3000), audit)).toMatchObject({ revision: '9223372036854775807', value: { securityEpoch: '9223372036854775807', updatedAt: 2000 } });
    expect(db.calls.some(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql))).toBe(false);
    await expect(repo.revokePassword(uid, repositoryRevision('2'), null, instant(3000), audit)).rejects.toMatchObject({ code: 'STALE_WRITE' });
  });
  it.each(['revision','epoch','generation'])('%s max fails closed before mutation SQL', async field => {
    const { db, repo } = await setup(); const state = db.state();
    if (field === 'revision') { state.slot!.repository_revision = '9223372036854775807'; state.rows[0].slot_revision = state.slot!.repository_revision; }
    if (field === 'epoch') state.slot!.security_epoch = '9223372036854775807';
    // Generation cannot be made max without inventing missing history. It fails mapper first.
    if (field === 'generation') state.slot!.generation = '9223372036854775807';
    db.seed(state); const before = db.state();
    await expect(repo.replacePassword(uid, repositoryRevision(state.slot!.repository_revision), cid, next, verifier, instant(2000), audit)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expectPrivateStateUnchanged(db.state(), before); expect(db.calls.some(call => call.sql.startsWith('UPDATE'))).toBe(false);
  });
  for (const pattern of ['UPDATE zhiban_identity.credential_slots','UPDATE zhiban_identity.credentials','INSERT INTO zhiban_identity.credentials','INSERT INTO zhiban_identity.audit_events','COMMIT']) {
    it(`${pattern}: failure rolls back all slot/history/audit, releases once and sanitizes`, async () => {
      const { db, repo } = await setup(); const before = db.state();
      db.fail.set(pattern, { code: '23514', message: password, detail: verifierMaterial(verifier) });
      const failure = await repo.replacePassword(uid, repositoryRevision('1'), cid, next, verifier, instant(2000), audit).catch(error => error);
      expect(failure.code === 'INTEGRITY_FAILURE' && failure.message === 'INTEGRITY_FAILURE').toBe(true); expect(failure.cause === undefined).toBe(true);
      expect(db.calls.at(-1)?.sql).toBe('ROLLBACK'); expect(db.release).toHaveBeenCalledTimes(1); expectPrivateStateUnchanged(db.state(), before);
    });
  }
  it.each(['40001','40P01','42501','XX000','23503'])('SQLSTATE %s classification has no automatic retry or detail leak', async code => {
    const { db, repo } = await setup(); db.fail.set('UPDATE zhiban_identity.credential_slots', { code, message: password });
    await expect(repo.revokePassword(uid, repositoryRevision('1'), cid, instant(2000), audit)).rejects.toMatchObject({ code: ['40001','40P01'].includes(code) ? 'RETRYABLE_PERSISTENCE_FAILURE' : code === '23503' ? 'INTEGRITY_FAILURE' : 'UNAVAILABLE' });
    expect(db.calls.filter(call => call.sql.startsWith('UPDATE'))).toHaveLength(1);
  });
  it.each([{ command:'UPDATE', rowCount:0, rows:[] }, { command:'UPDATE', rowCount:2, rows:[{},{}] }, { command:'INSERT', rowCount:1, rows:[{}] }, { command:'UPDATE', rowCount:1, rows:[] }])('strict CAS result %# fails closed', async result => {
    const { db, repo } = await setup(); db.override(result);
    await expect(repo.revokePassword(uid, repositoryRevision('1'), cid, instant(2000), audit)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(db.calls.some(call => call.sql.startsWith('UPDATE zhiban_identity.credentials'))).toBe(false);
  });
  it.each(['generation', 'status', 'verifier', 'ownership', 'pointer', 'timestamp', 'revision'])('malformed persisted %s fails through security mapper', async field => {
    const { db, repo } = await setup(); const state = db.state();
    if (field === 'generation') state.rows[0].generation = '01';
    if (field === 'status') state.rows[0].status = 'UNKNOWN';
    if (field === 'verifier') state.rows[0].verifier_material = 'bad';
    if (field === 'ownership') state.rows[0].user_id = '018f0000-0000-7000-8000-000000000009';
    if (field === 'pointer') state.slot!.active_credential_id = next;
    if (field === 'timestamp') state.slot!.updated_at = '';
    if (field === 'revision') state.slot!.repository_revision = '9007199254740993.0';
    db.seed(state); await expect(repo.findSlot(uid)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
  });
  it('revision above Number safe maximum stays exact string', async () => {
    const { db, repo } = await setup(); const state = db.state(); state.slot!.repository_revision = '9007199254740993'; state.rows[0].slot_revision = state.slot!.repository_revision; db.seed(state);
    expect((await repo.revokePassword(uid, repositoryRevision('9007199254740993'), cid, instant(2000), audit)).revision).toBe('9007199254740994');
  });
  it('full security projection never serializes verifier in safe metadata', async () => {
    const { db } = await setup(); const state = db.state(); const safe = validateAggregate(state.slot!, state.rows);
    expect(JSON.stringify(safe).includes(verifierMaterial(verifier))).toBe(false);
  });
  it('existing Port errors are rebuilt without cause/custom secret fields; cleanup cannot replace primary', async () => {
    const { db, repo } = await setup(), before = db.state();
    const primary = Object.assign(new IdentityPortError('STALE_WRITE'), { cause: { secret: password }, material: verifierMaterial(verifier) });
    db.fail.set('UPDATE zhiban_identity.credential_slots', primary);
    db.release.mockImplementationOnce(() => { throw new Error(password); });
    const error = await repo.revokePassword(uid, repositoryRevision('1'), cid, instant(2000), audit).catch(value => value);
    expect(error !== primary).toBe(true); expect(error.code === 'STALE_WRITE' && error.message === 'STALE_WRITE').toBe(true);
    expect(error.cause === undefined && error.material === undefined).toBe(true);
    expect(inspect(error).includes(password) || inspect(error).includes(verifierMaterial(verifier))).toBe(false);
    expect(db.release).toHaveBeenCalledTimes(1); expectPrivateStateUnchanged(db.state(), before);
  });
  it('hostile Port error code is not treated as trusted message text', async () => {
    const { db, repo } = await setup();
    db.fail.set('UPDATE zhiban_identity.credential_slots', Object.assign(new IdentityPortError('UNAVAILABLE'), { code: password }));
    const error = await repo.revokePassword(uid, repositoryRevision('1'), cid, instant(2000), audit).catch(value => value);
    expect(error.code === 'UNAVAILABLE' && error.message === 'UNAVAILABLE').toBe(true);
    expect(inspect(error).includes(password)).toBe(false);
  });
  it('final authentication read rejects wrong command/count rather than trusting history rows', async () => {
    const { db, repo } = await setup(); const snapshot = await repo.verificationSnapshot(uid);
    const query = db.pool.connect;
    const badPool = { async connect() {
      const client = await query();
      return { ...client, query: (async (sql: string, values?: unknown[]) => {
        const result = await client.query(sql, values);
        return sql.includes('FROM zhiban_identity.credentials') ? { ...result, command: 'UPDATE', rowCount: 99 } : result;
      }) as PoolClient['query'] };
    } };
    await expect(new PostgresCredentialRepository(badPool).stillCurrent(snapshot!)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');
  });
  it.each(['missing', 'stale'])('zero CAS result distinguishes %s on the required re-read', async kind => {
    const { db } = await setup();
    const repo = new PostgresCredentialRepository({ async connect() {
      const client = await db.pool.connect();
      return { ...client, query: (async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('UPDATE zhiban_identity.credential_slots')) {
          expect(values).toEqual([null, '1', '2', '2000', uid, '1']);
          const state = db.state();
          if (kind === 'missing') db.seed({ slot: null, rows: [] });
          else { state.slot!.repository_revision = '2'; state.rows[0].slot_revision = '2'; db.seed(state); }
          return { command: 'UPDATE', rowCount: 0, rows: [] };
        }
        return client.query(sql, values);
      }) as PoolClient['query'] };
    } });
    await expect(repo.revokePassword(uid, repositoryRevision('1'), cid, instant(2000), audit)).rejects.toMatchObject({ code: kind === 'missing' ? 'CONFLICT' : 'STALE_WRITE' });
    expect(db.calls.filter(call => call.sql.includes('FROM zhiban_identity.credential_slots'))).toHaveLength(2);
    expect(db.calls.some(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql))).toBe(false);
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK'); expect(db.release).toHaveBeenCalledTimes(1);
  });
});
import { syntheticPasswordScreening } from '../credentials/fixture-policy';
