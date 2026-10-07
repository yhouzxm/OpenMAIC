import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as harness from './pg16-harness';

const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawnSync: fixture.spawn,
}));
vi.mock('pg', () => ({
  Client: class {
    query = fixture.query;
    connect = fixture.connect;
    end = fixture.end;
  },
  Pool: class {},
}));

const postgresRoot = new URL(
  '../../../../lib/zhiban/infrastructure/identity/postgres/',
  import.meta.url,
);
const bootstrap = readFileSync(
  fileURLToPath(new URL('bootstrap-roles.pg16.sql', postgresRoot)),
  'utf8',
);
const migration = (version: string) =>
  readFileSync(fileURLToPath(new URL(`migrations/${version}.sql`, postgresRoot)), 'utf8');

describe('Identity role bootstrap static contract (real PG16 behavior remains unverified)', () => {
  it('is self-contained psql-only, stops on error and wraps creation, validation and grants in one transaction', () => {
    expect(bootstrap).toContain('PSQL-ONLY ADMIN BOOTSTRAP SCRIPT');
    expect(bootstrap).toContain('psql -X -f bootstrap-roles.pg16.sql');
    const stop = bootstrap.indexOf('\\set ON_ERROR_STOP on');
    const noRollback = bootstrap.indexOf('\\set ON_ERROR_ROLLBACK off');
    const begin = bootstrap.indexOf('BEGIN;');
    const create = bootstrap.indexOf('CREATE ROLE %I');
    const attributes = bootstrap.indexOf('Unsafe existing Identity role attributes');
    const membership = bootstrap.indexOf('Runtime Identity role membership is forbidden');
    const grant = bootstrap.indexOf('GRANT zhiban_identity_owner TO zhiban_migrator');
    const commit = bootstrap.lastIndexOf('COMMIT;');
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(noRollback).toBeGreaterThan(stop);
    expect(begin).toBeGreaterThan(noRollback);
    expect(create).toBeGreaterThan(begin);
    expect(attributes).toBeGreaterThan(create);
    expect(membership).toBeGreaterThan(attributes);
    expect(grant).toBeGreaterThan(membership);
    expect(commit).toBeGreaterThan(grant);
    expect(bootstrap.slice(commit + 'COMMIT;'.length).trim()).toBe('');
    expect(bootstrap.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(bootstrap.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('creates missing roles only, with the approved login strategy and exact non-privileged attributes', () => {
    for (const [role, canLogin] of [
      ['zhiban_identity_owner', false],
      ['zhiban_migrator', true],
      ['zhiban_runtime', true],
      ['zhiban_auth_runtime', true],
      ['zhiban_control_runtime', true],
    ] as const) {
      expect(bootstrap).toContain(`('${role}', ${canLogin})`);
    }
    expect(bootstrap).toMatch(/IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_catalog\.pg_roles/);
    expect(bootstrap).toContain(
      "CASE WHEN expected_role.can_login THEN 'LOGIN' ELSE 'NOLOGIN' END",
    );
    expect(bootstrap).toContain(
      'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT',
    );
    expect(bootstrap).not.toMatch(/EXCEPTION WHEN duplicate_object/i);
  });

  it('rejects unsafe existing owner, migrator or runtime attributes rather than repairing them', () => {
    for (const attribute of [
      'rolcanlogin',
      'rolsuper',
      'rolcreatedb',
      'rolcreaterole',
      'rolbypassrls',
      'rolreplication',
      'rolinherit',
    ]) {
      expect(bootstrap).toContain(`actual_role.${attribute}`);
    }
    expect(bootstrap).toContain('Unsafe existing Identity role attributes');
    expect(bootstrap).not.toMatch(/ALTER ROLE\s+[^\n]+\s+(?:NO)?SUPERUSER/i);
    expect(bootstrap).not.toMatch(/REVOKE\s+zhiban_identity_owner\s+FROM/i);
  });

  it('rejects any runtime membership, including owner, migrator and cross-runtime paths', () => {
    expect(bootstrap).toContain('pg_catalog.pg_auth_members membership');
    expect(bootstrap).toContain(
      'runtime_role.oid = membership.member OR runtime_role.oid = membership.roleid',
    );
    for (const role of ['zhiban_runtime', 'zhiban_auth_runtime', 'zhiban_control_runtime']) {
      expect(bootstrap).toContain(role);
    }
    expect(bootstrap).toContain("RAISE EXCEPTION 'Runtime Identity role membership is forbidden'");
    expect(bootstrap).toContain('WITH RECURSIVE set_paths AS');
    expect(bootstrap).toContain('membership.set_option');
    expect(bootstrap).toContain('SELECT 1 FROM set_paths WHERE can_set');
  });

  it('accepts only the exact migrator-to-owner membership and rejects other owner/migrator edges', () => {
    expect(bootstrap).toContain('WHERE member = owner_oid');
    expect(bootstrap).toContain('WHERE roleid = migrator_oid');
    expect(bootstrap).toContain('WHERE member = migrator_oid AND roleid <> owner_oid');
    expect(bootstrap).toContain('WHERE roleid = owner_oid AND member <> migrator_oid');
    expect(bootstrap).toContain('admin_option OR inherit_option OR NOT set_option');
    expect(bootstrap).toMatch(
      /IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_catalog\.pg_auth_members\s*WHERE member = migrator_oid AND roleid = owner_oid\s*\) THEN\s*GRANT zhiban_identity_owner TO zhiban_migrator/,
    );
  });

  it('rejects effective runtime DDL privileges instead of silently repairing direct grants', () => {
    expect(bootstrap).toContain(
      "has_database_privilege(runtime_name, current_database(), 'CREATE')",
    );
    expect(bootstrap).toContain(
      "has_database_privilege(runtime_name, current_database(), 'TEMPORARY')",
    );
    expect(bootstrap).toContain("has_schema_privilege(runtime_name, 'public', 'CREATE')");
    expect(bootstrap).toContain('Unsafe effective Identity runtime DDL privilege');
    expect(bootstrap).not.toMatch(
      /REVOKE\s+(?:CREATE|TEMPORARY)[^;]*FROM zhiban_(?:runtime|auth_runtime|control_runtime)/i,
    );
  });

  it('normalizes only Identity-owned object ACLs before exact runtime grants', () => {
    const first = migration('0001_identity_bootstrap');
    const second = migration('0002_identity_core');
    const third = migration('0003_identity_audit_and_rls');
    const principals = 'PUBLIC, zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime';
    expect(first).toContain(`REVOKE ALL ON SCHEMA zhiban_identity FROM ${principals}`);
    expect(first).toContain(`REVOKE ALL ON zhiban_identity.schema_migrations FROM ${principals}`);
    for (const sql of [second, third]) {
      for (const kind of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) {
        expect(sql).toContain(
          `REVOKE ALL ON ALL ${kind} IN SCHEMA zhiban_identity FROM ${principals}`,
        );
      }
    }
    expect(third.indexOf('REVOKE ALL ON ALL TABLES IN SCHEMA')).toBeLessThan(
      third.indexOf('GRANT SELECT, INSERT ON zhiban_identity.memberships'),
    );
  });
});

describe('disposable harness rejects unsafe LOCAL inputs before mutation', () => {
  beforeEach(() => {
    vi.stubEnv('ZB_PG16_EXECUTION_MODE', 'LOCAL');
    vi.stubEnv('ZB_PG16_DISPOSABLE', '1');
    vi.stubEnv('ZB_PG16_ADMIN_URL', 'postgresql://postgres@127.0.0.1:55432/zhiban_pg16_test');
    vi.stubEnv('GITHUB_ACTIONS', undefined);
    vi.stubEnv('GITHUB_SHA', undefined);
    fixture.query.mockReset();
    fixture.spawn.mockReset().mockReturnValue({ status: 0, stderr: '' });
    fixture.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT version()'))
        return {
          rows: [
            {
              version: 'PostgreSQL 16.0',
              server_version: '16.0',
              database_name: 'zhiban_pg16_test',
              session_user: 'postgres',
            },
          ],
        };
      if (sql.includes("current_setting('port')"))
        return { rows: [{ port: '55432', directory: '/var/lib/postgresql/16/zhiban_test' }] };
      if (sql.includes('FROM pg_database'))
        return { rows: [{ datname: 'zhiban_pg16_test' }, { datname: 'postgres' }] };
      if (sql.includes('FROM pg_roles')) return { rows: [{ rolname: 'postgres' }] };
      if (sql.includes('FROM pg_namespace')) return { rows: [{ nspname: 'public' }] };
      return { rows: [{ count: '0' }] };
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    ['ZB_PG16_EXECUTION_MODE', 'UNKNOWN'],
    ['ZB_PG16_DISPOSABLE', '0'],
    ['GITHUB_ACTIONS', 'true'],
    ['GITHUB_SHA', 'fake'],
    ['ZB_PG16_ADMIN_URL', 'postgresql://postgres@127.0.0.1:5432/zhiban_pg16_test'],
    ['ZB_PG16_ADMIN_URL', 'postgresql://postgres@remote:55432/zhiban_pg16_test'],
    ['ZB_PG16_ADMIN_URL', 'postgresql://postgres@127.0.0.1:55432/production'],
    ['ZB_PG16_ADMIN_URL', 'postgresql://application@127.0.0.1:55432/zhiban_pg16_test'],
    [
      'ZB_PG16_ADMIN_URL',
      'postgresql://postgres@127.0.0.1:55432/zhiban_pg16_test?options=-csearch_path=public',
    ],
  ])('rejects %s=%s without a query', async (key, value) => {
    vi.stubEnv(key, value);
    await expect(harness.resetDisposableIdentity()).rejects.toThrow();
    expect(fixture.query).not.toHaveBeenCalled();
    expect(() => harness.runBootstrap()).toThrow();
    expect(fixture.spawn).not.toHaveBeenCalled();
  });
  it.each([
    [
      'SELECT version()',
      {
        version: 'PostgreSQL 18.0',
        server_version: '18.0',
        database_name: 'zhiban_pg16_test',
        session_user: 'postgres',
      },
    ],
    ["current_setting('port')", { port: '55432', directory: '/var/lib/postgresql/16/main' }],
    ['FROM pg_database', { datname: 'unrelated' }],
    ['FROM pg_roles', { rolname: 'unrelated' }],
    ['FROM pg_namespace', { nspname: 'unrelated' }],
    ['SELECT count(*)', { count: '1' }],
  ])('rejects cluster mismatch in %s before DROP', async (match, row) => {
    const original = fixture.query.getMockImplementation()!;
    fixture.query.mockImplementation((sql: string) =>
      sql.includes(match) ? Promise.resolve({ rows: [row] }) : original(sql),
    );
    await expect(harness.resetDisposableIdentity()).rejects.toThrow();
    expect(fixture.query.mock.calls.every(([sql]) => !/DROP|ALTER|CREATE/.test(sql))).toBe(true);
  });
  it('accepts only the dedicated PG16 cluster metadata', async () => {
    expect(await harness.verifyPg16()).toBe('16.0');
  });
  it.each(['LOCAL', 'GITHUB_ACTIONS', undefined])(
    'keeps bootstrap on the validated target despite libpq redirection in mode %s',
    (mode) => {
      vi.stubEnv('ZB_PG16_EXECUTION_MODE', mode);
      if (mode !== 'LOCAL') vi.stubEnv('GITHUB_ACTIONS', 'true');
      vi.stubEnv('PGSERVICE', 'unrelated-cluster');
      vi.stubEnv('PGSERVICEFILE', '/unrelated/pg_service.conf');
      vi.stubEnv('PGHOSTADDR', '127.0.0.2');
      vi.stubEnv('PGHOST', 'unrelated');
      vi.stubEnv('PGPORT', '55433');
      vi.stubEnv('PGDATABASE', 'unrelated');
      vi.stubEnv('PGUSER', 'unrelated');
      vi.stubEnv('PGPASSFILE', '/local/test-only.pgpass');
      vi.stubEnv(
        'ZB_PG16_ADMIN_URL',
        'postgresql://postgres:test%3Aonly%40bootstrap@127.0.0.1:55432/zhiban_pg16_test',
      );
      expect(harness.runBootstrap().success).toBe(true);
      const [program, args, options] = fixture.spawn.mock.calls[0];
      expect(program).toBe('psql');
      expect(args.slice(0, 9)).toEqual([
        '-X',
        '--host',
        '127.0.0.1',
        '--port',
        '55432',
        '--dbname',
        'zhiban_pg16_test',
        '--username',
        'postgres',
      ]);
      for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'])
        expect(options.env).not.toHaveProperty(key);
      expect(options.env).toMatchObject({
        PGHOST: '127.0.0.1',
        PGPORT: '55432',
        PGDATABASE: 'zhiban_pg16_test',
        PGUSER: 'postgres',
        PGPASSFILE: '/local/test-only.pgpass',
        PGPASSWORD: 'test:only@bootstrap',
      });
      expect(args.join(' ')).not.toContain('test:only@bootstrap');
      expect(args.join(' ')).not.toContain('test%3Aonly%40bootstrap');
    },
  );
});
