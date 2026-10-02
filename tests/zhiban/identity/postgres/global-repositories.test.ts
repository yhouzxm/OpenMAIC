import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { User, Tenant, SystemAdminGrant, instant, userId, tenantId, systemAdminGrantId } from '@/lib/zhiban/domain/identity';
import { repositoryRevision, type RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresTenantRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/tenant';
import { PostgresSystemAdminGrantRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/system-admin-grant';
import * as users from '@/lib/zhiban/infrastructure/identity/postgres/mappers/user';
import * as tenants from '@/lib/zhiban/infrastructure/identity/postgres/mappers/tenant';
import * as admins from '@/lib/zhiban/infrastructure/identity/postgres/mappers/system-admin-grant';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import { FakeIdentityRepository, FakeTenantRepository } from '../contracts/fakes';

const uid = userId('018f0000-0000-7000-8000-000000000001');
const tid = tenantId('018f0000-0000-7000-8000-000000000002');
const gid = systemAdminGrantId('018f0000-0000-7000-8000-000000000003');
const now = instant(1000);
const later = instant(2000);
const initial = repositoryRevision('1');
type Entity = User | Tenant | SystemAdminGrant;
type Row = users.UserRow | tenants.TenantRow | admins.SystemAdminGrantRow;
type Result = { rows: Row[]; rowCount: number | null; command: string };

/** Scripted pg Promise overload only; SQL and parameters are independently asserted below. */
function harness(current: Row | null, returned?: Row) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const failures = new Map<string, unknown>();
  let mutation: Result | undefined;
  let currentRow = current;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values: values ?? [] });
    const kind = sql.split(' ')[0];
    if (failures.has(kind)) throw failures.get(kind);
    if (kind === 'SELECT') return { rows: currentRow ? [currentRow] : [], rowCount: currentRow ? 1 : 0, command: kind };
    if (kind === 'INSERT' || kind === 'UPDATE') {
      const result = mutation ?? { rows: returned ? [returned] : [], rowCount: returned ? 1 : 0, command: kind };
      if (result.rows.length === 1) currentRow = result.rows[0];
      return result;
    }
    if (kind === 'ROLLBACK') currentRow = current;
    return { rows: [], rowCount: 0, command: kind };
  });
  const release = vi.fn();
  const client = { query: query as unknown as PoolClient['query'], release };
  const connect = vi.fn(async () => client);
  const pool: TransactionPool = { connect };
  return { pool, query, release, connect, calls, failures,
    mutate: (result: Result) => { mutation = result; }, stored: () => currentRow };
}

interface Case {
  name: string;
  table: string;
  idColumn: string;
  columns: string;
  assignments: string;
  insertPlaceholders: string;
  insertParams: (value: Entity) => unknown[];
  create: () => Entity;
  change: (value: Entity) => Entity;
  toRow: (value: Entity, revision?: string) => Row;
  read: (row: Row) => Entity;
  repository: (pool: TransactionPool) => {
    find: () => Promise<{ value: Entity; revision: RepositoryRevision } | null>;
    create: (value: Entity) => Promise<{ value: Entity; revision: RepositoryRevision }>;
    save: (value: Entity, revision: RepositoryRevision) => Promise<{ value: Entity; revision: RepositoryRevision }>;
  };
  updateParams: (value: Entity, revision: string) => unknown[];
  projectionSpy: () => { mockRestore: () => void; mock: { calls: unknown[][] } };
  loadedSpy: () => { mockRestore: () => void; mock: { results: { type: string; value: unknown }[] } };
}
const cases: readonly Case[] = [
  { name: 'User', table: 'users', idColumn: 'user_id', create: () => User.create(uid, now),
    columns: 'user_id, status, created_at, updated_at, disabled_at, disabled_reason, repository_revision',
    assignments: 'status = $1, updated_at = $2, disabled_at = $3, disabled_reason = $4',
    insertPlaceholders: '$1, $2, $3, $4, $5, $6, 1',
    insertParams: value => {
      const user = value as User;
      return [user.id, user.status, user.createdAt.toString(), user.updatedAt.toString(),
        user.disabledAt === null ? null : user.disabledAt.toString(), user.disabledReason];
    },
    change: value => (value as User).disable(later, 'review'),
    toRow: (value, revision = '1') => ({ ...users.userToRow(value as User), repository_revision: revision }),
    read: row => users.userFromRow(row as users.UserRow).value,
    repository: pool => {
      const repo = new PostgresIdentityRepository(pool);
      return { find: () => repo.findById(uid), create: value => repo.create(value as User), save: (value, revision) => repo.save(value as User, revision) };
    }, updateParams: (value, revision) => {
      const user = value as User;
      return [user.status, user.updatedAt.toString(), user.disabledAt === null ? null : user.disabledAt.toString(), user.disabledReason, uid, revision];
    }, projectionSpy: () => vi.spyOn(users, 'userToRow'), loadedSpy: () => vi.spyOn(users, 'userFromRow') },
  { name: 'Tenant', table: 'tenants', idColumn: 'tenant_id', create: () => Tenant.create(tid, 'school', 'School', now),
    columns: 'tenant_id, code, display_name, status, created_at, updated_at, disabled_at, disabled_reason, repository_revision',
    assignments: 'status = $1, updated_at = $2, disabled_at = $3, disabled_reason = $4',
    insertPlaceholders: '$1, $2, $3, $4, $5, $6, $7, $8, 1',
    insertParams: value => {
      const tenant = value as Tenant;
      return [tenant.id, tenant.code, tenant.displayName, tenant.status, tenant.createdAt.toString(),
        tenant.updatedAt.toString(), tenant.disabledAt === null ? null : tenant.disabledAt.toString(), tenant.disabledReason];
    },
    change: value => (value as Tenant).disable(later, 'review'),
    toRow: (value, revision = '1') => ({ ...tenants.tenantToRow(value as Tenant), repository_revision: revision }),
    read: row => tenants.tenantFromRow(row as tenants.TenantRow).value,
    repository: pool => {
      const repo = new PostgresTenantRepository(pool);
      return { find: () => repo.findById(tid), create: value => repo.create(value as Tenant), save: (value, revision) => repo.save(value as Tenant, revision) };
    }, updateParams: (value, revision) => {
      const tenant = value as Tenant;
      return [tenant.status, tenant.updatedAt.toString(), tenant.disabledAt === null ? null : tenant.disabledAt.toString(), tenant.disabledReason, tid, revision];
    }, projectionSpy: () => vi.spyOn(tenants, 'tenantToRow'), loadedSpy: () => vi.spyOn(tenants, 'tenantFromRow') },
  { name: 'SystemAdminGrant', table: 'system_admin_grants', idColumn: 'grant_id', create: () => SystemAdminGrant.create({
    id: gid, userId: uid, createdAt: now, validFrom: now, validUntil: null,
  }), change: value => (value as SystemAdminGrant).revoke(later),
    columns: 'grant_id, user_id, created_at, valid_from, valid_until, revoked_at, repository_revision',
    assignments: 'revoked_at = $1',
    insertPlaceholders: '$1, $2, $3, $4, $5, $6, 1',
    insertParams: value => {
      const grant = value as SystemAdminGrant;
      return [grant.id, grant.userId, grant.createdAt.toString(), grant.validFrom.toString(),
        grant.validUntil === null ? null : grant.validUntil.toString(), grant.revokedAt === null ? null : grant.revokedAt.toString()];
    },
    toRow: (value, revision = '1') => ({ ...admins.systemAdminGrantToRow(value as SystemAdminGrant), repository_revision: revision }),
    read: row => admins.systemAdminGrantFromRow(row as admins.SystemAdminGrantRow).value,
    repository: pool => {
      const repo = new PostgresSystemAdminGrantRepository(pool);
      return { find: () => repo.findSystemAdminGrant(gid), create: value => repo.createSystemAdminGrant(value as SystemAdminGrant), save: (value, revision) => repo.saveSystemAdminGrant(value as SystemAdminGrant, revision) };
    }, updateParams: (value, revision) => [(value as SystemAdminGrant).revokedAt?.toString() ?? null, gid, revision],
    projectionSpy: () => vi.spyOn(admins, 'systemAdminGrantToRow'), loadedSpy: () => vi.spyOn(admins, 'systemAdminGrantFromRow') },
];

describe.each(cases)('$name PostgreSQL global repository', testCase => {
  const { create, change, toRow, repository, table, idColumn } = testCase;
  it('R01-R03 load maps authentic stored state on one exclusive control client', async () => {
    const value = create();
    const h = harness(toRow(value, '9007199254740993'));
    const loaded = await repository(h.pool).find();
    expect(loaded?.value).toEqual(value);
    expect(loaded?.value).not.toBe(value);
    expect(loaded?.revision).toBe('9007199254740993');
    expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
    expect(h.calls[1].sql).toContain(`FROM zhiban_identity.${table} WHERE ${idColumn} = $1`);
    expect(h.calls[1]).toEqual({ sql: `SELECT ${testCase.columns} FROM zhiban_identity.${table} WHERE ${idColumn} = $1`, values: [value.id] });
    expect(h.calls[1].sql).not.toContain('*');
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
  });
  it('R04 missing find is null and missing save CONFLICT, with rollback', async () => {
    expect(await repository(harness(null).pool).find()).toBeNull();
    const h = harness(null);
    await expect(repository(h.pool).save(create(), initial)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
    expect(h.stored()).toBeNull();
  });
  it('create writes explicit projected fields and starts independently at revision 1', async () => {
    const value = create();
    const row = toRow(value);
    const h = harness(null, row);
    const loaded = await repository(h.pool).create(value);
    expect(loaded.value).toEqual(value);
    expect(loaded.revision).toBe('1');
    expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'INSERT', 'COMMIT']);
    const statement = h.calls[1];
    expect(statement.sql).toBe(`INSERT INTO zhiban_identity.${table} (${testCase.columns}) VALUES (${testCase.insertPlaceholders}) RETURNING ${testCase.columns}`);
    expect(statement.values).toEqual(testCase.insertParams(value));
  });
  it('R05/R12 state change locks before CAS and increments exactly with DB arithmetic', async () => {
    const value = create();
    const candidate = change(value);
    const revision = repositoryRevision('9007199254740993');
    const h = harness(toRow(value, revision), toRow(candidate, '9007199254740994'));
    const result = await repository(h.pool).save(candidate, revision);
    expect(result.value).toEqual(candidate);
    expect(result.revision).toBe('9007199254740994');
    expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
    expect(h.calls[1].sql).toMatch(/FOR UPDATE$/);
    const statement = h.calls[2];
    expect(statement.sql).toContain('repository_revision = repository_revision + 1');
    expect(statement.sql).toMatch(new RegExp(`WHERE ${idColumn} = \\$[0-9]+ AND repository_revision = \\$[0-9]+::bigint RETURNING`));
    expect(statement.values).toEqual(testCase.updateParams(candidate, revision));
    const idParameter = statement.values.length - 1;
    expect(statement.sql).toBe(`UPDATE zhiban_identity.${table} SET ${testCase.assignments}, repository_revision = repository_revision + 1 WHERE ${idColumn} = $${idParameter} AND repository_revision = $${idParameter + 1}::bigint RETURNING ${testCase.columns}`);
    expect(statement.sql).not.toMatch(/set_config|SET ROLE|xmin|SELECT \*/);
    expect(h.release).toHaveBeenCalledTimes(1);
  });
  it('R06 forged candidate fails before projection, property access, comparison or connection', async () => {
    const original = create();
    const copied = Object.freeze(Object.assign(Object.create(Object.getPrototypeOf(original)), original));
    const reads = vi.fn();
    const getters = Object.create(Object.getPrototypeOf(original));
    for (const [key, value] of Object.entries(original))
      Object.defineProperty(getters, key, { enumerable: true, get: () => { reads(); return value; } });
    Object.freeze(getters);
    const h = harness(toRow(original));
    const spy = testCase.projectionSpy();
    try {
      for (const candidate of [copied, getters, Object.freeze({ ...original })]) {
        await expect(repository(h.pool).save(candidate as Entity, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
        await expect(repository(h.pool).create(candidate as Entity)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
      }
      expect(spy.mock.calls).toHaveLength(0);
      expect(reads).not.toHaveBeenCalled();
      expect(h.connect).not.toHaveBeenCalled();
      expect(h.query).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it('R07-R09 true no-op returns stored value, unchanged revision, no UPDATE even at max', async () => {
    const value = create();
    const h = harness(toRow(value, '9223372036854775807'));
    const result = await repository(h.pool).save(value, repositoryRevision('9223372036854775807'));
    expect(result.value).toEqual(value);
    expect(result.value).not.toBe(value);
    expect(result.revision).toBe('9223372036854775807');
    expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
  });
  it('R09 no-op returns the exact current stored Loaded object, not a reconstructed candidate wrapper', async () => {
    const candidate = change(create());
    const h = harness(toRow(candidate, '2'));
    const spy = testCase.loadedSpy();
    try {
      const result = await repository(h.pool).save(candidate, repositoryRevision('2'));
      expect(spy.mock.results[0].type).toBe('return');
      expect(result).toBe(spy.mock.results[0].value);
      expect(result.value).not.toBe(candidate);
      expect(result.value).toEqual(candidate);
      expect(result.revision).toBe('2');
      expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
    } finally { spy.mockRestore(); }
  });
  it.each([false, true])('R10/R11 stale revision rejects before projection (state change %s)', async changed => {
    const value = create();
    const row = toRow(value, '2');
    const h = harness(row);
    const spy = testCase.projectionSpy();
    try {
      await expect(repository(h.pool).save(changed ? change(value) : value, initial)).rejects.toMatchObject({ code: 'STALE_WRITE' });
      expect(spy.mock.calls).toHaveLength(0);
      expect(h.stored()).toBe(row);
      expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
    } finally { spy.mockRestore(); }
  });
  it('R13 max revision changing save fails closed without UPDATE and preserves storage', async () => {
    const value = create();
    const row = toRow(value, '9223372036854775807');
    const h = harness(row);
    await expect(repository(h.pool).save(change(value), repositoryRevision(row.repository_revision))).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.stored()).toBe(row);
    expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
  });
  it('the final legal state-changing revision reaches int8 max exactly', async () => {
    const value = create();
    const candidate = change(value);
    const revision = repositoryRevision('9223372036854775806');
    const h = harness(toRow(value, revision), toRow(candidate, '9223372036854775807'));
    const loaded = await repository(h.pool).save(candidate, revision);
    expect(loaded.revision).toBe('9223372036854775807');
    expect(loaded.value).toEqual(candidate);
    expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
    expect(h.calls[2].values).toEqual(testCase.updateParams(candidate, revision));
  });
  it('stale precondition precedes immutable-field rejection as well as equality', async () => {
    const row = toRow(create(), '2');
    const candidate = testCase.read({ ...row, created_at: '999' } as Row);
    const h = harness(row);
    const spy = testCase.projectionSpy();
    try {
      await expect(repository(h.pool).save(candidate, initial)).rejects.toEqual(new IdentityPortError('STALE_WRITE'));
      expect(spy.mock.calls).toHaveLength(0);
      expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
      expect(h.stored()).toBe(row);
    } finally { spy.mockRestore(); }
  });
  it('R14 authentic createdAt mutation is rejected after the revision precondition', async () => {
    const value = create();
    const row = toRow(value);
    const candidate = testCase.read({ ...row, created_at: '999' } as Row);
    const h = harness(row);
    await expect(repository(h.pool).save(candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.stored()).toBe(row);
    expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
  });
  it('R14 a returned row with a different immutable identity is rejected', async () => {
    const value = create();
    const stored = toRow(value);
    const other = '018f0000-0000-7000-8000-000000000099';
    const candidate = testCase.read({ ...stored, [idColumn]: other } as Row);
    const h = harness(stored);
    await expect(repository(h.pool).save(candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.calls[1].values).toEqual([other]);
    expect(h.stored()).toBe(stored);
    expect(h.calls.some(call => call.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('create rejects missing, duplicate or mismatched RETURNING results', async () => {
    const value = create();
    for (const result of [
      { command: 'INSERT', rowCount: 0, rows: [] },
      { command: 'INSERT', rowCount: 2, rows: [toRow(value), toRow(value)] },
      { command: 'INSERT', rowCount: 1, rows: [toRow(value, '2')] },
    ]) {
      const h = harness(null);
      h.mutate(result);
      await expect(repository(h.pool).create(value)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
      expect(h.stored()).toBeNull();
      expect(h.calls.at(-1)?.sql).toBe('ROLLBACK');
    }
  });
  it('malformed SELECT cardinality fails closed, not missing/no-op', async () => {
    const h = harness(toRow(create()));
    h.query.mockImplementationOnce(async () => ({ rows: [], rowCount: 0, command: 'BEGIN' }));
    h.query.mockImplementationOnce(async () => ({ rows: [toRow(create()), toRow(create())], rowCount: 2, command: 'SELECT' }));
    await expect(repository(h.pool).find()).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
  });
  it.each([
    { rowCount: 0, rows: [], command: 'UPDATE' },
    { rowCount: 2, rows: [], command: 'UPDATE' },
    { rowCount: null, rows: [], command: 'UPDATE' },
    { rowCount: 1, rows: [], command: 'UPDATE' },
    { rowCount: 0, rows: [], command: 'SELECT' },
  ] as Result[])('R15 impossible CAS result is INTEGRITY, never blindly STALE/CONFLICT (%j)', async result => {
    const value = create();
    const row = toRow(value);
    const h = harness(row);
    h.mutate(result);
    await expect(repository(h.pool).save(change(value), initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.stored()).toBe(row);
    expect(h.calls.at(-1)?.sql).toBe('ROLLBACK');
  });
  it.each(['0', '01', '9223372036854775808'])('R16 corrupt stored revision %s fails through mapper, sanitized', async revision => {
    const h = harness(toRow(create(), revision));
    await expect(repository(h.pool).find()).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
    expect(h.calls.at(-1)?.sql).toBe('ROLLBACK');
  });
  it('R16 malformed stored UUID cannot become a Domain instance', async () => {
    const h = harness({ ...toRow(create()), [idColumn]: 'not-a-uuid' } as Row);
    await expect(repository(h.pool).find()).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
  });
  it('RETURNING revision or state drift aborts instead of returning apparent success', async () => {
    const value = create();
    const candidate = change(value);
    for (const returned of [toRow(candidate, '3'), toRow(value, '2')]) {
      const h = harness(toRow(value), returned);
      await expect(repository(h.pool).save(candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
      expect(h.calls.at(-1)?.sql).toBe('ROLLBACK');
      expect(h.stored()).toEqual(toRow(value));
    }
  });
  it.each(['0', '01', '9223372036854775808'])('invalid expected revision %s is rejected before SQL', async token => {
    const h = harness(toRow(create()));
    await expect(repository(h.pool).save(create(), token as RepositoryRevision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.connect).not.toHaveBeenCalled();
  });
});

describe('global repository lifecycle, composition and errors', () => {
  it.each([0, 1])('lossless DB projection rejects an issued invalid-text candidate only after stale check (%s)', async index => {
    const testCase = cases[index];
    const original = testCase.create() as User | Tenant;
    const candidate = original.disable(later, 'invalid\u0000reason');
    for (const [revision, code] of [['2', 'STALE_WRITE'], ['1', 'INTEGRITY_FAILURE']] as const) {
      const row = testCase.toRow(original, revision);
      const h = harness(row);
      const spy = testCase.projectionSpy();
      try {
        await expect(testCase.repository(h.pool).save(candidate, initial)).rejects.toEqual(new IdentityPortError(code));
        expect(spy.mock.calls).toHaveLength(revision === '2' ? 0 : 1);
        expect(h.stored()).toBe(row);
        expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
      } finally { spy.mockRestore(); }
    }
  });
  it('SystemAdminGrant persists a future finite validity window and its first revocation without filtering history', async () => {
    const grant = SystemAdminGrant.create({ id: gid, userId: uid, createdAt: now,
      validFrom: instant(4000), validUntil: instant(5000) });
    const revoked = grant.revoke(later);
    const createHarness = harness(null, cases[2].toRow(grant));
    const loaded = await new PostgresSystemAdminGrantRepository(createHarness.pool).createSystemAdminGrant(grant);
    expect(loaded.value).toEqual(grant);
    expect(createHarness.calls[1].values).toEqual([gid, uid, '1000', '4000', '5000', null]);
    const saveHarness = harness(cases[2].toRow(grant), cases[2].toRow(revoked, '2'));
    const saved = await new PostgresSystemAdminGrantRepository(saveHarness.pool).saveSystemAdminGrant(revoked, initial);
    expect(saved.value).toEqual(revoked);
    expect(saved.revision).toBe('2');
    expect(saveHarness.calls[2].values).toEqual(['2000', gid, '1']);
    const noopHarness = harness(cases[2].toRow(revoked, '2'));
    expect(await new PostgresSystemAdminGrantRepository(noopHarness.pool).saveSystemAdminGrant(revoked, saved.revision)).toEqual(saved);
    expect(noopHarness.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
  });
  it.each([0, 1])('complete User/Tenant comparison includes updatedAt even after returning to ACTIVE (%s)', async index => {
    const testCase = cases[index];
    const original = testCase.create() as User | Tenant;
    const candidate = original.disable(later, 'review').restore(later);
    const h = harness(testCase.toRow(original), testCase.toRow(candidate, '2'));
    const result = await testCase.repository(h.pool).save(candidate, initial);
    expect(result.value).toMatchObject({ status: 'ACTIVE' });
    expect(result.value).toEqual(candidate);
    expect(result.revision).toBe('2');
    expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
  });
  it.each([0, 1])('complete disabled-state comparison includes reason and disabledAt (%s)', async index => {
    const testCase = cases[index];
    const original = testCase.create() as User | Tenant;
    const disabled = original.disable(later, 'old reason');
    for (const changedRow of [
      { ...testCase.toRow(disabled), disabled_reason: 'new reason' },
      { ...testCase.toRow(disabled), disabled_at: '1500' },
    ]) {
      const candidate = testCase.read(changedRow);
      const h = harness(testCase.toRow(disabled), testCase.toRow(candidate, '2'));
      expect((await testCase.repository(h.pool).save(candidate, initial)).revision).toBe('2');
      expect(h.calls[2].sql).toMatch(/^UPDATE/);
      expect(h.calls[2].values).toEqual(testCase.updateParams(candidate, '1'));
    }
  });
  it('Tenant code lookup remains global, parameterized and uses the mapper', async () => {
    const value = Tenant.create(tid, 'school', 'School', now);
    const h = harness({ ...tenants.tenantToRow(value), repository_revision: '1' });
    expect((await new PostgresTenantRepository(h.pool).findByCode('school'))?.value).toEqual(value);
    expect(h.calls[1].sql).toContain('WHERE code = $1');
    expect(h.calls[1].values).toEqual(['school']);
    expect(await new PostgresTenantRepository(harness(null).pool).findByCode('missing')).toBeNull();
  });
  it('IdentityRepositoryPort grant methods delegate without nesting transactions', async () => {
    const value = cases[2].create();
    const h = harness(cases[2].toRow(value));
    const result = await new PostgresIdentityRepository(h.pool).findSystemAdminGrant(gid);
    expect(result?.value).toEqual(value);
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
  });
  it('IdentityRepositoryPort grant create/save delegate with the same frozen semantics', async () => {
    const original = cases[2].create() as SystemAdminGrant;
    const changed = original.revoke(later);
    const createdHarness = harness(null, cases[2].toRow(original));
    expect((await new PostgresIdentityRepository(createdHarness.pool).createSystemAdminGrant(original)).revision).toBe('1');
    const changedHarness = harness(cases[2].toRow(original), cases[2].toRow(changed, '2'));
    expect((await new PostgresIdentityRepository(changedHarness.pool).saveSystemAdminGrant(changed, initial)).revision).toBe('2');
    expect(changedHarness.connect).toHaveBeenCalledTimes(1);
  });
  it('global reads never bypass the exclusive client with pool.query', async () => {
    const h = harness(cases[0].toRow(cases[0].create()));
    const bypass = vi.fn(() => { throw new Error('pool query bypass'); });
    await new PostgresIdentityRepository({ connect: h.connect, query: bypass } as TransactionPool).findById(uid);
    expect(bypass).not.toHaveBeenCalled();
    expect(h.calls.some(call => /set_config|SET ROLE|app\.tenant_id/.test(call.sql))).toBe(false);
  });
  it.each(['code', 'display_name'])('Tenant %s is immutable, with no write or partial storage mutation', async key => {
    const original = cases[1].create();
    const row = cases[1].toRow(original) as tenants.TenantRow;
    const candidate = tenants.tenantFromRow({ ...row, [key]: 'different' }).value;
    const h = harness(row);
    await expect(new PostgresTenantRepository(h.pool).save(candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.stored()).toBe(row);
    expect(h.calls.some(call => call.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('ARCHIVED Tenant cannot resume or mutate its historical snapshot', async () => {
    const original = Tenant.create(tid, 'school', 'School', now).archive(later);
    const row = cases[1].toRow(original) as tenants.TenantRow;
    // Both candidates satisfy timestamp/immutable checks: only archive finality rejects them.
    for (const candidate of [
      tenants.tenantFromRow({ ...row, status: 'ACTIVE' }).value,
      tenants.tenantFromRow({ ...row, updated_at: '3000' }).value,
    ]) {
      const h = harness(row);
      await expect(new PostgresTenantRepository(h.pool).save(candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
      expect(h.stored()).toBe(row);
      expect(h.calls.some(call => call.sql.startsWith('UPDATE'))).toBe(false);
    }
  });
  it.each([0, 1])('GN05/GN06 restore from DISABLED advances once; rollback timestamps reject (%s)', async index => {
    const testCase = cases[index];
    const original = testCase.create() as User | Tenant;
    const disabled = original.disable(later, 'review');
    const restored = disabled.restore(instant(3000));
    const h = harness(testCase.toRow(disabled, '2'), testCase.toRow(restored, '3'));
    const loaded = await testCase.repository(h.pool).save(restored, repositoryRevision('2'));
    expect(loaded.value).toEqual(restored);
    expect(loaded.revision).toBe('3');
    const rollback = harness(testCase.toRow(disabled, '2'));
    await expect(testCase.repository(rollback.pool).save(original, repositoryRevision('2'))).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(rollback.calls.some(call => call.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('GN06 archive from DISABLED preserves disabled history and advances revision', async () => {
    const disabled = Tenant.create(tid, 'school', 'School', now).disable(later, 'preserve');
    const archived = disabled.archive(instant(3000));
    const h = harness(cases[1].toRow(disabled, '2'), cases[1].toRow(archived, '3'));
    const loaded = await new PostgresTenantRepository(h.pool).save(archived, repositoryRevision('2'));
    expect(loaded.value).toEqual(archived);
    expect(loaded.value.disabledReason).toBe('preserve');
    expect(loaded.value.disabledAt).toBe(later);
    expect(loaded.revision).toBe('3');
  });
  it.each(['user_id', 'valid_from', 'valid_until'])('SystemAdminGrant immutable %s cannot change', async key => {
    const value = cases[2].create();
    const row = cases[2].toRow(value) as admins.SystemAdminGrantRow;
    const changed = key === 'user_id' ? tid : key === 'valid_from' ? '1001' : '3000';
    const candidate = admins.systemAdminGrantFromRow({ ...row, [key]: changed }).value;
    const h = harness(row);
    await expect(new PostgresSystemAdminGrantRepository(h.pool).saveSystemAdminGrant(candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.stored()).toBe(row);
  });
  it.each([null, '3000'])('SystemAdminGrant first revocation cannot clear/rewrite (%s)', async revoked_at => {
    const value = cases[2].change(cases[2].create());
    const row = cases[2].toRow(value) as admins.SystemAdminGrantRow;
    const candidate = admins.systemAdminGrantFromRow({ ...row, revoked_at }).value;
    const h = harness(row);
    await expect(new PostgresSystemAdminGrantRepository(h.pool).saveSystemAdminGrant(candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.stored()).toBe(row);
  });
  it('NOOP returns the actual stored Loaded object from mapper, not a new candidate wrapper', async () => {
    const candidate = cases[0].create() as User;
    const h = harness(cases[0].toRow(candidate));
    const original = users.userFromRow;
    const loads: ReturnType<typeof original>[] = [];
    const spy = vi.spyOn(users, 'userFromRow').mockImplementation(row => {
      const loaded = original(row); loads.push(loaded); return loaded;
    });
    try {
      const result = await new PostgresIdentityRepository(h.pool).save(candidate, initial);
      expect(result).toBe(loads[0]);
      expect(result.value).not.toBe(candidate);
    } finally { spy.mockRestore(); }
  });
  for (const [code, expected] of [
    ['40001', 'RETRYABLE_PERSISTENCE_FAILURE'], ['40P01', 'RETRYABLE_PERSISTENCE_FAILURE'],
    ['23503', 'INTEGRITY_FAILURE'], ['23514', 'INTEGRITY_FAILURE'], ['42501', 'UNAVAILABLE'],
    ['08006', 'UNAVAILABLE'], ['57014', 'UNAVAILABLE'], ['unknown', 'UNAVAILABLE'],
  ]) {
    it(`R18 SQLSTATE ${code} maps only to ${expected}, without retry or detail leak`, async () => {
      const h = harness(cases[0].toRow(cases[0].create()));
      h.failures.set('SELECT', { code, message: 'private DB detail', detail: 'private SQL' });
      await expect(new PostgresIdentityRepository(h.pool).findById(uid)).rejects.toEqual(new IdentityPortError(expected as IdentityPortError['code']));
      expect(h.connect).toHaveBeenCalledTimes(1);
      expect(h.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
      expect(h.release).toHaveBeenCalledTimes(1);
    });
  }
  it.each([
    [0, 'users_pkey', 'CONFLICT'], [1, 'tenants_pkey', 'CONFLICT'],
    [1, 'tenants_code_key', 'CONFLICT'], [2, 'system_admin_grants_pkey', 'CONFLICT'],
    [0, 'unapproved', 'UNAVAILABLE'], [0, 'tenants_pkey', 'UNAVAILABLE'],
    [1, 'users_pkey', 'UNAVAILABLE'], [2, 'tenants_code_key', 'UNAVAILABLE'],
  ] as const)('operation-owned constraint (%s, %s) maps only to %s', async (index, constraint, code) => {
    const h = harness(null);
    h.failures.set('INSERT', { code: '23505', constraint, detail: 'private' });
    await expect(cases[index].repository(h.pool).create(cases[index].create())).rejects.toMatchObject({ code });
  });
  it('unknown throw / accessor SQLSTATE is not treated as retryable', async () => {
    const getter = vi.fn(() => '40001');
    const error = Object.defineProperty({}, 'code', { get: getter });
    for (const failure of [undefined, '40001', error, new TypeError('driver wiring failure')]) {
      const h = harness(null);
      h.failures.set('SELECT', failure);
      await expect(new PostgresIdentityRepository(h.pool).findById(uid)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('primary retryable error survives rollback and release failures', async () => {
    const h = harness(null);
    h.failures.set('SELECT', { code: '40001' });
    h.failures.set('ROLLBACK', new Error('secondary rollback'));
    h.release.mockImplementation(() => { throw new Error('secondary release'); });
    await expect(new PostgresIdentityRepository(h.pool).findById(uid)).rejects.toMatchObject({ code: 'RETRYABLE_PERSISTENCE_FAILURE' });
    expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it.each(['BEGIN', 'COMMIT'])('transaction %s failure is not successful load', async operation => {
    const h = harness(cases[0].toRow(cases[0].create()));
    h.failures.set(operation, new Error('network'));
    await expect(new PostgresIdentityRepository(h.pool).findById(uid)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('connect and release failure remain sanitized infrastructure failures', async () => {
    const h = harness(null);
    h.connect.mockRejectedValueOnce(new TypeError('private connection string'));
    await expect(new PostgresIdentityRepository(h.pool).findById(uid)).rejects.toEqual(new IdentityPortError('UNAVAILABLE'));
    expect(h.release).not.toHaveBeenCalled();
    const releaseHarness = harness(cases[0].toRow(cases[0].create()));
    releaseHarness.release.mockImplementation(() => { throw new TypeError('private release'); });
    await expect(new PostgresIdentityRepository(releaseHarness.pool).findById(uid)).rejects.toEqual(new IdentityPortError('UNAVAILABLE'));
    expect(releaseHarness.release).toHaveBeenCalledTimes(1);
  });
  it('Port/Fake User and Tenant create, changes and no-op revisions agree', async () => {
    const identity = new FakeIdentityRepository();
    const tenant = new FakeTenantRepository();
    for (const index of [0, 1] as const) {
      const testCase = cases[index];
      const value = testCase.create();
      const candidate = testCase.change(value);
      const fakeCreate = index === 0 ? await identity.create(value as User) : await tenant.create(value as Tenant);
      const fakeSave = index === 0 ? await identity.save(candidate as User, initial) : await tenant.save(candidate as Tenant, initial);
      const h = harness(testCase.toRow(value), testCase.toRow(candidate, '2'));
      const actual = await testCase.repository(h.pool).save(candidate, initial);
      expect(fakeCreate.revision).toBe('1');
      expect(actual).toEqual(fakeSave);
      const equal = index === 0 ? await identity.save(candidate as User, fakeSave.revision) : await tenant.save(candidate as Tenant, fakeSave.revision);
      expect(equal).toBe(fakeSave);
    }
  });
  it('Port/Fake SystemAdminGrant first revoke and identical revoked no-op agree', async () => {
    const fake = new FakeIdentityRepository();
    const original = cases[2].create() as SystemAdminGrant;
    const changed = original.revoke(later);
    await fake.createSystemAdminGrant(original);
    const expected = await fake.saveSystemAdminGrant(changed, initial);
    const h = harness(cases[2].toRow(original), cases[2].toRow(changed, '2'));
    expect(await new PostgresSystemAdminGrantRepository(h.pool).saveSystemAdminGrant(changed, initial)).toEqual(expected);
    const noop = harness(cases[2].toRow(changed, '2'));
    expect(await new PostgresSystemAdminGrantRepository(noop.pool).saveSystemAdminGrant(changed, expected.revision)).toEqual(expected);
    expect(await fake.saveSystemAdminGrant(changed, expected.revision)).toBe(expected);
    expect(noop.calls.map(call => call.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
  });
});
