import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { Membership, RoleGrant, instant, membershipId, userId, tenantId, roleGrantId, tenantScope } from '@/lib/zhiban/domain/identity';
import { repositoryRevision, type RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { tenantScopeContext, type TenantContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import * as mapper from '@/lib/zhiban/infrastructure/identity/postgres/mappers/membership';
import type { MembershipRow, RoleGrantRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/membership';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import { FakeMembershipRepository } from '../contracts/fakes';

const tenant = tenantId('018f0000-0000-7000-8000-000000000001');
const otherTenant = tenantId('018f0000-0000-7000-8000-000000000002');
const user = userId('018f0000-0000-7000-8000-000000000003');
const id = membershipId('018f0000-0000-7000-8000-000000000004');
const otherId = membershipId('018f0000-0000-7000-8000-000000000005');
const context = tenantScopeContext(tenant);
const initial = repositoryRevision('1');
const parentColumns = 'membership_id, user_id, tenant_id, status, authorization_version, created_at, updated_at, disabled_at, disabled_reason, repository_revision';
const childColumns = 'grant_id, tenant_id, membership_id, grant_ordinal, role_code, scope_kind, scope_id, created_at, valid_from, valid_until, revoked_at';
const scopeSql = "SELECT set_config('app.tenant_id', $1, true)";
const parentSql = `SELECT ${parentColumns} FROM zhiban_identity.memberships WHERE tenant_id = $1 AND membership_id = $2`;
const userSql = `SELECT ${parentColumns} FROM zhiban_identity.memberships WHERE tenant_id = $1 AND user_id = $2`;
const childrenSql = `SELECT ${childColumns} FROM zhiban_identity.role_grants WHERE tenant_id = $1 AND membership_id = $2 ORDER BY grant_ordinal, grant_id`;
type Result = { rows: unknown[]; rowCount: number | null; command: string };
type Label = 'BEGIN' | 'CONTEXT' | 'PARENT_READ' | 'CHILD_READ' | 'ALLOCATE' | 'PARENT_INSERT' | 'PARENT_UPDATE' | 'CHILD_INSERT' | 'CHILD_REVOKE' | 'COMMIT' | 'ROLLBACK';
const result = (command: string, rows: unknown[] = []): Result => ({ command, rows, rowCount: rows.length });

function grant(n: number, from = 1000, until: number | null = null) {
  return RoleGrant.create({ id: roleGrantId(`018f0000-0000-7000-8000-${n.toString().padStart(12, '0')}`),
    roleCode: 'STUDENT', scope: tenantScope(), createdAt: instant(1000), validFrom: instant(from),
    validUntil: until === null ? null : instant(until) });
}
function pending(grants: readonly RoleGrant[] = []) {
  return Membership.create({ id, userId: user, tenantId: tenant, now: instant(3000), roleGrants: grants });
}
function rows(member: Membership, revision = '1') {
  const projected = mapper.membershipToRows(member);
  return { parent: { ...projected.membership, repository_revision: revision }, children: [...projected.roleGrants] };
}
function snapshot(member: Membership, changes: Partial<MembershipRow> = {}, childRows?: readonly RoleGrantRow[]) {
  const stored = rows(member);
  return mapper.membershipFromRows({ ...stored.parent, ...changes }, childRows ?? stored.children).value;
}
function active() {
  return snapshot(pending([grant(10), grant(11, 5000), grant(12, 1000, 2000), grant(13, 5000).revoke(instant(2000))]),
    { status: 'ACTIVE', authorization_version: '7' });
}
const activate = (member: Membership) => member.activatePending({ now: instant(4000),
  expectedAuthorizationVersion: member.authorizationVersion, approvedGrants: [] });

/** Stateful Promise-only pg double: applies explicit SQL parameters, not preselected RETURNING snapshots.
 * Exact statements are independently checked here; real PG16 concurrency/RLS signoff is separate.
 */
function harness(member: Membership | null, revision = '1') {
  const original = member ? rows(member, revision) : { parent: null, children: [] };
  let parent: MembershipRow | null = original.parent;
  let childRows: RoleGrantRow[] = [...original.children];
  let transactionSnapshot = { parent, children: [...childRows] };
  let localTenant: string | null = null;
  let open = false;
  const calls: { label: Label; sql: string; values: unknown[] }[] = [];
  const failures = new Map<Label, { error: unknown; occurrence: number }>();
  const overrides = new Map<Label, Result>();
  const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<Result> => {
    let label: Label;
    if (sql.startsWith('BEGIN')) label = 'BEGIN';
    else if (sql === scopeSql) label = 'CONTEXT';
    else if (sql === 'COMMIT' || sql === 'ROLLBACK') label = sql;
    else if (sql.startsWith('SELECT COALESCE')) label = 'ALLOCATE';
    else if (sql.startsWith('SELECT') && sql.includes('FROM zhiban_identity.memberships')) label = 'PARENT_READ';
    else if (sql.startsWith('SELECT') && sql.includes('FROM zhiban_identity.role_grants')) label = 'CHILD_READ';
    else if (sql.startsWith('INSERT INTO zhiban_identity.memberships')) label = 'PARENT_INSERT';
    else if (sql.startsWith('UPDATE zhiban_identity.memberships')) label = 'PARENT_UPDATE';
    else if (sql.startsWith('INSERT INTO zhiban_identity.role_grants')) label = 'CHILD_INSERT';
    else if (sql.startsWith('UPDATE zhiban_identity.role_grants')) label = 'CHILD_REVOKE';
    else throw new Error('Unexpected SQL, including DELETE/session-global SET');
    calls.push({ label, sql, values });
    const failure = failures.get(label);
    if (failure && calls.filter(call => call.label === label).length === failure.occurrence) throw failure.error;
    const text = (index: number): string => {
      const value = values[index];
      if (typeof value !== 'string') throw new Error(`Expected string SQL parameter ${index}`);
      return value;
    };
    const nullable = (index: number) => values[index] === null ? null : text(index);
    let returned: Result;
    if (label === 'BEGIN') {
      expect(open).toBe(false); open = true;
      transactionSnapshot = { parent, children: [...childRows] };
      expect(sql).toMatch(/^BEGIN ISOLATION LEVEL (?:READ COMMITTED|REPEATABLE READ READ ONLY)$/);
      returned = result('BEGIN');
    } else if (label === 'CONTEXT') {
      expect(open).toBe(true); expect(localTenant).toBeNull();
      expect(values).toHaveLength(1); localTenant = text(0);
      returned = result('SELECT', [{ set_config: localTenant }]);
    } else if (label === 'ROLLBACK') {
      parent = transactionSnapshot.parent; childRows = [...transactionSnapshot.children]; open = false; localTenant = null;
      returned = result('ROLLBACK');
    } else if (label === 'COMMIT') {
      expect(open).toBe(true); open = false; localTenant = null;
      returned = result('COMMIT');
    } else {
      expect(open).toBe(true); expect(localTenant).not.toBeNull();
      if (label === 'PARENT_READ') {
        expect([parentSql, parentSql + ' FOR UPDATE', userSql]).toContain(sql);
        expect(values).toHaveLength(2); expect(text(0)).toBe(localTenant);
        const key = sql === userSql ? parent?.user_id : parent?.membership_id;
        returned = result('SELECT', parent && parent.tenant_id === text(0) && key === text(1) ? [parent] : []);
      } else if (label === 'CHILD_READ') {
        expect(sql).toBe(childrenSql); expect(values).toHaveLength(2); expect(text(0)).toBe(localTenant);
        returned = result('SELECT', childRows.filter(row => row.tenant_id === text(0) && row.membership_id === text(1)));
      } else if (label === 'ALLOCATE') {
        expect(sql).toBe('SELECT COALESCE(MAX(grant_ordinal), -1::bigint) + 1 AS next_ordinal FROM zhiban_identity.role_grants WHERE tenant_id = $1 AND membership_id = $2');
        expect(values).toHaveLength(2); expect(text(0)).toBe(localTenant);
        const maximum = childRows.filter(row => row.tenant_id === text(0) && row.membership_id === text(1))
          .reduce((max, row) => BigInt(row.grant_ordinal) > max ? BigInt(row.grant_ordinal) : max, BigInt(-1));
        returned = result('SELECT', [{ next_ordinal: (maximum + BigInt(1)).toString() }]);
      } else if (label === 'PARENT_INSERT') {
        expect(sql).toBe(`INSERT INTO zhiban_identity.memberships (${parentColumns}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1) RETURNING ${parentColumns}`);
        expect(values).toHaveLength(9); expect(text(2)).toBe(localTenant);
        if (parent) throw { code: '23505', constraint: 'memberships_pkey' };
        parent = { membership_id: text(0), user_id: text(1), tenant_id: text(2), status: text(3),
          authorization_version: text(4), created_at: text(5), updated_at: text(6), disabled_at: nullable(7),
          disabled_reason: nullable(8), repository_revision: '1' };
        returned = result('INSERT', [parent]);
      } else if (label === 'PARENT_UPDATE') {
        expect(sql).toBe(`UPDATE zhiban_identity.memberships SET status = $1, authorization_version = $2, updated_at = $3, disabled_at = $4, disabled_reason = $5, repository_revision = repository_revision + 1 WHERE tenant_id = $6 AND membership_id = $7 AND repository_revision = $8::bigint RETURNING ${parentColumns}`);
        expect(values).toHaveLength(8); expect(text(5)).toBe(localTenant);
        if (!parent || parent.tenant_id !== text(5) || parent.membership_id !== text(6) || parent.repository_revision !== text(7)) returned = result('UPDATE');
        else {
          parent = { ...parent, status: text(0), authorization_version: text(1), updated_at: text(2),
            disabled_at: nullable(3), disabled_reason: nullable(4), repository_revision: (BigInt(parent.repository_revision) + BigInt(1)).toString() };
          returned = result('UPDATE', [parent]);
        }
      } else if (label === 'CHILD_INSERT') {
        expect(sql).toBe(`INSERT INTO zhiban_identity.role_grants (${childColumns}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${childColumns}`);
        expect(values).toHaveLength(11); expect(text(1)).toBe(localTenant);
        expect(parent?.membership_id).toBe(text(2)); expect(parent?.tenant_id).toBe(text(1));
        const row = { grant_id: text(0), tenant_id: text(1), membership_id: text(2), grant_ordinal: text(3),
          role_code: text(4), scope_kind: text(5), scope_id: nullable(6), created_at: text(7),
          valid_from: text(8), valid_until: nullable(9), revoked_at: nullable(10) };
        if (childRows.some(child => child.grant_id === row.grant_id)) throw { code: '23505', constraint: 'role_grants_pkey' };
        childRows.push(row); returned = result('INSERT', [row]);
      } else {
        expect(sql).toBe(`UPDATE zhiban_identity.role_grants SET revoked_at = $1 WHERE tenant_id = $2 AND membership_id = $3 AND grant_id = $4 AND revoked_at IS NULL RETURNING ${childColumns}`);
        expect(values).toHaveLength(4); expect(text(1)).toBe(localTenant);
        const index = childRows.findIndex(row => row.tenant_id === text(1) && row.membership_id === text(2) && row.grant_id === text(3) && row.revoked_at === null);
        if (index < 0) returned = result('UPDATE');
        else { childRows[index] = { ...childRows[index], revoked_at: text(0) }; returned = result('UPDATE', [childRows[index]]); }
      }
    }
    return overrides.get(label) ?? returned;
  });
  const release = vi.fn();
  const client = { query: query as unknown as PoolClient['query'], release };
  const connect = vi.fn(async () => client);
  const poolQuery = vi.fn(() => { throw new Error('pool.query bypass'); });
  const pool: TransactionPool = { connect, query: poolQuery } as TransactionPool;
  return { pool, calls, query, connect, release, poolQuery, overrides,
    fail: (label: Label, error: unknown, occurrence = 1) => failures.set(label, { error, occurrence }),
    state: () => ({ parent, children: childRows }), local: () => localTenant };
}
function labels(h: ReturnType<typeof harness>) { return h.calls.map(call => call.label); }
function writes(h: ReturnType<typeof harness>) { return h.calls.filter(call => /^(?:PARENT|CHILD)_(?:INSERT|UPDATE|REVOKE)$/.test(call.label)); }
async function rejectedUnchanged(stored: Membership, candidate: Membership, code = 'INTEGRITY_FAILURE') {
  const h = harness(stored);
  await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError(code as IdentityPortError['code']));
  expect(writes(h)).toEqual([]); expect(h.state()).toEqual(rows(stored));
  expect(h.calls.at(-1)?.label).toBe('ROLLBACK'); expect(h.release).toHaveBeenCalledTimes(1);
}

describe('Membership aggregate scoped load and create', () => {
  it.each([0, 1, 4])('MREP01/MREP02 load preserves %s children on one read-only snapshot', async count => {
    const member = active(); const stored = snapshot(member, {}, rows(member).children.slice(0, count));
    const h = harness(stored, '9007199254740993');
    const loaded = await new PostgresMembershipRepository(h.pool).findById(context, id);
    expect(loaded?.value).toEqual(stored); expect(loaded?.value).not.toBe(stored);
    expect(loaded?.revision).toBe('9007199254740993');
    expect(labels(h)).toEqual(['BEGIN', 'CONTEXT', 'PARENT_READ', 'CHILD_READ', 'COMMIT']);
    expect(h.calls[0].sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(h.calls[1]).toEqual({ label: 'CONTEXT', sql: scopeSql, values: [tenant] });
    expect(h.calls[2].values).toEqual([tenant, id]); expect(h.calls[3].values).toEqual([tenant, id]);
    expect(h.connect).toHaveBeenCalledTimes(1); expect(h.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(h.poolQuery).not.toHaveBeenCalled(); expect(h.local()).toBeNull();
  });
  it('findByUser uses both tenant and user predicates and retains all history', async () => {
    const member = active(); const h = harness(member);
    expect((await new PostgresMembershipRepository(h.pool).findByUser(context, user))?.value).toEqual(member);
    expect(h.calls[2]).toEqual({ label: 'PARENT_READ', sql: userSql, values: [tenant, user] });
    expect(h.calls[3].values).toEqual([tenant, id]);
  });
  it('MREP03 absent/invisible scoped reads are null with no child or unscoped probe; save is CONFLICT', async () => {
    for (const h of [harness(null), harness(active())]) {
      const scope = h.state().parent ? tenantScopeContext(otherTenant) : context;
      const repo = new PostgresMembershipRepository(h.pool);
      expect(await repo.findById(scope, id)).toBeNull(); expect(await repo.findByUser(scope, user)).toBeNull();
      expect(h.calls.some(call => call.label === 'CHILD_READ')).toBe(false);
    }
    const h = harness(null);
    await expect(new PostgresMembershipRepository(h.pool).save(context, pending(), initial)).rejects.toEqual(new IdentityPortError('CONFLICT'));
    expect(labels(h)).toEqual(['BEGIN', 'CONTEXT', 'PARENT_READ', 'ROLLBACK']);
  });
  it.each([0, 1, 4])('create atomically stores parent and all %s historical children at revision 1', async count => {
    const member = pending(active().roleGrants.slice(0, count)); const h = harness(null);
    const loaded = await new PostgresMembershipRepository(h.pool).create(context, member);
    expect(loaded.value).toEqual(member); expect(loaded.value).not.toBe(member); expect(loaded.revision).toBe('1');
    expect(h.state()).toEqual(rows(member));
    expect(labels(h)).toEqual(['BEGIN', 'CONTEXT', 'PARENT_INSERT',
      ...Array.from({ length: count }).flatMap(() => ['ALLOCATE', 'CHILD_INSERT']), 'CHILD_READ', 'COMMIT']);
    expect(h.calls[2].values).toEqual([id, user, tenant, 'PENDING', '0', '3000', '3000', null, null]);
    for (const call of h.calls.filter(call => call.label === 'CHILD_INSERT')) {
      const child = rows(member).children.find(row => row.grant_id === call.values[0])!;
      expect(call.values).toEqual([child.grant_id, tenant, id, child.grant_ordinal, child.role_code,
        child.scope_kind, child.scope_id, child.created_at, child.valid_from, child.valid_until, child.revoked_at]);
    }
    expect(h.release).toHaveBeenCalledExactlyOnceWith(false); expect(h.poolQuery).not.toHaveBeenCalled();
  });
  it('MREP04 missing/malformed context rejects before any connection', async () => {
    for (const scope of [undefined, null, {}, { tenantId: 'bad' }]) {
      const h = harness(active()); const repo = new PostgresMembershipRepository(h.pool);
      await expect(repo.findById(scope as TenantContext, id)).rejects.toMatchObject({ code: 'TENANT_SCOPE_VIOLATION' });
      await expect(repo.create(scope as TenantContext, pending())).rejects.toMatchObject({ code: 'TENANT_SCOPE_VIOLATION' });
      await expect(repo.save(scope as TenantContext, active(), initial)).rejects.toMatchObject({ code: 'TENANT_SCOPE_VIOLATION' });
      expect(h.connect).not.toHaveBeenCalled();
    }
  });
  it('MREP04/MREP18 candidate tenant mismatch rejects before projection or SQL', async () => {
    const candidate = snapshot(active(), { tenant_id: otherTenant }, rows(active()).children.map(row => ({ ...row, tenant_id: otherTenant })));
    const h = harness(active()); const spy = vi.spyOn(mapper, 'membershipToRows');
    try {
      await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError('TENANT_SCOPE_VIOLATION'));
      await expect(new PostgresMembershipRepository(h.pool).create(context, candidate)).rejects.toEqual(new IdentityPortError('TENANT_SCOPE_VIOLATION'));
      expect(spy).not.toHaveBeenCalled(); expect(h.connect).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it('tenant is captured once; a mutable caller context cannot split GUC and predicates', async () => {
    const getTenant = vi.fn().mockReturnValueOnce(tenant).mockReturnValue(otherTenant);
    const scope = Object.defineProperty({}, 'tenantId', { get: getTenant }) as TenantContext;
    const h = harness(active());
    expect((await new PostgresMembershipRepository(h.pool).findById(scope, id))?.value.tenantId).toBe(tenant);
    expect(getTenant).toHaveBeenCalledTimes(1);
    expect(h.calls[1].values).toEqual([tenant]); expect(h.calls[2].values).toEqual([tenant, id]);
  });
  it('MREP05 forged/frozen/complete-field candidates fail before property access, projection and connection', async () => {
    const member = active(); const h = harness(member); const reads = vi.fn();
    const forged = Object.freeze(Object.assign(Object.create(Membership.prototype), member));
    const getters = Object.create(Membership.prototype);
    for (const [key, value] of Object.entries(member)) Object.defineProperty(getters, key, { get: () => { reads(); return value; } });
    const spy = vi.spyOn(mapper, 'membershipToRows');
    try {
      for (const candidate of [forged, Object.freeze(getters), Object.freeze({ ...member })]) {
        await expect(new PostgresMembershipRepository(h.pool).save(context, candidate as Membership, initial)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
        await expect(new PostgresMembershipRepository(h.pool).create(context, candidate as Membership)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
      }
      expect(reads).not.toHaveBeenCalled(); expect(spy).not.toHaveBeenCalled(); expect(h.connect).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});

describe('Membership CAS, complete state and history decisions', () => {
  it.each(['PENDING', 'DISABLED', 'LEFT'] as const)('identical %s snapshot preserves every historical fact without writes', async status => {
    const member = status === 'PENDING' ? pending() : status === 'DISABLED'
      ? active().disable({ now: instant(4000), expectedAuthorizationVersion: 7, reason: 'preserve' })
      : active().leave({ now: instant(4000), expectedAuthorizationVersion: 7 });
    const h = harness(member, '2');
    const loaded = await new PostgresMembershipRepository(h.pool).save(context, member, repositoryRevision('2'));
    expect(loaded.value).toEqual(member); expect(loaded.value).not.toBe(member); expect(loaded.revision).toBe('2');
    expect(writes(h)).toEqual([]); expect(h.state()).toEqual(rows(member, '2'));
  });
  it.each([false, true])('MREP06 stale-before-no-op/change precedes child read and projection (%s)', async changed => {
    const member = active(); const candidate = changed ? member.disable({ now: instant(4000), expectedAuthorizationVersion: 7, reason: 'review' }) : member;
    const h = harness(member, '2'); const spy = vi.spyOn(mapper, 'membershipToRows');
    try {
      await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError('STALE_WRITE'));
      expect(labels(h)).toEqual(['BEGIN', 'CONTEXT', 'PARENT_READ', 'ROLLBACK']);
      expect(h.calls[2].sql).toBe(parentSql + ' FOR UPDATE'); expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it('MREP07/MREP13-MREP15/MREP20 full no-op at max has no writes and returns exact stored Loaded', async () => {
    const member = active(); const h = harness(member, '9223372036854775807');
    const spy = vi.spyOn(mapper, 'membershipFromRows');
    try {
      const loaded = await new PostgresMembershipRepository(h.pool).save(context, member, repositoryRevision('9223372036854775807'));
      expect(loaded).toBe(spy.mock.results[0].value); expect(loaded.value).not.toBe(member);
      expect(loaded.value).toEqual(member); expect(loaded.revision).toBe('9223372036854775807');
      expect(writes(h)).toEqual([]); expect(labels(h)).toEqual(['BEGIN', 'CONTEXT', 'PARENT_READ', 'CHILD_READ', 'COMMIT']);
    } finally { spy.mockRestore(); }
  });
  it.each([
    { updated_at: '4000' }, { created_at: '2500' }, { status: 'PENDING' }, { user_id: otherTenant },
  ])('MREP08 same auth with parent difference %j rejects unchanged', async changes => {
    const member = active(); await rejectedUnchanged(member, snapshot(member, changes));
  });
  it.each([{ disabled_at: '3500' }, { disabled_reason: 'different' }])('MREP08 same-auth disabled facts %j reject', async changes => {
    const member = active().disable({ now: instant(4000), expectedAuthorizationVersion: 7, reason: 'review' });
    await rejectedUnchanged(member, snapshot(member, changes));
  });
  it.each([
    { grant_id: otherId }, { role_code: 'TEACHER' }, { scope_kind: 'SELF' }, { created_at: '999' },
    { valid_from: '1100' }, { valid_until: '6000' }, { revoked_at: '2500' },
  ])('MREP09 same-auth complete child field %j rejects', async changes => {
    const member = active(); const projected = rows(member);
    await rejectedUnchanged(member, snapshot(member, {}, projected.children.map((row, index) => index === 0 ? { ...row, ...changes } : row)));
  });
  it.each([1, 2, 3])('MREP09 non-effective historical child %s remains in comparison', async index => {
    const member = active(); const projected = rows(member);
    await rejectedUnchanged(member, snapshot(member, {}, projected.children.map((row, at) => at === index ? { ...row, valid_from: row.valid_from === '5000' ? '5500' : '1100' } : row)));
  });
  it('MREP10 lower auth rejects even if other facts equal; higher-only jump is a state change', async () => {
    const member = active(); await rejectedUnchanged(member, snapshot(member, { authorization_version: '6' }));
    const higher = snapshot(member, { authorization_version: '10' }); const h = harness(member);
    const loaded = await new PostgresMembershipRepository(h.pool).save(context, higher, initial);
    expect(loaded.value).toEqual(higher); expect(loaded.revision).toBe('2');
    expect(labels(h)).toEqual(['BEGIN', 'CONTEXT', 'PARENT_READ', 'CHILD_READ', 'PARENT_UPDATE', 'CHILD_READ', 'COMMIT']);
    expect(h.calls[4].values).toEqual(['ACTIVE', '10', '3000', null, null, tenant, id, '1']);
  });
  it('MREP11/MREP12 disable changes parent once without rewriting any child', async () => {
    const member = active(); const candidate = member.disable({ now: instant(4000), expectedAuthorizationVersion: 7, reason: 'review' });
    const h = harness(member, '9007199254740993');
    const loaded = await new PostgresMembershipRepository(h.pool).save(context, candidate, repositoryRevision('9007199254740993'));
    expect(loaded.value).toEqual(candidate); expect(loaded.revision).toBe('9007199254740994');
    expect(writes(h).map(call => call.label)).toEqual(['PARENT_UPDATE']);
    expect(h.calls[4].values).toEqual(['DISABLED', '8', '4000', '4000', 'review', tenant, id, '9007199254740993']);
    expect(h.state().children).toEqual(rows(member).children);
  });
  it('MREP16/MREP21 append preserves all active/future/expired/revoked rows with database ordinal', async () => {
    const member = active(); const added = grant(20, 4000);
    const candidate = member.grantRole({ now: instant(4000), expectedAuthorizationVersion: 7, approvedGrant: added });
    const h = harness(member); const loaded = await new PostgresMembershipRepository(h.pool).save(context, candidate, initial);
    expect(loaded.value).toEqual(candidate); expect(h.state()).toEqual(rows(candidate, '2'));
    expect(labels(h)).toEqual(['BEGIN', 'CONTEXT', 'PARENT_READ', 'CHILD_READ', 'PARENT_UPDATE', 'ALLOCATE', 'CHILD_INSERT', 'CHILD_READ', 'COMMIT']);
    expect(h.calls[6].values).toEqual([added.id, tenant, id, '4', 'STUDENT', 'TENANT', null, '1000', '4000', null, null]);
    expect(h.connect).toHaveBeenCalledTimes(1); expect(h.release).toHaveBeenCalledTimes(1); expect(h.poolQuery).not.toHaveBeenCalled();
  });
  it('replacement first-revokes old grants, appends approved rows, and never DELETEs or rewrites first revocation', async () => {
    const member = active(); const candidate = member.replaceGrants({ now: instant(4000), expectedAuthorizationVersion: 7, approvedGrants: [grant(20, 4000), grant(21, 5000)] });
    const h = harness(member); const loaded = await new PostgresMembershipRepository(h.pool).save(context, candidate, initial);
    expect(loaded.value).toEqual(candidate); expect(h.state()).toEqual(rows(candidate, '2'));
    expect(writes(h).map(call => call.label)).toEqual(['PARENT_UPDATE', 'CHILD_REVOKE', 'CHILD_REVOKE', 'CHILD_REVOKE', 'CHILD_INSERT', 'CHILD_INSERT']);
    expect(h.state().children.map(row => row.grant_ordinal)).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(h.state().children[3].revoked_at).toBe('2000');
    expect(h.calls.filter(call => call.label === 'CHILD_REVOKE').map(call => call.values)).toEqual(member.roleGrants.slice(0, 3).map(old => ['4000', tenant, id, old.id]));
    expect(h.calls.some(call => /DELETE|xmin/.test(call.sql))).toBe(false);
  });
  it('child-only first revoke advances parent once; repeated revoke is a true no-op', async () => {
    const member = active(); const candidate = member.revokeGrant({ now: instant(4000), expectedAuthorizationVersion: 7, grantId: member.roleGrants[0].id });
    const h = harness(member); const repo = new PostgresMembershipRepository(h.pool);
    const saved = await repo.save(context, candidate, initial);
    expect(saved.revision).toBe('2'); expect(writes(h).map(call => call.label)).toEqual(['PARENT_UPDATE', 'CHILD_REVOKE']);
    const after = harness(candidate, '2');
    const same = candidate.revokeGrant({ now: instant(5000), expectedAuthorizationVersion: 8, grantId: candidate.roleGrants[0].id });
    expect((await new PostgresMembershipRepository(after.pool).save(context, same, saved.revision)).revision).toBe('2');
    expect(writes(after)).toEqual([]);
  });
  it('leave/rejoin retains all first-revocation times and appends a new approved history entry', async () => {
    const member = active(); const left = member.leave({ now: instant(4000), expectedAuthorizationVersion: 7 });
    const rejoined = left.rejoin({ now: instant(5000), expectedAuthorizationVersion: 8, approvedGrants: [grant(20, 5000)] });
    const h = harness(member); const repo = new PostgresMembershipRepository(h.pool);
    const saved = await repo.save(context, left, initial);
    expect(saved.value).toEqual(left); expect(saved.revision).toBe('2');
    const offset = h.calls.length;
    const next = await repo.save(context, rejoined, saved.revision);
    expect(next.value).toEqual(rejoined); expect(next.revision).toBe('3'); expect(h.state()).toEqual(rows(rejoined, '3'));
    expect(h.calls.slice(offset).filter(call => /^(?:PARENT|CHILD)_(?:UPDATE|INSERT|REVOKE)$/.test(call.label)).map(call => call.label)).toEqual(['PARENT_UPDATE', 'CHILD_INSERT']);
    expect(h.state().children.map(row => row.revoked_at)).toEqual(['4000', '4000', '4000', '2000', null]);
  });
  it('preserve reactivation persists the full history, not only approved/effective children', async () => {
    const disabled = active().disable({ now: instant(4000), expectedAuthorizationVersion: 7, reason: 'review' });
    const restored = disabled.reactivate({ now: instant(4500), expectedAuthorizationVersion: 8,
      mode: 'PRESERVE_EXISTING_VALID_GRANTS', approvedGrantIds: [disabled.roleGrants[0].id] });
    const h = harness(disabled);
    expect((await new PostgresMembershipRepository(h.pool).save(context, restored, initial)).value).toEqual(restored);
    expect(h.state().children).toHaveLength(4);
    expect(h.state().children.map(row => row.revoked_at)).toEqual([null, '4500', '4500', '2000']);
    expect(writes(h).map(call => call.label)).toEqual(['PARENT_UPDATE', 'CHILD_REVOKE', 'CHILD_REVOKE']);
  });
  it('higher auth cannot roll back updatedAt; stale still precedes all invariant checks', async () => {
    const member = snapshot(active(), { updated_at: '4000' });
    const candidate = snapshot(member, { updated_at: '3000', authorization_version: '8' });
    await rejectedUnchanged(member, candidate);
    const h = harness(member, '2');
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError('STALE_WRITE'));
    expect(labels(h)).toEqual(['BEGIN', 'CONTEXT', 'PARENT_READ', 'ROLLBACK']);
  });
  it.each(['remove', 'reorder', 'clear-revoke', 'rewrite-revoke', 'edit-window', 'edit-role'])('higher auth cannot %s historical grants', async kind => {
    const member = active(); let children = rows(member).children;
    if (kind === 'remove') children = children.slice(0, 3);
    else if (kind === 'reorder') children = [children[1], children[0], ...children.slice(2)].map((row, index) => ({ ...row, grant_ordinal: index.toString() }));
    else children = children.map((row, index) => {
      if (kind === 'clear-revoke' && index === 3) return { ...row, revoked_at: null };
      if (kind === 'rewrite-revoke' && index === 3) return { ...row, revoked_at: '2500' };
      if (kind === 'edit-window' && index === 0) return { ...row, valid_from: '1100' };
      if (kind === 'edit-role' && index === 0) return { ...row, role_code: 'TEACHER' };
      return row;
    });
    await rejectedUnchanged(member, snapshot(member, { authorization_version: '8' }, children));
  });
  it('MREP18 ownership/createdAt/identity mutation fails before writes', async () => {
    const member = active();
    for (const changes of [{ user_id: otherTenant }, { created_at: '2500' }]) await rejectedUnchanged(member, snapshot(member, { ...changes, authorization_version: '8' }));
    const h = harness(member);
    const candidate = snapshot(member, { membership_id: otherId }, rows(member).children.map(row => ({ ...row, membership_id: otherId })));
    h.overrides.set('PARENT_READ', result('SELECT', [rows(member).parent]));
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(writes(h)).toEqual([]); expect(h.calls[2].values).toEqual([tenant, otherId]);
  });
  it('MREP19 max state change fails closed before any parent/child write', async () => {
    const member = active(); const h = harness(member, '9223372036854775807');
    const candidate = member.revokeGrant({ now: instant(4000), expectedAuthorizationVersion: 7, grantId: member.roleGrants[0].id });
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, repositoryRevision('9223372036854775807'))).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(writes(h)).toEqual([]); expect(h.state()).toEqual(rows(member, '9223372036854775807'));
  });
  it('last legal repository revision reaches int8 max precisely', async () => {
    const member = pending(); const h = harness(member, '9223372036854775806');
    expect((await new PostgresMembershipRepository(h.pool).save(context, activate(member), repositoryRevision('9223372036854775806'))).revision).toBe('9223372036854775807');
  });
});

describe('Membership corruption, SQL results, rollback and contract compatibility', () => {
  it('unsorted driver child rows still reconstruct deterministic ordinal history', async () => {
    const member = active(); const h = harness(member);
    h.overrides.set('CHILD_READ', result('SELECT', rows(member).children.reverse()));
    expect((await new PostgresMembershipRepository(h.pool).findById(context, id))?.value).toEqual(member);
    expect(h.calls[3].sql).toBe(childrenSql);
  });
  it.each(['id', 'user'] as const)('unexpected cross-tenant parent in %s lookup is rejected, not exposed', async lookup => {
    const member = active(); const h = harness(member);
    h.overrides.set('PARENT_READ', result('SELECT', [{ ...rows(member).parent, tenant_id: otherTenant }]));
    const repo = new PostgresMembershipRepository(h.pool);
    await expect(lookup === 'id' ? repo.findById(context, id) : repo.findByUser(context, user)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.calls.some(call => call.label === 'CHILD_READ')).toBe(false);
  });
  it('child SELECT result cardinality is validated before assembly', async () => {
    const h = harness(active()); h.overrides.set('CHILD_READ', { command: 'SELECT', rows: [], rowCount: null });
    await expect(new PostgresMembershipRepository(h.pool).findById(context, id)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
  });
  it.each([{ tenant_id: otherTenant }, { membership_id: otherId }])('MREP17 wrong child association %j fails through mapper', async changes => {
    const member = active(); const h = harness(member);
    h.overrides.set('CHILD_READ', result('SELECT', rows(member).children.map((row, index) => index === 0 ? { ...row, ...changes } : row)));
    await expect(new PostgresMembershipRepository(h.pool).findById(context, id)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
    expect(writes(h)).toEqual([]); expect(h.calls.at(-1)?.label).toBe('ROLLBACK');
  });
  it.each([
    { repository_revision: '0' }, { repository_revision: '9223372036854775808' }, { authorization_version: '9007199254740992' },
    { status: 'UNKNOWN' }, { updated_at: '1.0' }, { disabled_at: undefined }, { membership_id: 'bad' },
  ])('MREP24 malformed parent %j fails closed', async changes => {
    const h = harness(active()); h.overrides.set('PARENT_READ', result('SELECT', [{ ...rows(active()).parent, ...changes }]));
    await expect(new PostgresMembershipRepository(h.pool).findById(context, id)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
    expect(h.calls.at(-1)?.label).toBe('ROLLBACK');
  });
  it.each([{ grant_ordinal: '01' }, { grant_ordinal: '1' }, { role_code: 'SYSTEM_ADMIN' }, { revoked_at: '999' }])('MREP24 malformed child %j fails closed', async changes => {
    const h = harness(active()); const childRows = rows(active()).children;
    h.overrides.set('CHILD_READ', result('SELECT', childRows.map((row, index) => index === 0 ? { ...row, ...changes } : row)));
    await expect(new PostgresMembershipRepository(h.pool).findById(context, id)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
  });
  it.each(['0', '01', '+1', '1.0', '9223372036854775808'])('malformed expected revision %s fails before connection', async token => {
    const h = harness(active());
    await expect(new PostgresMembershipRepository(h.pool).save(context, active(), token as RepositoryRevision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.connect).not.toHaveBeenCalled();
  });
  it.each([
    result('UPDATE'), { command: 'UPDATE', rows: [], rowCount: 1 }, { command: 'UPDATE', rows: [], rowCount: null },
    result('UPDATE', [rows(pending()).parent, rows(pending()).parent]), result('SELECT'),
  ])('parent CAS impossible result is integrity, not stale/missing (%j)', async returned => {
    const member = pending(); const h = harness(member); h.overrides.set('PARENT_UPDATE', returned);
    await expect(new PostgresMembershipRepository(h.pool).save(context, activate(member), initial)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
    expect(h.state()).toEqual(rows(member)); expect(h.calls.at(-1)?.label).toBe('ROLLBACK');
  });
  it('parent RETURNING drift aborts before child persistence', async () => {
    const member = active(); const candidate = member.replaceGrants({ now: instant(4000), expectedAuthorizationVersion: 7, approvedGrants: [grant(20)] });
    const h = harness(member); h.overrides.set('PARENT_UPDATE', result('UPDATE', [rows(candidate, '3').parent]));
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(writes(h).map(call => call.label)).toEqual(['PARENT_UPDATE']); expect(h.state()).toEqual(rows(member));
  });
  it.each(['9007199254740993', '9223372036854775807', '01', '9223372036854775808', 4])('ordinal allocation drift %s is not coerced or repacked', async next_ordinal => {
    const member = active(); const candidate = member.grantRole({ now: instant(4000), expectedAuthorizationVersion: 7, approvedGrant: grant(20) });
    const h = harness(member); h.overrides.set('ALLOCATE', result('SELECT', [{ next_ordinal }]));
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
    expect(h.state()).toEqual(rows(member)); expect(h.calls.some(call => call.label === 'CHILD_INSERT')).toBe(false);
  });
  it.each(['PARENT_UPDATE', 'CHILD_REVOKE', 'CHILD_INSERT', 'ALLOCATE', 'CHILD_READ'] as const)('MREP22 %s failure rolls back entire changed aggregate', async label => {
    const member = active(); const candidate = member.replaceGrants({ now: instant(4000), expectedAuthorizationVersion: 7, approvedGrants: [grant(20), grant(21)] });
    const h = harness(member); h.fail(label, { code: '23514', detail: 'private' }, label === 'CHILD_READ' ? 2 : label === 'CHILD_INSERT' ? 2 : 1);
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
    expect(h.state()).toEqual(rows(member)); expect(h.calls.at(-1)?.label).toBe('ROLLBACK'); expect(h.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it.each(['CHILD_REVOKE', 'CHILD_INSERT'] as const)('zero-row %s result is integrity and rolls back parent/earlier children', async label => {
    const member = active(); const candidate = member.replaceGrants({ now: instant(4000), expectedAuthorizationVersion: 7, approvedGrants: [grant(20)] });
    const h = harness(member); h.overrides.set(label, result(label === 'CHILD_REVOKE' ? 'UPDATE' : 'INSERT'));
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
    expect(h.state()).toEqual(rows(member));
  });
  it.each(['CHILD_REVOKE', 'CHILD_INSERT'] as const)('multi-row %s result cannot commit a partial aggregate', async label => {
    const member = active();
    const candidate = member.replaceGrants({ now: instant(4000), expectedAuthorizationVersion: 7, approvedGrants: [grant(20)] });
    const h = harness(member);
    const child = rows(candidate).children[label === 'CHILD_REVOKE' ? 0 : 4];
    h.overrides.set(label, result(label === 'CHILD_REVOKE' ? 'UPDATE' : 'INSERT', [child, child]));
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
    expect(h.state()).toEqual(rows(member));
    expect(labels(h).at(-1)).toBe('ROLLBACK'); expect(labels(h)).not.toContain('COMMIT');
    expect(writes(h)[0].label).toBe('PARENT_UPDATE');
    expect(h.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('child RETURNING drift and final full-history drift cannot produce success', async () => {
    const member = active(); const candidate = member.revokeGrant({ now: instant(4000), expectedAuthorizationVersion: 7, grantId: member.roleGrants[0].id });
    const h = harness(member); h.overrides.set('CHILD_REVOKE', result('UPDATE', [{ ...rows(candidate).children[0], valid_from: '1100' }]));
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.state()).toEqual(rows(member));
    const final = harness(member); final.overrides.set('CHILD_READ', result('SELECT', rows(member).children));
    await expect(new PostgresMembershipRepository(final.pool).save(context, candidate, initial)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(final.state()).toEqual(rows(member));
  });
  it('create child failure rolls back newly inserted parent and earlier children', async () => {
    const h = harness(null); h.fail('CHILD_INSERT', { code: '23503' }, 2);
    await expect(new PostgresMembershipRepository(h.pool).create(context, pending([grant(10), grant(11)]))).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(h.state()).toEqual({ parent: null, children: [] }); expect(h.release).toHaveBeenCalledTimes(1);
  });
  it('invalid parent INSERT RETURNING aborts before any child write', async () => {
    const h = harness(null); h.overrides.set('PARENT_INSERT', result('INSERT'));
    await expect(new PostgresMembershipRepository(h.pool).create(context, pending([grant(10)]))).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
    expect(h.state()).toEqual({ parent: null, children: [] });
    expect(labels(h)).toEqual(['BEGIN', 'CONTEXT', 'PARENT_INSERT', 'ROLLBACK']);
  });
  it.each(['40001', '40P01'])('MREP23 SQLSTATE %s propagates retryable with no retry or partial writes', async code => {
    const member = active(); const h = harness(member); h.fail('CHILD_REVOKE', { code, detail: 'private SQL' });
    const candidate = member.revokeGrant({ now: instant(4000), expectedAuthorizationVersion: 7, grantId: member.roleGrants[0].id });
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError('RETRYABLE_PERSISTENCE_FAILURE'));
    expect(h.state()).toEqual(rows(member)); expect(h.connect).toHaveBeenCalledTimes(1); expect(h.release).toHaveBeenCalledTimes(1);
  });
  it.each(['23503', '23514', '22003', '42501', '08006', 'unknown'])('other SQLSTATE %s is sanitized and never retryable', async code => {
    const member = active(); const h = harness(member);
    h.fail('PARENT_UPDATE', { code, detail: 'private SQL' });
    const candidate = snapshot(member, { authorization_version: '8' });
    const expected = ['23503', '23514', '22003'].includes(code) ? 'INTEGRITY_FAILURE' : 'UNAVAILABLE';
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError(expected));
    expect(h.state()).toEqual(rows(member)); expect(h.connect).toHaveBeenCalledTimes(1);
  });
  it('primary persistence failure survives rollback/release secondary errors; client is discarded once', async () => {
    const member = active(); const h = harness(member); h.fail('CHILD_READ', { code: '40P01' });
    h.fail('ROLLBACK', new Error('cleanup')); h.release.mockImplementation(() => { throw new Error('release'); });
    await expect(new PostgresMembershipRepository(h.pool).save(context, member, initial)).rejects.toEqual(new IdentityPortError('RETRYABLE_PERSISTENCE_FAILURE'));
    expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it.each(['BEGIN', 'CONTEXT', 'COMMIT'] as const)('%s failure cannot report repository success', async label => {
    const member = pending(); const h = harness(member); h.fail(label, new Error('network'));
    await expect(new PostgresMembershipRepository(h.pool).save(context, activate(member), initial)).rejects.toEqual(new IdentityPortError('UNAVAILABLE'));
    expect(h.state()).toEqual(rows(member)); expect(h.release).toHaveBeenCalledTimes(1);
    if (label === 'CONTEXT') expect(writes(h)).toEqual([]);
  });
  it.each(['40001', '40P01', 'network'])('COMMIT failure %s after complete replacement rolls back parent and every child', async code => {
    const member = active();
    const candidate = member.replaceGrants({ now: instant(4000), expectedAuthorizationVersion: 7,
      approvedGrants: [grant(20), grant(21, 5000)] });
    const h = harness(member); h.fail('COMMIT', code === 'network' ? new Error('network') : { code });
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(
      new IdentityPortError(code === 'network' ? 'UNAVAILABLE' : 'RETRYABLE_PERSISTENCE_FAILURE'));
    expect(writes(h).map(call => call.label)).toEqual(['PARENT_UPDATE', 'CHILD_REVOKE', 'CHILD_REVOKE',
      'CHILD_REVOKE', 'CHILD_INSERT', 'CHILD_INSERT']);
    expect(labels(h).slice(-3)).toEqual(['CHILD_READ', 'COMMIT', 'ROLLBACK']);
    expect(h.state()).toEqual(rows(member)); expect(h.local()).toBeNull();
    expect(h.connect).toHaveBeenCalledTimes(1); expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.poolQuery).not.toHaveBeenCalled();
  });
  it('an aborted COMMIT command tag never returns a successfully replaced aggregate', async () => {
    const member = active();
    const candidate = member.replaceGrants({ now: instant(4000), expectedAuthorizationVersion: 7, approvedGrants: [grant(20)] });
    const h = harness(member); h.overrides.set('COMMIT', result('ROLLBACK'));
    await expect(new PostgresMembershipRepository(h.pool).save(context, candidate, initial)).rejects.toEqual(new IdentityPortError('INTEGRITY_FAILURE'));
    expect(labels(h).slice(-3)).toEqual(['CHILD_READ', 'COMMIT', 'ROLLBACK']);
    expect(h.state()).toEqual(rows(member)); expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('create COMMIT failure rolls back the inserted parent and complete historical child collection', async () => {
    const candidate = pending(active().roleGrants); const h = harness(null); h.fail('COMMIT', { code: '40001' });
    await expect(new PostgresMembershipRepository(h.pool).create(context, candidate)).rejects.toEqual(new IdentityPortError('RETRYABLE_PERSISTENCE_FAILURE'));
    expect(writes(h).map(call => call.label)).toEqual(['PARENT_INSERT', 'CHILD_INSERT', 'CHILD_INSERT', 'CHILD_INSERT', 'CHILD_INSERT']);
    expect(labels(h).slice(-3)).toEqual(['CHILD_READ', 'COMMIT', 'ROLLBACK']);
    expect(h.state()).toEqual({ parent: null, children: [] });
    expect(h.connect).toHaveBeenCalledTimes(1); expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('same physical client does not retain tenant context after transaction end', async () => {
    const h = harness(active()); const repo = new PostgresMembershipRepository(h.pool);
    await repo.findById(context, id); expect(h.local()).toBeNull();
    expect(await repo.findById(tenantScopeContext(otherTenant), id)).toBeNull(); expect(h.local()).toBeNull();
    expect(h.calls.filter(call => call.label === 'CONTEXT').map(call => call.values)).toEqual([[tenant], [otherTenant]]);
    expect(h.release).toHaveBeenCalledTimes(2); expect(h.poolQuery).not.toHaveBeenCalled();
  });
  it('approved create/history uniqueness constraints map CONFLICT; unknown ones stay unavailable', async () => {
    for (const [constraint, code] of [['memberships_pkey', 'CONFLICT'], ['memberships_tenant_user_unique', 'CONFLICT'],
      ['role_grants_pkey', 'CONFLICT'], ['role_grants_ordinal_unique', 'CONFLICT'], ['unknown', 'UNAVAILABLE']] as const) {
      const h = harness(null); h.fail('PARENT_INSERT', { code: '23505', constraint });
      await expect(new PostgresMembershipRepository(h.pool).create(context, pending())).rejects.toEqual(new IdentityPortError(code));
    }
  });
  it('Port/Fake create, version-only jump, append/revoke and no-op semantics agree', async () => {
    const fake = new FakeMembershipRepository(); const member = pending();
    const h = harness(null); const repo = new PostgresMembershipRepository(h.pool);
    expect(await repo.create(context, member)).toEqual(await fake.create(context, member));
    let candidate = activate(member);
    const commands = [candidate, candidate = snapshot(candidate, { authorization_version: '4' }),
      candidate = candidate.grantRole({ now: instant(5000), expectedAuthorizationVersion: 4, approvedGrant: grant(20, 5000) }),
      candidate = candidate.revokeGrant({ now: instant(6000), expectedAuthorizationVersion: 5, grantId: candidate.roleGrants[0].id })];
    let revision = initial;
    for (const command of commands) {
      const actual = await repo.save(context, command, revision); const expected = await fake.save(context, command, revision);
      expect(actual).toEqual(expected); revision = actual.revision;
      expect(await repo.save(context, command, revision)).toEqual(await fake.save(context, command, revision));
    }
  });
});
