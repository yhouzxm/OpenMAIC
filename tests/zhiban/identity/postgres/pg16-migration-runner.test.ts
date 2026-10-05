import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, type QueryResultRow } from 'pg';
import {
  applyMigrations,
  loadMigrationFiles,
  planMigrations,
} from '@/lib/zhiban/infrastructure/identity/postgres/migrate';
import {
  adminClient,
  applyRealMigrations,
  configured,
  provisionRolePasswords,
  resetDisposableIdentity,
  runBootstrap,
  runtimeClient,
  verifyPg16,
} from './pg16-harness';

function migrationConnection(client: Client) {
  return {
    query: async (sql: string, parameters?: readonly unknown[]) => {
      const result = await client.query<QueryResultRow>(sql, parameters ? [...parameters] : []);
      return { rows: result.rows };
    },
  };
}

async function emptyReadyDatabase(): Promise<void> {
  await resetDisposableIdentity();
  expect(runBootstrap().success).toBe(true);
  await provisionRolePasswords();
}

describe.skipIf(!configured).sequential('real PostgreSQL 16 Identity migration runner', () => {
  beforeAll(async () => {
    expect(await verifyPg16()).toMatch(/^16\./);
  });
  beforeEach(emptyReadyDatabase);
  afterAll(resetDisposableIdentity);

  it('applies 0001–0013 from empty database and a second CLI run is a no-op', async () => {
    const admin = adminClient();
    await admin.connect();
    try {
      const before = await admin.query("SELECT to_regnamespace('zhiban_identity') AS name");
      expect(before.rows[0].name).toBeNull();
    } finally {
      await admin.end();
    }
    const source = process.env.ZB_PG16_ADMIN_URL;
    if (!source) throw new Error('Dedicated PostgreSQL URL is required.');
    const url = new URL(source);
    url.username = 'zhiban_migrator';
    url.password = process.env.ZB_PG16_ROLE_PASSWORD || '';
    const cli = 'lib/zhiban/infrastructure/identity/postgres/migrate-cli.ts';
    const run = () =>
      spawnSync('pnpm', ['exec', 'tsx', cli], {
        cwd: process.cwd(),
        env: { ...process.env, ZHIBAN_IDENTITY_MIGRATOR_DATABASE_URL: url.toString() },
        encoding: 'utf8',
        timeout: 60_000,
      });
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain(
      '0001, 0002, 0003, 0004, 0005, 0006, 0007, 0008, 0009, 0010, 0011, 0012, 0013',
    );
    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain('none');
    const check = adminClient();
    await check.connect();
    try {
      const ledger = await check.query(
        'SELECT version, checksum, applied_at IS NOT NULL AS has_time FROM zhiban_identity.schema_migrations ORDER BY version',
      );
      expect(ledger.rows.map((row) => row.version)).toEqual([
        '0001',
        '0002',
        '0003',
        '0004',
        '0005',
        '0006',
        '0007',
        '0008',
        '0009',
        '0010',
        '0011',
        '0012',
        '0013',
      ]);
      expect(ledger.rows.every((row) => /^[0-9a-f]{64}$/.test(row.checksum) && row.has_time)).toBe(
        true,
      );
    } finally {
      await check.end();
    }
  });

  it('upgrades applied 0012 with only 0013, preserving checksum, trigger identity and function security', async () => {
    const files = await loadMigrationFiles();
    const migrator = runtimeClient('zhiban_migrator'),
      check = adminClient();
    await migrator.connect();
    await check.connect();
    try {
      await applyMigrations(migrationConnection(migrator), files.slice(0, 12));
      const priorLedger = (
        await check.query(
          'SELECT version,checksum FROM zhiban_identity.schema_migrations ORDER BY version',
        )
      ).rows;
      const metadata = () =>
        check.query(
          "SELECT oid::text,proowner::text,prosecdef,proconfig,proacl::text FROM pg_proc WHERE oid='zhiban_bridge.mapping_consistency()'::regprocedure",
        );
      const triggers = () =>
        check.query(
          "SELECT oid::text,tgfoid::text,tgdeferrable,tginitdeferred FROM pg_trigger WHERE tgfoid='zhiban_bridge.mapping_consistency()'::regprocedure ORDER BY oid",
        );
      const priorFunction = (await metadata()).rows;
      const priorTriggers = (await triggers()).rows;
      expect(priorTriggers).toHaveLength(6);
      expect(await applyMigrations(migrationConnection(migrator), files)).toEqual(['0013']);
      expect(
        (
          await check.query(
            "SELECT version,checksum FROM zhiban_identity.schema_migrations WHERE version<='0012' ORDER BY version",
          )
        ).rows,
      ).toEqual(priorLedger);
      expect((await metadata()).rows).toEqual(priorFunction);
      expect((await triggers()).rows).toEqual(priorTriggers);
      const definition = (
        await check.query(
          "SELECT pg_get_functiondef('zhiban_bridge.mapping_consistency()'::regprocedure) AS definition",
        )
      ).rows[0].definition;
      expect(definition).toContain("IF TG_TABLE_NAME='resource_slots' THEN");
      expect(definition).not.toContain("IF TG_TABLE_NAME='resource_slots' AND");
      expect(await applyMigrations(migrationConnection(migrator), files)).toEqual([]);
    } finally {
      await Promise.all([migrator.end(), check.end()]);
    }
  });

  it('rejects checksum drift without changing the ledger', async () => {
    expect(await applyRealMigrations()).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
    ]);
    const admin = adminClient();
    await admin.connect();
    try {
      await admin.query(
        "UPDATE zhiban_identity.schema_migrations SET checksum = repeat('0', 64) WHERE version = '0002'",
      );
    } finally {
      await admin.end();
    }
    await expect(applyRealMigrations()).rejects.toThrow('checksum drift');
    const check = adminClient();
    await check.connect();
    try {
      const ledger = await check.query(
        "SELECT checksum FROM zhiban_identity.schema_migrations WHERE version = '0002'",
      );
      expect(ledger.rows[0].checksum).toBe('0'.repeat(64));
    } finally {
      await check.end();
    }
  });

  it('rolls back a test-only failed 0014 migration and its ledger entry', async () => {
    expect(await applyRealMigrations()).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
    ]);
    const files = await loadMigrationFiles();
    const failing = planMigrations([
      ...files.map(({ name, sql }) => ({ name, sql })),
      {
        name: '0014_test_failure.sql',
        sql: 'CREATE TABLE zhiban_identity.pg16_failure_probe (id int); SELECT 1 / 0;',
      },
    ]);
    const migrator = runtimeClient('zhiban_migrator');
    await migrator.connect();
    try {
      await expect(applyMigrations(migrationConnection(migrator), failing)).rejects.toMatchObject({
        code: '22012',
      });
    } finally {
      await migrator.end();
    }
    const admin = adminClient();
    await admin.connect();
    try {
      const result = await admin.query(
        "SELECT to_regclass('zhiban_identity.pg16_failure_probe') AS table_name, (SELECT count(*)::int FROM zhiban_identity.schema_migrations WHERE version = '0014') AS ledger_count",
      );
      expect(result.rows[0]).toMatchObject({ table_name: null, ledger_count: 0 });
    } finally {
      await admin.end();
    }
  });

  it('serializes two real independent migrator connections with one advisory lock', async () => {
    const first = runtimeClient('zhiban_migrator');
    const second = runtimeClient('zhiban_migrator');
    await Promise.all([first.connect(), second.connect()]);
    try {
      const files = await loadMigrationFiles();
      const results = await Promise.all([
        applyMigrations(migrationConnection(first), files),
        applyMigrations(migrationConnection(second), files),
      ]);
      expect(results.map((result) => result.length).sort()).toEqual([0, 13]);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
    const admin = adminClient();
    await admin.connect();
    try {
      const ledger = await admin.query(
        'SELECT version, count(*)::int AS count FROM zhiban_identity.schema_migrations GROUP BY version ORDER BY version',
      );
      expect(ledger.rows).toEqual([
        { version: '0001', count: 1 },
        { version: '0002', count: 1 },
        { version: '0003', count: 1 },
        { version: '0004', count: 1 },
        { version: '0005', count: 1 },
        { version: '0006', count: 1 },
        { version: '0007', count: 1 },
        { version: '0008', count: 1 },
        { version: '0009', count: 1 },
        { version: '0010', count: 1 },
        { version: '0011', count: 1 },
        { version: '0012', count: 1 },
        { version: '0013', count: 1 },
      ]);
    } finally {
      await admin.end();
    }
  });
});
