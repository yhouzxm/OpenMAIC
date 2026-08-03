import { ZHIBAN_MIGRATIONS, type ZhibanMigration } from './migrations';
import type { ZhibanDatabaseClient, ZhibanDatabasePool, ZhibanQueryable } from './types';

const MIGRATION_LOCK = 'zhiban-schema-migrations';

const bootstrapStatements = [
  'CREATE SCHEMA IF NOT EXISTS zhiban',
  `CREATE TABLE IF NOT EXISTS zhiban.schema_migrations (
    version VARCHAR(32) PRIMARY KEY,
    description TEXT NOT NULL,
    checksum VARCHAR(128) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
] as const;

interface AppliedMigrationRow extends Record<string, unknown> {
  version: string;
  checksum: string;
}

export interface ZhibanMigrationStatus {
  version: string;
  description: string;
  applied: boolean;
  checksumMatches: boolean;
}

async function inMigrationTransaction<T>(
  pool: ZhibanDatabasePool,
  operation: (client: ZhibanDatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [MIGRATION_LOCK]);
    for (const statement of bootstrapStatements) await client.query(statement);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
}

async function readApplied(queryable: ZhibanQueryable): Promise<Map<string, string>> {
  const result = await queryable.query<AppliedMigrationRow>(
    'SELECT version, checksum FROM zhiban.schema_migrations ORDER BY version',
  );
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

function assertKnownChecksums(
  applied: Map<string, string>,
  migrations: readonly ZhibanMigration[],
) {
  for (const migration of migrations) {
    const checksum = applied.get(migration.version);
    if (checksum !== undefined && checksum !== migration.checksum) {
      throw new Error(
        `Zhiban migration ${migration.version} checksum mismatch: database=${checksum}, code=${migration.checksum}`,
      );
    }
  }
}

export async function migrateZhibanDatabase(pool: ZhibanDatabasePool): Promise<string[]> {
  return inMigrationTransaction(pool, async (client) => {
    const applied = await readApplied(client);
    assertKnownChecksums(applied, ZHIBAN_MIGRATIONS);
    const completed: string[] = [];

    for (const migration of ZHIBAN_MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      for (const statement of migration.up) await client.query(statement);
      await client.query(
        `INSERT INTO zhiban.schema_migrations (version, description, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.description, migration.checksum],
      );
      completed.push(migration.version);
    }
    return completed;
  });
}

export async function rollbackLatestZhibanMigration(
  pool: ZhibanDatabasePool,
): Promise<string | null> {
  return inMigrationTransaction(pool, async (client) => {
    const result = await client.query<AppliedMigrationRow>(
      `SELECT version, checksum FROM zhiban.schema_migrations
       ORDER BY version DESC LIMIT 1`,
    );
    const applied = result.rows[0];
    if (!applied) return null;

    const migration = ZHIBAN_MIGRATIONS.find((candidate) => candidate.version === applied.version);
    if (!migration) throw new Error(`Cannot roll back unknown Zhiban migration ${applied.version}`);
    assertKnownChecksums(new Map([[applied.version, applied.checksum]]), [migration]);

    await client.query('DELETE FROM zhiban.schema_migrations WHERE version = $1', [
      migration.version,
    ]);
    for (const statement of migration.down) await client.query(statement);
    return migration.version;
  });
}

export async function getZhibanMigrationStatus(
  pool: ZhibanDatabasePool,
): Promise<ZhibanMigrationStatus[]> {
  return inMigrationTransaction(pool, async (client) => {
    const applied = await readApplied(client);
    return ZHIBAN_MIGRATIONS.map((migration) => ({
      version: migration.version,
      description: migration.description,
      applied: applied.has(migration.version),
      checksumMatches:
        !applied.has(migration.version) || applied.get(migration.version) === migration.checksum,
    }));
  });
}
