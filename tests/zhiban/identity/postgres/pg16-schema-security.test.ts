import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  adminClient,
  configured,
  ids,
  prepareSchema,
  resetDisposableIdentity,
  runtimeClient,
  verifyPg16,
} from './pg16-harness';

async function expectPermissionDenied(client: Client, sql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await expect(client.query(sql)).rejects.toMatchObject({ code: '42501' });
  } finally {
    await client.query('ROLLBACK');
  }
}

describe.skipIf(!configured).sequential('real PostgreSQL 16 Identity ownership and ACL', () => {
  beforeAll(async () => {
    expect(await verifyPg16()).toMatch(/^16\./);
    await prepareSchema();
  });
  afterAll(resetDisposableIdentity);

  it('assigns schema, tables, sequences and functions to NOLOGIN owner, never runtime', async () => {
    const admin = adminClient();
    await admin.connect();
    try {
      const schema = await admin.query(
        "SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'zhiban_identity'",
      );
      expect(schema.rows[0].owner).toBe('zhiban_identity_owner');
      const objects = await admin.query(
        "SELECT relname, relowner::regrole::text AS owner, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = 'zhiban_identity'::regnamespace AND relkind IN ('r','S')",
      );
      expect(objects.rows.length).toBeGreaterThanOrEqual(9);
      expect(objects.rows.every((row) => row.owner === 'zhiban_identity_owner')).toBe(true);
      for (const table of ['memberships', 'role_grants', 'audit_events']) {
        expect(objects.rows.find((row) => row.relname === table)).toMatchObject({
          relrowsecurity: true,
          relforcerowsecurity: true,
        });
      }
      const functions = await admin.query(
        "SELECT p.proname, p.proowner::regrole::text AS owner, p.prosecdef FROM pg_proc p WHERE p.pronamespace = 'zhiban_identity'::regnamespace",
      );
      expect(functions.rows.length).toBeGreaterThanOrEqual(10);
      expect(functions.rows.every((row) => row.owner === 'zhiban_identity_owner' && !row.prosecdef)).toBe(true);
      const roles = await admin.query(
        "SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname LIKE 'zhiban_%'",
      );
      const runtime = roles.rows.filter((row) =>
        ['zhiban_runtime', 'zhiban_auth_runtime', 'zhiban_control_runtime'].includes(row.rolname),
      );
      expect(runtime).toHaveLength(3);
      for (const role of runtime) {
        expect(role).toMatchObject({
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolinherit: false,
        });
      }
      const edges = await admin.query(
        "SELECT member::regrole::text AS member, roleid::regrole::text AS target FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname LIKE 'zhiban_%')",
      );
      expect(edges.rows).toEqual([
        { member: 'zhiban_migrator', target: 'zhiban_identity_owner' },
      ]);
    } finally {
      await admin.end();
    }
  });

  it('denies runtime DDL and any runtime access to the migration ledger', async () => {
    for (const role of [
      'zhiban_runtime',
      'zhiban_auth_runtime',
      'zhiban_control_runtime',
    ] as const) {
      const client = runtimeClient(role);
      await client.connect();
      try {
        const identity = await client.query('SELECT current_user, session_user');
        expect(identity.rows[0]).toMatchObject({ current_user: role, session_user: role });
        for (const sql of [
          'CREATE TABLE zhiban_identity.pg16_ddl_probe (id int)',
          'CREATE TABLE public.pg16_ddl_probe (id int)',
          'CREATE SCHEMA pg16_ddl_probe',
          'CREATE FUNCTION zhiban_identity.pg16_ddl_probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
          'ALTER TABLE zhiban_identity.users ADD COLUMN pg16_ddl_probe int',
          'DROP TABLE zhiban_identity.users',
          'TRUNCATE zhiban_identity.users',
          'SELECT * FROM zhiban_identity.schema_migrations',
          "INSERT INTO zhiban_identity.schema_migrations(version, checksum) VALUES ('9999', repeat('0',64))",
          "UPDATE zhiban_identity.schema_migrations SET checksum = repeat('0',64)",
          'DELETE FROM zhiban_identity.schema_migrations',
          'TRUNCATE zhiban_identity.schema_migrations',
        ]) {
          await expectPermissionDenied(client, sql);
        }
      } finally {
        await client.end();
      }
    }
  });

  it('keeps global tenant and auth/control data outside the tenant runtime', async () => {
    const tenant = runtimeClient('zhiban_runtime');
    await tenant.connect();
    try {
      for (const table of ['users', 'tenants', 'sessions', 'system_admin_grants']) {
        await expectPermissionDenied(tenant, `SELECT * FROM zhiban_identity.${table}`);
      }
    } finally {
      await tenant.end();
    }
    const auth = runtimeClient('zhiban_auth_runtime');
    await auth.connect();
    try {
      expect((await auth.query('SELECT count(*)::int AS count FROM zhiban_identity.users')).rows[0].count).toBe(0);
      for (const table of ['memberships', 'role_grants', 'tenants', 'system_admin_grants']) {
        await expectPermissionDenied(auth, `SELECT * FROM zhiban_identity.${table}`);
      }
    } finally {
      await auth.end();
    }
    const control = runtimeClient('zhiban_control_runtime');
    await control.connect();
    try {
      await control.query(
        "INSERT INTO zhiban_identity.users(user_id,status,created_at,updated_at) VALUES($1,'ACTIVE',1000,1000)",
        [ids.userA],
      );
      await control.query(
        "INSERT INTO zhiban_identity.tenants(tenant_id,code,display_name,status,created_at,updated_at) VALUES($1,'security-test','Security Test','ACTIVE',1000,1000)",
        [ids.tenantA],
      );
      expect((await control.query('SELECT count(*)::int AS count FROM zhiban_identity.tenants')).rows[0].count).toBe(1);
      for (const table of ['memberships', 'role_grants']) {
        await expectPermissionDenied(control, `SELECT * FROM zhiban_identity.${table}`);
      }
      await expectPermissionDenied(control, 'SELECT token_digest FROM zhiban_identity.sessions');
      const authSession = runtimeClient('zhiban_auth_runtime');
      await authSession.connect();
      try {
        await authSession.query(
          'INSERT INTO zhiban_identity.sessions(session_id,user_id,token_digest,created_at,last_seen_at,absolute_expires_at,idle_expires_at) VALUES($1,$2,$3,1000,1000,9000,5000)',
          ['test-session', ids.userA, 'digest-fixture'],
        );
        expect((await authSession.query('SELECT count(*)::int AS count FROM zhiban_identity.sessions')).rows[0].count).toBe(1);
      } finally {
        await authSession.end();
      }
      await control.query(
        "UPDATE zhiban_identity.sessions SET revoked_at = 2000, repository_revision = 2 WHERE session_id = 'test-session'",
      );
      expect((await control.query('SELECT revoked_at FROM zhiban_identity.sessions')).rows[0].revoked_at).toBe('2000');
    } finally {
      await control.end();
    }
  });

  it('stores digest but no raw token, and exposes only explicit function and sequence grants', async () => {
    const admin = adminClient();
    await admin.connect();
    try {
      const columns = await admin.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='zhiban_identity' AND table_name='sessions'",
      );
      const names = columns.rows.map((row) => row.column_name);
      expect(names).toContain('token_digest');
      expect(names).not.toEqual(expect.arrayContaining(['raw_token', 'token', 'cookie', 'secret', 'credential']));
      const acl = await admin.query(
        "SELECT has_function_privilege('zhiban_runtime','zhiban_identity.current_tenant_id()','EXECUTE') AS resolver, has_function_privilege('zhiban_runtime','zhiban_identity.guard_membership_update()','EXECUTE') AS guard, has_sequence_privilege('zhiban_runtime','zhiban_identity.audit_events_event_id_seq','USAGE') AS sequence_usage, has_sequence_privilege('zhiban_runtime','zhiban_identity.audit_events_event_id_seq','UPDATE') AS sequence_update",
      );
      expect(acl.rows[0]).toMatchObject({
        resolver: true,
        guard: false,
        sequence_usage: true,
        sequence_update: false,
      });
    } finally {
      await admin.end();
    }
  });

  it('pins a trusted search_path and records the test database PUBLIC CONNECT setting', async () => {
    const admin = adminClient();
    await admin.connect();
    try {
      const result = await admin.query(
        "SELECT EXISTS (SELECT 1 FROM pg_database d, LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a WHERE d.datname = current_database() AND a.grantee = 0 AND a.privilege_type = 'CONNECT') AS public_connect",
      );
      expect(typeof result.rows[0].public_connect).toBe('boolean');
    } finally {
      await admin.end();
    }
    for (const role of [
      'zhiban_runtime',
      'zhiban_auth_runtime',
      'zhiban_control_runtime',
    ] as const) {
      const client = runtimeClient(role);
      await client.connect();
      try {
        expect((await client.query('SHOW search_path')).rows[0].search_path).toBe(
          'pg_catalog, zhiban_identity, pg_temp',
        );
        await expectPermissionDenied(
          client,
          'CREATE FUNCTION public.pg16_shadow_probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
        );
      } finally {
        await client.end();
      }
    }
  });
});
