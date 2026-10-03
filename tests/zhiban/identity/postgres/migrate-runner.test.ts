import { describe, expect, it } from 'vitest';
import {
  applyMigrations,
  loadMigrationFiles,
  planMigrations,
  type MigrationConnection,
} from '@/lib/zhiban/infrastructure/identity/postgres/migrate';

const files = () =>
  planMigrations([
    { name: '0002_core.sql', sql: 'CREATE TABLE zhiban_identity.users (id int);' },
    {
      name: '0001_bootstrap.sql',
      sql: 'CREATE SCHEMA zhiban_identity; CREATE TABLE zhiban_identity.schema_migrations (version text);',
    },
  ]);

class FakeConnection implements MigrationConnection {
  readonly calls: string[] = [];
  readonly ledger = new Map<string, string>();
  schemaExists = false;
  failOnSql: string | null = null;
  sessionUser = 'zhiban_migrator';
  private pendingVersion: readonly [string, string] | null = null;
  private pendingBootstrap = false;

  async query(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    this.calls.push(sql);
    if (this.failOnSql && sql.includes(this.failOnSql))
      throw new Error('synthetic migration failure');
    if (sql === 'SELECT session_user AS session_user') {
      return { rows: [{ session_user: this.sessionUser }] };
    }
    if (sql.includes('to_regnamespace')) {
      return {
        rows: [
          {
            schema_name: this.schemaExists ? 'zhiban_identity' : null,
            ledger_name: this.schemaExists ? 'zhiban_identity.schema_migrations' : null,
          },
        ],
      };
    }
    if (sql.startsWith('SELECT version, checksum FROM')) {
      return { rows: [...this.ledger].map(([version, checksum]) => ({ version, checksum })) };
    }
    if (sql === 'BEGIN') {
      this.pendingVersion = null;
      this.pendingBootstrap = false;
    } else if (sql.startsWith('CREATE SCHEMA zhiban_identity;')) {
      this.pendingBootstrap = true;
    } else if (sql.startsWith('INSERT INTO zhiban_identity.schema_migrations')) {
      this.pendingVersion = [String(parameters?.[0]), String(parameters?.[1])];
    } else if (sql === 'COMMIT') {
      if (this.pendingBootstrap) this.schemaExists = true;
      if (this.pendingVersion) this.ledger.set(...this.pendingVersion);
      this.pendingBootstrap = false;
      this.pendingVersion = null;
    } else if (sql === 'ROLLBACK') {
      this.pendingBootstrap = false;
      this.pendingVersion = null;
    }
    return { rows: [] };
  }
}

describe('dedicated Identity migration runner (connection contract)', () => {
  it('orders numbered migrations and computes stable SHA-256 checksums', () => {
    const plan = files();
    expect(plan.map((migration) => migration.version)).toEqual(['0001', '0002']);
    expect(planMigrations([{ name: '0001_bootstrap.sql', sql: plan[0].sql }])[0].checksum).toBe(
      plan[0].checksum,
    );
  });

  it('rejects duplicate, missing, malformed and empty migration files', () => {
    expect(() =>
      planMigrations([
        { name: '0001_a.sql', sql: 'SELECT 1;' },
        { name: '0001_b.sql', sql: 'SELECT 2;' },
      ]),
    ).toThrow('Duplicate');
    expect(() => planMigrations([{ name: '0002_a.sql', sql: 'SELECT 1;' }])).toThrow('0001');
    expect(() =>
      planMigrations([
        { name: '0001_a.sql', sql: 'SELECT 1;' },
        { name: '0003_c.sql', sql: 'SELECT 3;' },
      ]),
    ).toThrow('contiguous');
    expect(() => planMigrations([{ name: '0001_a.sql', sql: ' ' }])).toThrow('empty');
  });

  it('applies an empty database plan in order with one session lock and per-file transactions', async () => {
    const db = new FakeConnection();
    expect(await applyMigrations(db, files())).toEqual(['0001', '0002']);
    expect([...db.ledger.keys()]).toEqual(['0001', '0002']);
    expect(db.calls.indexOf('SELECT pg_advisory_lock(20260925, 10001)')).toBeLessThan(
      db.calls.indexOf('BEGIN'),
    );
    expect(db.calls.filter((call) => call === 'BEGIN')).toHaveLength(2);
    expect(db.calls.filter((call) => call === 'COMMIT')).toHaveLength(2);
    expect(db.calls.at(-2)).toBe('SELECT pg_advisory_unlock(20260925, 10001)');
    expect(db.calls.at(-1)).toBe('RESET ROLE');
  });

  it('skips already applied migrations only when checksums match', async () => {
    const db = new FakeConnection();
    await applyMigrations(db, files());
    db.calls.length = 0;
    expect(await applyMigrations(db, files())).toEqual([]);
    expect(db.calls).not.toContain('BEGIN');
  });

  it('upgrades an applied 0004 ledger with 0005–0008, keeps old checksums and then becomes a no-op', async () => {
    const plan = await loadMigrationFiles();
    const db = new FakeConnection();
    db.schemaExists = true;
    for (const migration of plan.slice(0, 4)) db.ledger.set(migration.version, migration.checksum);
    const oldLedger = [...db.ledger];
    expect(await applyMigrations(db, plan)).toEqual(['0005', '0006', '0007', '0008']);
    expect([...db.ledger].slice(0, 4)).toEqual(oldLedger);
    expect(db.calls.filter((call) => call === 'BEGIN')).toHaveLength(4);
    expect(db.calls).toContain(plan[6].sql);
    expect(db.calls).toContain(plan[4].sql);
    expect(db.calls).toContain(plan[5].sql);
    for (const migration of plan.slice(0, 4)) expect(db.calls).not.toContain(migration.sql);
    db.calls.length = 0;
    expect(await applyMigrations(db, plan)).toEqual([]);
    expect(db.calls).not.toContain('BEGIN');
    db.ledger.set('0004', '0'.repeat(64));
    await expect(applyMigrations(db, plan)).rejects.toThrow('checksum drift');
    expect(db.calls).not.toContain('BEGIN');
  });

  it('fails loudly on changed checksum or an unknown applied version', async () => {
    const db = new FakeConnection();
    await applyMigrations(db, files());
    const changed = planMigrations([
      { name: '0001_bootstrap.sql', sql: 'SELECT 99;' },
      { name: '0002_core.sql', sql: 'SELECT 2;' },
    ]);
    await expect(applyMigrations(db, changed)).rejects.toThrow('checksum drift');
    db.ledger.set('9999', '0'.repeat(64));
    await expect(applyMigrations(db, files())).rejects.toThrow('Unknown applied');
  });

  it('upgrades applied 0005 with Session/authorization migrations 0006–0008, preserving all old checksums', async () => {
    const plan = await loadMigrationFiles(),
      db = new FakeConnection();
    db.schemaExists = true;
    for (const migration of plan.slice(0, 5)) db.ledger.set(migration.version, migration.checksum);
    const prior = [...db.ledger];
    expect(await applyMigrations(db, plan)).toEqual(['0006', '0007', '0008']);
    expect([...db.ledger].slice(0, 5)).toEqual(prior);
    expect(db.calls.filter((call) => call === 'BEGIN')).toHaveLength(3);
    expect(db.calls).toContain(plan[6].sql);
    for (const migration of plan.slice(0, 5)) expect(db.calls).not.toContain(migration.sql);
    expect(await applyMigrations(db, plan)).toEqual([]);
  });

  it('upgrades 0001–0006 with 0007–0008, preserves checksums, and is then a no-op', async () => {
    const plan = await loadMigrationFiles(),
      db = new FakeConnection();
    db.schemaExists = true;
    for (const migration of plan.slice(0, 6)) db.ledger.set(migration.version, migration.checksum);
    const prior = [...db.ledger];
    expect(await applyMigrations(db, plan)).toEqual(['0007', '0008']);
    expect([...db.ledger].slice(0, 6)).toEqual(prior);
    expect(db.calls.filter((call) => call === 'BEGIN')).toHaveLength(2);
    expect(db.calls).toContain(plan[7].sql);
    for (const migration of plan.slice(0, 6)) expect(db.calls).not.toContain(migration.sql);
    db.calls.length = 0;
    expect(await applyMigrations(db, plan)).toEqual([]);
    expect(db.calls).not.toContain('BEGIN');
  });

  it('rejects an applied ledger gap before attempting a new migration', async () => {
    const db = new FakeConnection();
    const plan = planMigrations([
      { name: '0001_bootstrap.sql', sql: 'SELECT 1;' },
      { name: '0002_core.sql', sql: 'SELECT 2;' },
      { name: '0003_audit.sql', sql: 'SELECT 3;' },
    ]);
    db.schemaExists = true;
    db.ledger.set('0001', plan[0].checksum);
    db.ledger.set('0003', plan[2].checksum);
    await expect(applyMigrations(db, plan)).rejects.toThrow('version gap');
    expect(db.calls).not.toContain('BEGIN');

    db.ledger.delete('0001');
    db.ledger.set('0002', plan[1].checksum);
    await expect(applyMigrations(db, plan)).rejects.toThrow('bootstrap ledger entry');
    expect(db.calls).not.toContain('BEGIN');
  });

  it('rolls back failed SQL without a committed ledger row', async () => {
    const db = new FakeConnection();
    db.failOnSql = 'CREATE TABLE zhiban_identity.users';
    await expect(applyMigrations(db, files())).rejects.toThrow('synthetic migration failure');
    expect(db.ledger.has('0001')).toBe(true);
    expect(db.ledger.has('0002')).toBe(false);
    expect(db.calls).toContain('ROLLBACK');
    expect(db.calls.at(-1)).toBe('RESET ROLE');
  });

  it('refuses a non-migrator session before taking the lock or applying DDL', async () => {
    const db = new FakeConnection();
    db.sessionUser = 'zhiban_runtime';
    await expect(applyMigrations(db, files())).rejects.toThrow('dedicated zhiban_migrator');
    expect(db.calls).not.toContain('SET ROLE zhiban_identity_owner');
    expect(db.calls).not.toContain('BEGIN');
  });
});
