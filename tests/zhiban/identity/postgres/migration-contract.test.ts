import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMigrationFiles } from '@/lib/zhiban/infrastructure/identity/postgres/migrate';

const postgresRoot = new URL(
  '../../../../lib/zhiban/infrastructure/identity/postgres/',
  import.meta.url,
);
const bootstrap = readFileSync(
  fileURLToPath(new URL('bootstrap-roles.pg16.sql', postgresRoot)),
  'utf8',
);

describe('Identity PostgreSQL 16 migration contract (static; not a PG16 verification)', () => {
  it('has unique, contiguous, checksummed migrations', async () => {
    const files = await loadMigrationFiles();
    expect(files.map((file) => file.version)).toEqual(['0001', '0002', '0003']);
    for (const file of files) expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('bootstraps a dedicated schema and ledger before core DDL', async () => {
    const [first] = await loadMigrationFiles();
    expect(first.sql).toContain('CREATE SCHEMA zhiban_identity');
    expect(first.sql).toContain('CREATE TABLE zhiban_identity.schema_migrations');
    expect(first.sql).toContain('checksum text NOT NULL');
    expect(first.sql).toContain('applied_at timestamptz NOT NULL');
    expect(first.sql).not.toContain('CREATE TABLE public.');
  });

  it('declares exactly the seven approved business tables, not credentials or mappings', async () => {
    const files = await loadMigrationFiles();
    const sql = files.map((file) => file.sql).join('\n');
    const tables = [...sql.matchAll(/CREATE TABLE zhiban_identity\.([a-z_]+)\s*\(/g)].map(
      (match) => match[1],
    );
    expect(tables).toEqual([
      'schema_migrations',
      'users',
      'tenants',
      'memberships',
      'role_grants',
      'system_admin_grants',
      'sessions',
      'audit_events',
    ]);
    expect(sql).not.toMatch(/CREATE TABLE\s+[^;]*credentials/i);
    expect(sql).not.toMatch(
      /CREATE TABLE\s+[^;]*(stage|scene|activity|asset|runtime|agent|mapping)/i,
    );
  });

  it('separates authorization version from persistence revision and uses BIGINT instants', async () => {
    const sql = (await loadMigrationFiles())[1].sql;
    expect(sql).toContain('authorization_version bigint NOT NULL DEFAULT 0');
    expect(sql).toContain('repository_revision bigint NOT NULL DEFAULT 1');
    expect(sql).toContain('8640000000000000');
    expect(sql).not.toMatch(/\bxmin\b|gen_random_uuid\s*\(/i);
  });

  it('enforces tenant composite FK, three tenant roles and scope shape', async () => {
    const sql = (await loadMigrationFiles())[1].sql;
    expect(sql).toContain('FOREIGN KEY (tenant_id, membership_id)');
    expect(sql).toContain(
      'REFERENCES zhiban_identity.memberships(tenant_id, membership_id) ON DELETE RESTRICT',
    );
    expect(sql).toContain("role_code IN ('STUDENT', 'TEACHER', 'TENANT_ADMIN')");
    expect(sql).toContain("scope_kind IN ('SELF', 'TENANT', 'CLASS', 'COURSE')");
    expect(sql).toContain('role_grants_immutable_guard');
    expect(sql).toContain('memberships_immutable_guard');
  });

  it('keeps system-admin grants global and sessions free of raw token or tenant authority', async () => {
    const sql = (await loadMigrationFiles())[1].sql;
    const admin = sql.split('CREATE TABLE zhiban_identity.system_admin_grants (')[1].split(');')[0];
    const session = sql.split('CREATE TABLE zhiban_identity.sessions (')[1].split(');')[0];
    expect(admin).not.toMatch(/tenant_id|membership_id|role_code|scope_kind/);
    expect(session).toContain('token_digest text NOT NULL UNIQUE');
    expect(session).not.toMatch(/\braw_token\b|\btenant_id\b|\bpermissions\b/);
  });

  it('uses a pure invoker tenant resolver and FORCE RLS on all tenant/mixed tables', async () => {
    const sql = (await loadMigrationFiles())[2].sql;
    const resolver = sql
      .split('CREATE FUNCTION zhiban_identity.current_tenant_id()')[1]
      .split('CREATE TABLE zhiban_identity.audit_events')[0];
    expect(resolver).toContain('SECURITY INVOKER');
    expect(resolver).toContain("current_setting('app.tenant_id', true)");
    expect(resolver).not.toMatch(/SELECT\s+[\s\S]*FROM\s+zhiban_identity\.tenants/i);
    expect(sql).not.toContain('SECURITY DEFINER');
    for (const table of ['memberships', 'role_grants', 'audit_events']) {
      expect(sql).toContain(`ALTER TABLE zhiban_identity.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE zhiban_identity.${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(sql).not.toContain('ALTER TABLE zhiban_identity.tenants ENABLE ROW LEVEL SECURITY');
  });

  it('keeps audit mixed, tenant-FK constrained, closed-shape and append-only for runtime', async () => {
    const sql = (await loadMigrationFiles())[2].sql;
    expect(sql).toContain(
      'tenant_id uuid REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT',
    );
    expect(sql).toContain('event_payload jsonb NOT NULL');
    expect(sql).toContain(
      'audit_closed_payload CHECK (zhiban_identity.audit_payload_valid(event_type, event_payload) IS TRUE)',
    );
    expect(sql).toContain('CREATE POLICY audit_tenant_insert');
    expect(sql).toContain('CREATE POLICY audit_auth_insert');
    expect(sql).toContain('CREATE POLICY audit_control_insert');
    expect(sql).not.toMatch(/GRANT\s+(UPDATE|DELETE|TRUNCATE)\b[^;]*audit_events/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT\b[^;]*audit_events/i);
  });

  it('creates runtime principals without owner/migrator membership or bypass attributes', () => {
    for (const [role, canLogin] of [
      ['zhiban_identity_owner', false],
      ['zhiban_migrator', true],
      ['zhiban_runtime', true],
      ['zhiban_auth_runtime', true],
      ['zhiban_control_runtime', true],
    ] as const) {
      expect(bootstrap).toContain(`('${role}', ${canLogin})`);
    }
    expect(bootstrap).toContain(
      'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT',
    );
    expect(bootstrap).toMatch(
      /GRANT zhiban_identity_owner TO zhiban_migrator\s+WITH ADMIN FALSE, INHERIT FALSE, SET TRUE/,
    );
    expect(bootstrap).toContain('GRANT CREATE ON DATABASE %I TO zhiban_identity_owner');
    expect(bootstrap).toContain('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC');
    expect(bootstrap).toContain('SET search_path = pg_catalog, zhiban_identity, pg_temp');
  });

  it('does not grant tenant runtime control-plane or DDL access', async () => {
    const sql = (await loadMigrationFiles())[2].sql;
    expect(sql).not.toMatch(
      /GRANT\s+[^;]*ON zhiban_identity\.(users|tenants|sessions|system_admin_grants)\s+TO zhiban_runtime\b/i,
    );
    expect(sql).not.toMatch(/GRANT\s+(CREATE|TRUNCATE|DELETE)\b[^;]*TO zhiban_runtime\b/i);
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION zhiban_identity.current_tenant_id() TO zhiban_runtime',
    );
  });

  it('keeps the migration runner independent of web and OpenMAIC persistence internals', () => {
    for (const name of ['migrate.ts', 'migrate-cli.ts']) {
      const source = readFileSync(fileURLToPath(new URL(name, postgresRoot)), 'utf8');
      expect(source).not.toMatch(
        /from ['"](?:@openmaic\/|@\/lib\/persistence\/|next|react|zustand)/,
      );
      expect(source).not.toContain('server-provider');
    }
  });
});
