import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
