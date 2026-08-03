import { describe, expect, it } from 'vitest';

import {
  getZhibanMigrationStatus,
  migrateZhibanDatabase,
  rollbackLatestZhibanMigration,
} from '@/lib/zhiban/db/migrate';
import { initialIdentityMigration } from '@/lib/zhiban/db/migrations/001-initial-identity';
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

    await expect(migrateZhibanDatabase(db)).resolves.toEqual(['001']);
    await expect(migrateZhibanDatabase(db)).resolves.toEqual([]);

    expect(db.applied.get('001')).toBe(initialIdentityMigration.checksum);
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
    ]);
    await expect(rollbackLatestZhibanMigration(db)).resolves.toBe('001');

    expect(db.statements.some(({ text }) => text === 'DROP SCHEMA IF EXISTS zhiban CASCADE')).toBe(
      true,
    );
    expect(db.applied.size).toBe(0);
  });
});
