import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { Membership, RoleGrant, SystemAdminGrant, Tenant, User, instant, membershipId, roleGrantId, systemAdminGrantId, tenantId, tenantScope, userId } from '@/lib/zhiban/domain/identity';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { type Loaded } from '@/lib/zhiban/application/identity/ports/repository-types';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { membershipFromRows, membershipToRows, type MembershipRow, type RoleGrantRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/membership';
import { controlTransaction, tenantTransaction, type TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresTenantRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/tenant';
import { PostgresSystemAdminGrantRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/system-admin-grant';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { adminClient, configured, ids, insertBaseFixtures, prepareSchema, resetDisposableIdentity, runtimeClient, runtimePool, verifyPg16 } from './pg16-harness';

const contextA = tenantScopeContext(tenantId(ids.tenantA));
const contextB = tenantScopeContext(tenantId(ids.tenantB));
const parentColumns = 'membership_id,user_id,tenant_id,status,authorization_version,created_at,updated_at,disabled_at,disabled_reason,repository_revision';
const childColumns = 'grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,scope_id,created_at,valid_from,valid_until,revoked_at';
let sequence = 1000;
function freshId(): string { return `018f0000-0000-7000-8000-${String(sequence++).padStart(12, '0')}`; }
function sqlState(error: unknown): unknown {
  return error !== null && typeof error === 'object'
    ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
}
function gate() {
  let open!: () => void;
  const ready = new Promise<void>(resolve => { open = resolve; });
  return { ready, open };
}
// Bounds protect against a broken coordination protocol, never establish race ordering.
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('PG16 coordination did not complete')), 3000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Observe acknowledgements from REAL queries, without fabricating or changing a result. */
function observed(pool: Pool, after: (sql: string, result: QueryResult) => Promise<void>, errors?: (error: unknown) => void): TransactionPool {
  return {
    async connect() {
      const client = await pool.connect();
      // The adapter supports the promise/string overload used by the frozen primitives.
      // The underlying driver executes every query and supplies every returned row/tag.
      const query = async (sql: string, parameters?: unknown[]) => {
        let result: QueryResult;
        try { result = await client.query(sql, parameters); }
        catch (error) { errors?.(error); throw error; }
        await after(sql, result);
        return result;
      };
      return { query: query as PoolClient['query'], release: client.release.bind(client) };
    },
  };
}

describe.skipIf(!configured).sequential('real PG16 repository concurrency and isolation signoff', () => {
  const pools = new Set<Pool>();
  async function pool(role: 'zhiban_runtime' | 'zhiban_control_runtime'): Promise<Pool> {
    const value = runtimePool(role); // Existing harness, max=1: force physical reuse.
    pools.add(value);
    const client = await value.connect();
    try {
      await client.query("SET statement_timeout = '3s'");
      expect((await client.query('SELECT current_user')).rows[0].current_user).toBe(role);
    } finally { client.release(); }
    return value;
  }
  beforeAll(async () => {
    console.info(`4B-5 REAL server_version: ${await verifyPg16()}`);
    await prepareSchema();
    await insertBaseFixtures();
  });
  afterEach(async () => {
    await Promise.all([...pools].map(value => value.end()));
    pools.clear();
  });
  afterAll(async () => { await resetDisposableIdentity(); });

  async function seedUser() {
    return new PostgresIdentityRepository(await pool('zhiban_control_runtime'))
      .create(User.create(userId(freshId()), instant(1000)));
  }
  function grant(from = 1000, until: number | null = null, id = freshId()) {
    return RoleGrant.create({ id: roleGrantId(id), roleCode: 'STUDENT', scope: tenantScope(),
      createdAt: instant(1000), validFrom: instant(from), validUntil: until === null ? null : instant(until) });
  }
  async function seedMembership(): Promise<Loaded<Membership>> {
    const user = await seedUser();
    const pending = Membership.create({ id: membershipId(freshId()), userId: user.value.id,
      tenantId: contextA.tenantId, now: instant(3000),
      roleGrants: [grant(), grant(5000), grant(1000, 2000), grant(5000).revoke(instant(2000))] });
    // Valid historical DB-shaped input; only the legal terminal mapper mints the snapshot.
    const write = membershipToRows(pending);
    const active = membershipFromRows({ ...write.membership, status: 'ACTIVE', authorization_version: '7', repository_revision: '1' }, write.roleGrants).value;
    return new PostgresMembershipRepository(await pool('zhiban_runtime')).create(contextA, active);
  }
  function snapshot(value: Membership, change: Partial<MembershipRow>, children?: readonly RoleGrantRow[]): Membership {
    const rows = membershipToRows(value);
    return membershipFromRows({ ...rows.membership, repository_revision: '1', ...change }, children ?? rows.roleGrants).value;
  }
  async function persisted(poolValue: Pool, id: string) {
    return tenantTransaction(poolValue, contextA, async client => ({
      parent: (await client.query<MembershipRow>(`SELECT ${parentColumns} FROM zhiban_identity.memberships WHERE tenant_id=$1 AND membership_id=$2`, [ids.tenantA, id])).rows,
      children: (await client.query<RoleGrantRow>(`SELECT ${childColumns} FROM zhiban_identity.role_grants WHERE tenant_id=$1 AND membership_id=$2 ORDER BY grant_ordinal`, [ids.tenantA, id])).rows,
    }));
  }
  async function pid(value: Pool): Promise<number> {
    const client = await value.connect();
    try { return (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid; }
    finally { client.release(); }
  }
  async function waitBlocked(pids: readonly number[]): Promise<void> {
    const observer = adminClient(); // Catalog observation ONLY, not a runtime operation.
    await observer.connect();
    try {
      const deadline = performance.now() + 2000;
      do {
        const result = await observer.query<{ pid: number; blocked: boolean }>(
          'SELECT pid, cardinality(pg_blocking_pids(pid)) > 0 AS blocked FROM unnest($1::int[]) AS pid', [pids]);
        if (result.rows.length === pids.length && result.rows.every(row => row.blocked)) return;
      } while (performance.now() < deadline);
      throw new Error('Expected PostgreSQL lock wait was not observed');
    } finally { await observer.end(); }
  }
  async function competing<T>(tenant: boolean, id: string, a: Pool, b: Pool, saveA: () => Promise<T>, saveB: () => Promise<T>) {
    const blocker = runtimeClient(tenant ? 'zhiban_runtime' : 'zhiban_control_runtime');
    await blocker.connect();
    let settled: Promise<PromiseSettledResult<T>[]> | undefined;
    try {
      await blocker.query("SET statement_timeout = '3s'");
      await blocker.query('BEGIN');
      if (tenant) await blocker.query("SELECT set_config('app.tenant_id',$1,true)", [ids.tenantA]);
      const lock = tenant
        ? await blocker.query('SELECT membership_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND membership_id=$2 FOR UPDATE', [ids.tenantA, id])
        : await blocker.query('SELECT user_id FROM zhiban_identity.users WHERE user_id=$1 FOR UPDATE', [id]);
      expect(lock.rowCount).toBe(1); // Lock acquisition acknowledged by PostgreSQL.
      const pids = [await pid(a), await pid(b)];
      expect(pids[0]).not.toBe(pids[1]);
      settled = Promise.allSettled([saveA(), saveB()]);
      await waitBlocked(pids); // BOTH writers have entered their real lock wait.
      await blocker.query('ROLLBACK');
      return await bounded(settled);
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      await blocker.end();
      if (settled) await settled;
    }
  }
  function winner<T>(results: PromiseSettledResult<T>[]): number {
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find(result => result.status === 'rejected');
    expect(lost?.status === 'rejected' && lost.reason).toBeInstanceOf(IdentityPortError);
    expect(lost?.status === 'rejected' && lost.reason).toMatchObject({ code: 'STALE_WRITE' });
    return results.findIndex(result => result.status === 'fulfilled');
  }

  it('two real User writers from revision 1 produce exactly one winner and revision 2', async () => {
    const base = await seedUser();
    const a = await pool('zhiban_control_runtime');
    const b = await pool('zhiban_control_runtime');
    const candidates = [base.value.disable(instant(2000), 'writer-a'), base.value.disable(instant(2000), 'writer-b')];
    const results = await competing(false, base.value.id, a, b,
      () => new PostgresIdentityRepository(a).save(candidates[0], base.revision),
      () => new PostgresIdentityRepository(b).save(candidates[1], base.revision));
    const index = winner(results);
    const stored = await new PostgresIdentityRepository(a).findById(base.value.id);
    expect(stored).toEqual({ value: candidates[index], revision: '2' });
  });

  it('a queued old-revision no-op is stale AFTER the real mutation commits', async () => {
    const base = await seedUser();
    const a = await pool('zhiban_control_runtime');
    const b = await pool('zhiban_control_runtime');
    const locked = gate();
    const proceed = gate();
    const writer = observed(a, async sql => {
      if (sql.endsWith('FOR UPDATE')) { locked.open(); await bounded(proceed.ready); }
    });
    const mutation = new PostgresIdentityRepository(writer).save(base.value.disable(instant(2000), 'winner'), base.revision);
    let noop: Promise<Loaded<User>> | undefined;
    const mutationSettled = Promise.allSettled([mutation]);
    try {
      await bounded(locked.ready);
      const bPid = await pid(b);
      noop = new PostgresIdentityRepository(b).save(base.value, base.revision);
      const noOpSettled = Promise.allSettled([noop]);
      await waitBlocked([bPid]);
      proceed.open();
      expect((await mutation).revision).toBe('2');
      expect((await noOpSettled)[0]).toMatchObject({ status: 'rejected', reason: { code: 'STALE_WRITE' } });
      expect((await new PostgresIdentityRepository(a).findById(base.value.id))?.revision).toBe('2');
    } finally { proceed.open(); await mutationSettled; if (noop) await Promise.allSettled([noop]); }
  });

  it('all three global repositories keep real stored no-ops and reject stale equal candidates', async () => {
    const p = await pool('zhiban_control_runtime');
    const writes: string[] = [];
    const watched = observed(p, async sql => {
      if (/^(UPDATE|INSERT|DELETE)\b/.test(sql)) writes.push(sql);
    });
    const users = new PostgresIdentityRepository(watched);
    const tenants = new PostgresTenantRepository(watched);
    const admins = new PostgresSystemAdminGrantRepository(watched);
    const user = await users.create(User.create(userId(freshId()), instant(1000)));
    const tenant = await tenants.create(Tenant.create(tenantId(freshId()), `signoff-${sequence}`, 'Signoff', instant(1000)));
    const admin = await admins.createSystemAdminGrant(SystemAdminGrant.create({ id: systemAdminGrantId(freshId()), userId: user.value.id, createdAt: instant(1000), validFrom: instant(1000), validUntil: null }));
    const u2 = await users.save(user.value.disable(instant(2000), 'review'), user.revision);
    const t2 = await tenants.save(tenant.value.disable(instant(2000), 'review'), tenant.revision);
    const a2 = await admins.saveSystemAdminGrant(admin.value.revoke(instant(2000)), admin.revision);
    writes.length = 0;
    const un = await users.save(u2.value, u2.revision);
    const tn = await tenants.save(t2.value, t2.revision);
    const an = await admins.saveSystemAdminGrant(a2.value, a2.revision);
    expect(un).toEqual(u2); expect(un.value).not.toBe(u2.value);
    expect(tn).toEqual(t2); expect(tn.value).not.toBe(t2.value);
    expect(an).toEqual(a2); expect(an.value).not.toBe(a2.value);
    expect(writes).toEqual([]);
    for (const loaded of [u2, t2, a2]) expect(loaded.revision).toBe('2');
    await expect(users.save(u2.value, user.revision)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    await expect(tenants.save(t2.value, tenant.revision)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    await expect(admins.saveSystemAdminGrant(a2.value, admin.revision)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect(writes).toEqual([]);
    const restoredUser = await users.save(u2.value.restore(instant(3000)), u2.revision);
    const restoredTenant = await tenants.save(t2.value.restore(instant(3000)), t2.revision);
    const archived = await tenants.save(restoredTenant.value.archive(instant(4000)), restoredTenant.revision);
    expect(restoredUser.revision).toBe('3'); expect(restoredUser.value.status).toBe('ACTIVE');
    expect(restoredTenant.revision).toBe('3'); expect(archived.revision).toBe('4');
    expect(archived.value.status).toBe('ARCHIVED');
  });

  it.each(['add/add', 'add/disable', 'replace/revoke'] as const)('Membership %s locks/CAS preserve exactly the winning complete history', async shape => {
    const base = await seedMembership();
    const a = await pool('zhiban_runtime');
    const b = await pool('zhiban_runtime');
    const command = { now: instant(4000), expectedAuthorizationVersion: 7 };
    const first = shape === 'replace/revoke'
      ? base.value.replaceGrants({ ...command, approvedGrants: [grant()] })
      : base.value.grantRole({ ...command, approvedGrant: grant() });
    const second = shape === 'add/disable'
      ? base.value.disable({ ...command, reason: 'concurrent-disable' })
      : shape === 'replace/revoke'
        ? base.value.revokeGrant({ ...command, grantId: base.value.roleGrants[0].id })
        : base.value.grantRole({ ...command, approvedGrant: grant(5000) });
    const candidates = [first, second];
    const results = await competing(true, base.value.id, a, b,
      () => new PostgresMembershipRepository(a).save(contextA, first, base.revision),
      () => new PostgresMembershipRepository(b).save(contextA, second, base.revision));
    const index = winner(results);
    const stored = await new PostgresMembershipRepository(a).findById(contextA, base.value.id);
    expect(stored).toEqual({ value: candidates[index], revision: '2' });
    expect(stored?.value.authorizationVersion).toBe(8);
    const raw = await persisted(a, base.value.id);
    expect(raw.children).toEqual(membershipToRows(candidates[index]).roleGrants);
    expect(raw.children.map(row => row.grant_ordinal)).toEqual(raw.children.map((_, i) => String(i)));
    // Stale history can neither re-enable a disabled aggregate nor clear a winning revoke.
    await expect(new PostgresMembershipRepository(a).save(contextA, base.value, base.revision)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect(await persisted(a, base.value.id)).toEqual(raw);
  });

  it.each(['lower', 'same-parent', 'same-child'] as const)('real Membership authVersion rejects %s and leaves all rows unchanged', async shape => {
    const base = await seedMembership();
    const p = await pool('zhiban_runtime');
    const before = await persisted(p, base.value.id);
    const rows = membershipToRows(base.value);
    const candidate = shape === 'lower'
      ? snapshot(base.value, { authorization_version: '6' })
      : shape === 'same-parent'
        ? snapshot(base.value, { updated_at: '4000' })
        : snapshot(base.value, {}, rows.roleGrants.map((row, index) => index === 0 ? { ...row, revoked_at: '2500' } : row));
    await expect(new PostgresMembershipRepository(p).save(contextA, candidate, base.revision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(await persisted(p, base.value.id)).toEqual(before);
  });

  it('real identical Membership is a zero-write stored no-op; higher version alone persists', async () => {
    const base = await seedMembership();
    const p = await pool('zhiban_runtime');
    const writes: string[] = [];
    const repository = new PostgresMembershipRepository(observed(p, async sql => {
      if (/^(UPDATE|INSERT|DELETE)\b/.test(sql)) writes.push(sql);
    }));
    const before = await persisted(p, base.value.id);
    const noop = await repository.save(contextA, base.value, base.revision);
    expect(noop).toEqual(base);
    expect(noop.value).not.toBe(base.value); // A newly loaded STORED result, not the caller.
    expect(writes).toEqual([]);
    expect(await persisted(p, base.value.id)).toEqual(before);
    const higher = snapshot(base.value, { authorization_version: '9' });
    expect(await repository.save(contextA, higher, base.revision)).toEqual({ value: higher, revision: '2' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^UPDATE zhiban_identity.memberships/);
  });

  it('real parent update + first revokes + child insert roll back when a later child hits the real PK', async () => {
    const base = await seedMembership();
    const p = await pool('zhiban_runtime');
    const before = await persisted(p, base.value.id);
    const acknowledged: string[] = [];
    const rawErrors: unknown[] = [];
    const repository = new PostgresMembershipRepository(observed(p, async sql => { acknowledged.push(sql); }, error => rawErrors.push(sqlState(error))));
    const replacement = base.value.replaceGrants({ now: instant(4000), expectedAuthorizationVersion: 7,
      approvedGrants: [grant(), grant(1000, null, ids.grantB)] });
    await expect(repository.save(contextA, replacement, base.revision)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(rawErrors).toEqual(['23505']); // PostgreSQL generated, not injected by the observer.
    expect(acknowledged.filter(sql => sql.startsWith('UPDATE zhiban_identity.memberships'))).toHaveLength(1);
    expect(acknowledged.filter(sql => sql.startsWith('UPDATE zhiban_identity.role_grants')).length).toBeGreaterThan(0);
    expect(acknowledged.filter(sql => sql.startsWith('INSERT INTO zhiban_identity.role_grants'))).toHaveLength(1);
    expect(acknowledged.at(-1)).toBe('ROLLBACK');
    expect(await persisted(p, base.value.id)).toEqual(before);
    const other = await new PostgresMembershipRepository(p).findById(contextB, membershipId(ids.membershipB));
    expect(other?.revision).toBe('1');
    expect(other?.value.roleGrants[0].revokedAt).toBeNull();
  });

  it('repository read sees one real repeatable-read parent/child snapshot during a committed replacement', async () => {
    const base = await seedMembership();
    const readerPool = await pool('zhiban_runtime');
    const writerPool = await pool('zhiban_runtime');
    const parentRead = gate();
    const readChildren = gate();
    const reader = new PostgresMembershipRepository(observed(readerPool, async sql => {
      if (sql.startsWith('SELECT membership_id')) { parentRead.open(); await bounded(readChildren.ready); }
    }));
    const read = reader.findById(contextA, base.value.id);
    const settled = Promise.allSettled([read]);
    try {
      await bounded(parentRead.ready);
      const replacement = base.value.replaceGrants({ now: instant(4000), expectedAuthorizationVersion: 7, approvedGrants: [grant()] });
      const next = await new PostgresMembershipRepository(writerPool).save(contextA, replacement, base.revision);
      readChildren.open();
      expect(await read).toEqual(base); // Old parent AND old complete child history, not mixed.
      expect(await new PostgresMembershipRepository(readerPool).findById(contextA, base.value.id)).toEqual(next);
    } finally { readChildren.open(); await settled; }
  });

  it('restricted RLS reads, cross-tenant mutable updates, inserts, deletes and composite FK fail closed', async () => {
    const p = await pool('zhiban_runtime');
    for (const context of [contextA, contextB]) {
      await tenantTransaction(p, context, async client => {
        for (const table of ['memberships', 'role_grants'] as const) {
          const result = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM zhiban_identity.${table}`);
          expect(result.rows.length).toBeGreaterThan(0);
          expect(result.rows.every(row => row.tenant_id === context.tenantId)).toBe(true);
        }
      });
    }
    await tenantTransaction(p, contextA, async client => {
      expect((await client.query('UPDATE zhiban_identity.memberships SET authorization_version=authorization_version+1,repository_revision=repository_revision+1 WHERE membership_id=$1', [ids.membershipB])).rowCount).toBe(0);
      expect((await client.query('UPDATE zhiban_identity.role_grants SET revoked_at=2000 WHERE grant_id=$1', [ids.grantB])).rowCount).toBe(0);
    });
    const denied = [
      ["INSERT INTO zhiban_identity.memberships(membership_id,tenant_id,user_id,status,created_at,updated_at) VALUES($1,$2,$3,'ACTIVE',1000,1000)", [freshId(), ids.tenantB, ids.userA], '42501'],
      ["INSERT INTO zhiban_identity.role_grants(grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,created_at,valid_from) VALUES($1,$2,$3,1,'STUDENT','SELF',1000,1000)", [freshId(), ids.tenantB, ids.membershipB], '42501'],
      ["INSERT INTO zhiban_identity.role_grants(grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,created_at,valid_from) VALUES($1,$2,$3,1,'STUDENT','SELF',1000,1000)", [freshId(), ids.tenantA, ids.membershipB], '23503'],
      ['DELETE FROM zhiban_identity.memberships WHERE membership_id=$1', [ids.membershipB], '42501'],
      ['DELETE FROM zhiban_identity.role_grants WHERE grant_id=$1', [ids.grantB], '42501'],
      ['SELECT tenant_id FROM zhiban_identity.tenants', [], '42501'],
    ] as const;
    for (const [sql, params, code] of denied) {
      await expect(tenantTransaction(p, contextA, async client => { await client.query(sql, [...params]); })).rejects.toMatchObject({ code });
    }
    expect(await new PostgresMembershipRepository(p).findById(contextA, membershipId(ids.membershipB))).toBeNull();
    const b = await new PostgresMembershipRepository(p).findById(contextB, membershipId(ids.membershipB));
    expect(b?.revision).toBe('1');
    expect(b?.value.roleGrants[0].revokedAt).toBeNull();
  });

  it('higher-version cross-context candidate is rejected before SQL; real FK/check errors are never retryable', async () => {
    const base = await seedMembership();
    const p = await pool('zhiban_runtime');
    const queries: string[] = [];
    const repository = new PostgresMembershipRepository(observed(p, async sql => { queries.push(sql); }));
    const higher = base.value.disable({ now: instant(4000), expectedAuthorizationVersion: 7, reason: 'scope-test' });
    await expect(repository.save(contextB, higher, base.revision)).rejects.toMatchObject({ code: 'TENANT_SCOPE_VIOLATION' });
    expect(queries).toEqual([]);
    const orphan = Membership.create({ id: membershipId(freshId()), userId: userId(freshId()), tenantId: contextA.tenantId, now: instant(1000) });
    await expect(repository.create(contextA, orphan)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    await expect(tenantTransaction(p, contextA, async client => {
      await client.query("UPDATE zhiban_identity.memberships SET status='UNKNOWN',authorization_version=authorization_version+1,repository_revision=repository_revision+1 WHERE membership_id=$1", [base.value.id]);
    })).rejects.toMatchObject({ code: '23514' });
    expect(await new PostgresMembershipRepository(p).findById(contextA, base.value.id)).toEqual(base);
  });

  it.each([null, 'not-a-tenant', ids.tenantUnknown])('missing/invalid/unknown tenant %s cannot read or insert parent/child data', async setting => {
    const p = await pool('zhiban_runtime');
    for (const table of ['memberships', 'role_grants'] as const) {
      await expect(controlTransaction(p, async client => {
        if (setting !== null) await client.query("SELECT set_config('app.tenant_id',$1,true)", [setting]);
        expect((await client.query(`SELECT tenant_id FROM zhiban_identity.${table}`)).rows).toEqual([]);
        if (table === 'memberships') {
          await client.query("INSERT INTO zhiban_identity.memberships(membership_id,tenant_id,user_id,status,created_at,updated_at) VALUES($1,$2,$3,'ACTIVE',1000,1000)", [freshId(), ids.tenantA, ids.userB]);
        } else {
          await client.query("INSERT INTO zhiban_identity.role_grants(grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,created_at,valid_from) VALUES($1,$2,$3,1,'STUDENT','SELF',1000,1000)", [freshId(), ids.tenantA, ids.membershipA]);
        }
      })).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('max=1 physically reuses A/B/no-context connections across commit and SQL-error rollback without leakage', async () => {
    const p = await pool('zhiban_runtime');
    const physical = await pid(p);
    for (const context of [contextA, contextB]) {
      await tenantTransaction(p, context, async client => {
        const state = (await client.query("SELECT pg_backend_pid() AS pid,current_setting('app.tenant_id') AS tenant")).rows[0];
        expect(state).toEqual({ pid: physical, tenant: context.tenantId });
        for (const table of ['memberships', 'role_grants'] as const) {
          expect((await client.query(`SELECT tenant_id FROM zhiban_identity.${table}`)).rows.every(row => row.tenant_id === context.tenantId)).toBe(true);
        }
      });
      await expect(tenantTransaction(p, context, async client => { await client.query('SELECT 1/0'); })).rejects.toMatchObject({ code: '22012' });
      const client = await p.connect();
      try {
        expect((await client.query("SELECT pg_backend_pid() AS pid,nullif(current_setting('app.tenant_id',true),'') AS tenant")).rows[0]).toEqual({ pid: physical, tenant: null });
        for (const table of ['memberships', 'role_grants'] as const) {
          expect((await client.query(`SELECT tenant_id FROM zhiban_identity.${table}`)).rows).toEqual([]);
        }
      } finally { client.release(); }
    }
  });

  it('actual aborted COMMIT returns ROLLBACK and the primitive refuses success', async () => {
    const p = await pool('zhiban_runtime');
    const tags: string[] = [];
    await expect(tenantTransaction(observed(p, async (sql, result) => {
      if (sql === 'COMMIT') tags.push(result.command);
    }), contextA, async client => {
      await client.query('UPDATE zhiban_identity.memberships SET authorization_version=1,repository_revision=2,updated_at=2000 WHERE membership_id=$1', [ids.membershipA]);
      await expect(client.query('SELECT 1/0')).rejects.toMatchObject({ code: '22012' });
      return 'not committed';
    })).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(tags).toEqual(['ROLLBACK']);
    expect((await new PostgresMembershipRepository(p).findById(contextA, membershipId(ids.membershipA)))?.revision).toBe('1');
  });

  it('real SERIALIZABLE conflict generates 40001, classifies retryable and never retries', async () => {
    const base = await seedUser();
    const a = await pool('zhiban_control_runtime');
    const b = await pool('zhiban_control_runtime');
    const readA = gate(); const readB = gate(); const writeA = gate(); const writeB = gate();
    const raw: unknown[] = [];
    const calls = [0, 0];
    const run = (p: Pool, index: number, read: ReturnType<typeof gate>, write: ReturnType<typeof gate>) => controlTransaction(p, async client => {
      calls[index]++;
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      expect((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation).toBe('serializable');
      expect((await client.query('SELECT repository_revision FROM zhiban_identity.users WHERE user_id=$1', [base.value.id])).rows[0].repository_revision).toBe('1');
      read.open(); await bounded(write.ready);
      try {
        await client.query("UPDATE zhiban_identity.users SET status='DISABLED',disabled_at=2000,disabled_reason=$1,updated_at=2000,repository_revision=repository_revision+1 WHERE user_id=$2", [`serial-${index}`, base.value.id]);
      } catch (error) { raw.push(sqlState(error)); throw error; }
    });
    const first = run(a, 0, readA, writeA);
    const second = run(b, 1, readB, writeB);
    const settled = Promise.allSettled([first, second]);
    try {
      await bounded(Promise.all([readA.ready, readB.ready]));
      writeA.open(); await first; // A actually COMMITTED before B's stale snapshot UPDATE.
      writeB.open();
      const result = await settled;
      expect(result[0].status).toBe('fulfilled');
      expect(result[1]).toMatchObject({ status: 'rejected', reason: { code: 'RETRYABLE_PERSISTENCE_FAILURE' } });
      expect(raw).toEqual(['40001']);
      expect(calls).toEqual([1, 1]);
      const stored = await new PostgresIdentityRepository(a).findById(base.value.id);
      expect(stored?.revision).toBe('2');
      expect(stored?.value.disabledReason).toBe('serial-0');
    } finally { writeA.open(); writeB.open(); await settled; }
  });

  it('two acknowledged opposite row locks generate real 40P01; victim is retryable without retry', async () => {
    const u1 = await seedUser(); const u2 = await seedUser();
    const a = await pool('zhiban_control_runtime'); const b = await pool('zhiban_control_runtime');
    const lockedA = gate(); const lockedB = gate(); const cross = gate();
    const raw: unknown[] = [];
    const calls = [0, 0];
    const run = (p: Pool, index: number, own: string, other: string, locked: ReturnType<typeof gate>) => controlTransaction(p, async client => {
      calls[index]++;
      expect((await client.query('SELECT user_id FROM zhiban_identity.users WHERE user_id=$1 FOR UPDATE', [own])).rowCount).toBe(1);
      locked.open(); await bounded(cross.ready);
      try { await client.query('SELECT user_id FROM zhiban_identity.users WHERE user_id=$1 FOR UPDATE', [other]); }
      catch (error) { raw.push(sqlState(error)); throw error; }
    });
    const settled = Promise.allSettled([run(a, 0, u1.value.id, u2.value.id, lockedA), run(b, 1, u2.value.id, u1.value.id, lockedB)]);
    try {
      await bounded(Promise.all([lockedA.ready, lockedB.ready]));
      cross.open();
      const result = await settled;
      expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
      expect(result.find(item => item.status === 'rejected')).toMatchObject({ status: 'rejected', reason: { code: 'RETRYABLE_PERSISTENCE_FAILURE' } });
      expect(raw).toEqual(['40P01']);
      expect(calls).toEqual([1, 1]);
      expect((await new PostgresIdentityRepository(a).findById(u1.value.id))?.revision).toBe('1');
      expect((await new PostgresIdentityRepository(b).findById(u2.value.id))?.revision).toBe('1');
    } finally { cross.open(); await settled; }
  });
});
