import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { tenantId } from '@/lib/zhiban/domain/identity';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { controlTransaction, tenantTransaction } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import { userFromRow, type UserRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/user';
import { tenantFromRow, type TenantRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/tenant';
import { systemAdminGrantFromRow, type SystemAdminGrantRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/system-admin-grant';
import { membershipFromRows, type MembershipRow, type RoleGrantRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/membership';
import { configured, ids, insertBaseFixtures, prepareSchema, resetDisposableIdentity, runtimePool, verifyPg16 } from './pg16-harness';

describe.skipIf(!configured).sequential('real PG16 transaction primitives on restricted runtime pools', () => {
  let tenant: Pool;
  let control: Pool;
  beforeAll(async () => {
    expect(await verifyPg16()).toMatch(/^16\./);
    await prepareSchema();
    await insertBaseFixtures();
    tenant = runtimePool('zhiban_runtime');
    control = runtimePool('zhiban_control_runtime');
  });
  afterAll(async () => {
    await tenant?.end();
    await control?.end();
    await resetDisposableIdentity();
  });

  it('tenant GUC is local to one exclusive transaction and disappears on reused physical client', async () => {
    const context = tenantScopeContext(tenantId(ids.tenantA));
    const pid = await tenantTransaction(tenant, context, async client => {
      const state = await client.query<{ pid: number; tenant: string; identity: string }>(
        "SELECT pg_backend_pid() AS pid, current_setting('app.tenant_id', true) AS tenant, current_user AS identity",
      );
      expect(state.rows[0].tenant).toBe(ids.tenantA);
      expect(state.rows[0].identity).toBe('zhiban_runtime');
      const memberships = await client.query<{ tenant_id: string }>('SELECT tenant_id FROM zhiban_identity.memberships');
      expect(memberships.rows).toHaveLength(1);
      expect(memberships.rows[0].tenant_id).toBe(ids.tenantA);
      const wrong = await client.query('SELECT * FROM zhiban_identity.memberships WHERE tenant_id=$1', [ids.tenantB]);
      expect(wrong.rows).toEqual([]);
      return state.rows[0].pid;
    });
    const reused = await tenant.connect();
    try {
      const state = await reused.query<{ pid: number; tenant: string | null }>(
        "SELECT pg_backend_pid() AS pid, nullif(current_setting('app.tenant_id', true), '') AS tenant",
      );
      expect(state.rows[0]).toEqual({ pid, tenant: null });
      expect((await reused.query('SELECT * FROM zhiban_identity.memberships')).rows).toEqual([]);
    } finally { reused.release(); }
  });

  it('rollback removes local tenant context and rolls back mutation on the same client', async () => {
    const primary = new Error('rollback probe');
    await expect(tenantTransaction(tenant, tenantScopeContext(tenantId(ids.tenantA)), async client => {
      await client.query('UPDATE zhiban_identity.memberships SET authorization_version=1, updated_at=2000, repository_revision=2 WHERE membership_id=$1', [ids.membershipA]);
      throw primary;
    })).rejects.toBe(primary);
    const reused = await tenant.connect();
    try {
      expect((await reused.query("SELECT nullif(current_setting('app.tenant_id', true), '') AS tenant")).rows[0].tenant).toBeNull();
    } finally { reused.release(); }
    await tenantTransaction(tenant, tenantScopeContext(tenantId(ids.tenantA)), async client => {
      const stored = await client.query('SELECT authorization_version, updated_at, repository_revision FROM zhiban_identity.memberships WHERE membership_id=$1', [ids.membershipA]);
      expect(stored.rows[0]).toEqual({ authorization_version: '0', updated_at: '1000', repository_revision: '1' });
    });
  });

  it('COMMIT of an aborted transaction fails closed even if work caught its SQL error', async () => {
    const context = tenantScopeContext(tenantId(ids.tenantA));
    await expect(tenantTransaction(tenant, context, async client => {
      await client.query('UPDATE zhiban_identity.memberships SET authorization_version=1, updated_at=2000, repository_revision=2 WHERE membership_id=$1', [ids.membershipA]);
      // A server-side statement error aborts the transaction, not just the query.
      await expect(client.query('SELECT 1 / 0')).rejects.toMatchObject({ code: '22012' });
      return 'must not report committed';
    })).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    await tenantTransaction(tenant, context, async client => {
      const stored = await client.query('SELECT authorization_version, updated_at, repository_revision FROM zhiban_identity.memberships WHERE membership_id=$1', [ids.membershipA]);
      expect(stored.rows[0]).toEqual({ authorization_version: '0', updated_at: '1000', repository_revision: '1' });
    });
  });

  it('control transaction stays on control login, without tenant table bypass', async () => {
    await controlTransaction(control, async client => {
      expect((await client.query('SELECT current_user')).rows[0].current_user).toBe('zhiban_control_runtime');
      expect((await client.query('SELECT user_id FROM zhiban_identity.users')).rows.length).toBeGreaterThan(0);
    });
    await expect(controlTransaction(control, async client => {
      await client.query('SELECT * FROM zhiban_identity.memberships');
    })).rejects.toMatchObject({ code: '42501' });
  });

  it('real pg int8 rows rehydrate through all four terminal mappers on approved runtime clients', async () => {
    await controlTransaction(control, async client => {
      const users = await client.query<UserRow>('SELECT user_id,status,created_at,updated_at,disabled_at,disabled_reason,repository_revision FROM zhiban_identity.users WHERE user_id=$1', [ids.userA]);
      const tenants = await client.query<TenantRow>('SELECT tenant_id,code,display_name,status,created_at,updated_at,disabled_at,disabled_reason,repository_revision FROM zhiban_identity.tenants WHERE tenant_id=$1', [ids.tenantA]);
      expect(userFromRow(users.rows[0]).revision).toBe('1');
      expect(tenantFromRow(tenants.rows[0]).value.id).toBe(ids.tenantA);
      await client.query('INSERT INTO zhiban_identity.system_admin_grants(grant_id,user_id,created_at,valid_from) VALUES($1,$2,1000,1000)', [ids.weak, ids.userA]);
      const admins = await client.query<SystemAdminGrantRow>('SELECT grant_id,user_id,created_at,valid_from,valid_until,revoked_at,repository_revision FROM zhiban_identity.system_admin_grants WHERE grant_id=$1', [ids.weak]);
      expect(systemAdminGrantFromRow(admins.rows[0]).value.userId).toBe(ids.userA);
    });
    await tenantTransaction(tenant, tenantScopeContext(tenantId(ids.tenantA)), async client => {
      const memberships = await client.query<MembershipRow>('SELECT membership_id,user_id,tenant_id,status,authorization_version,created_at,updated_at,disabled_at,disabled_reason,repository_revision FROM zhiban_identity.memberships WHERE tenant_id=$1 AND membership_id=$2', [ids.tenantA, ids.membershipA]);
      const children = await client.query<RoleGrantRow>('SELECT grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,scope_id,created_at,valid_from,valid_until,revoked_at FROM zhiban_identity.role_grants WHERE tenant_id=$1 AND membership_id=$2 ORDER BY grant_ordinal,grant_id', [ids.tenantA, ids.membershipA]);
      const aggregate = membershipFromRows(memberships.rows[0], children.rows);
      expect(aggregate.value.roleGrants.map(grant => grant.id)).toEqual([ids.grantA]);
      expect(aggregate.revision).toBe('1');
    }, 'REPEATABLE_READ_READ_ONLY');
  });
});
