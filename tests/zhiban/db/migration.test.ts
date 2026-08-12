import { describe, expect, it } from 'vitest';

import {
  getZhibanMigrationStatus,
  migrateZhibanDatabase,
  rollbackLatestZhibanMigration,
} from '@/lib/zhiban/db/migrate';
import { initialIdentityMigration } from '@/lib/zhiban/db/migrations/001-initial-identity';
import { localAuthMigration } from '@/lib/zhiban/db/migrations/002-local-auth';
import type { QueryResult, ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';

class RecordingDatabase implements ZhibanDatabasePool, ZhibanDatabaseClient {
  readonly statements: Array<{ text: string; values?: readonly unknown[] }> = [];
  readonly applied = new Map<string, string>();
  released = 0;
  failOn?: string;

  async connect() {
    return this;
  }

  release() {
    this.released += 1;
  }

  async query<TRow extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<TRow>> {
    this.statements.push({ text, values });
    if (this.failOn && text.includes(this.failOn)) throw new Error('injected migration failure');

    if (text.startsWith('SELECT version, checksum FROM zhiban.schema_migrations')) {
      const rows = [...this.applied.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([version, checksum]) => ({ version, checksum }));
      if (text.includes('DESC')) rows.reverse();
      return { rows: rows.slice(0, text.includes('LIMIT 1') ? 1 : undefined) as unknown as TRow[] };
    }
    if (text.startsWith('INSERT INTO zhiban.schema_migrations')) {
      this.applied.set(String(values?.[0]), String(values?.[2]));
    }
    if (text.startsWith('DELETE FROM zhiban.schema_migrations')) {
      this.applied.delete(String(values?.[0]));
    }
    return { rows: [] };
  }
}

describe('Zhiban PostgreSQL migrations', () => {
  it('applies the initial migration transactionally and only once', async () => {
    const db = new RecordingDatabase();

    await expect(migrateZhibanDatabase(db)).resolves.toEqual([
      '001',
      '002',
      '003',
      '004',
      '005',
      '006',
      '007',
      '008',
      '009',
      '010',
      '011',
      '012',
      '013',
      '014',
      '015',
      '016',
      '017',
      '018',
      '019',
      '020',
      '021',
      '022',
      '023',
      '024',
      '025',
      '026',
      '027',
      '028',
      '029',
      '030',
    ]);
    await expect(migrateZhibanDatabase(db)).resolves.toEqual([]);

    expect(db.applied.get('001')).toBe(initialIdentityMigration.checksum);
    expect(db.applied.get('002')).toBe(localAuthMigration.checksum);
    expect(db.statements.filter(({ text }) => text === 'BEGIN')).toHaveLength(2);
    expect(db.statements.filter(({ text }) => text === 'COMMIT')).toHaveLength(2);
    expect(db.statements.some(({ text }) => text.includes('CREATE TABLE zhiban.accounts'))).toBe(
      true,
    );
    expect(db.released).toBe(2);
  });

  it('rolls back the transaction and releases the client after a DDL failure', async () => {
    const db = new RecordingDatabase();
    db.failOn = 'CREATE TABLE zhiban.accounts';

    await expect(migrateZhibanDatabase(db)).rejects.toThrow('injected migration failure');

    expect(db.statements.at(-1)?.text).toBe('ROLLBACK');
    expect(db.applied.size).toBe(0);
    expect(db.released).toBe(1);
  });

  it('refuses to continue when an applied migration checksum has drifted', async () => {
    const db = new RecordingDatabase();
    db.applied.set('001', 'modified-after-deployment');

    await expect(migrateZhibanDatabase(db)).rejects.toThrow('checksum mismatch');
    expect(db.statements.at(-1)?.text).toBe('ROLLBACK');
  });

  it('reports migration status and supports an explicit latest rollback', async () => {
    const db = new RecordingDatabase();
    await migrateZhibanDatabase(db);

    await expect(getZhibanMigrationStatus(db)).resolves.toEqual([
      expect.objectContaining({ version: '001', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '002', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '003', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '004', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '005', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '006', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '007', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '008', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '009', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '010', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '011', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '012', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '013', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '014', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '015', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '016', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '017', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '018', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '019', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '020', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '021', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '022', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '023', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '024', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '025', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '026', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '027', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '028', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '029', applied: true, checksumMatches: true }),
      expect.objectContaining({ version: '030', applied: true, checksumMatches: true }),
    ]);
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('030');
    expect(db.applied.has('001')).toBe(true);
    expect(db.applied.has('002')).toBe(true);

    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('029');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('028');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('027');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('026');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('025');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('024');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('023');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('022');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('021');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('020');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('019');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('018');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('017');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('016');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('015');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('014');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('013');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('012');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('011');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('010');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('009');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('008');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('007');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('006');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('005');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('004');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('003');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('002');
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('001');

    expect(db.statements.some(({ text }) => text === 'DROP SCHEMA IF EXISTS zhiban CASCADE')).toBe(
      true,
    );
    expect(db.applied.size).toBe(0);
  });
});
