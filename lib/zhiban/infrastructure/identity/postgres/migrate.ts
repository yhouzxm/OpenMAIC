import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationConnection {
  query(sql: string, parameters?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const migrationDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));
const migrationName = /^(\d{4})_([a-z][a-z0-9_]*)\.sql$/;

/** Checks ordering and uniqueness before any connection is used. */
export function planMigrations(files: readonly { name: string; sql: string }[]): MigrationFile[] {
  const seen = new Set<string>();
  const plan = files.map(({ name, sql }) => {
    const match = migrationName.exec(name);
    if (!match || !sql.trim()) throw new Error('Invalid or empty Identity migration file.');
    const version = match[1];
    if (seen.has(version)) throw new Error(`Duplicate Identity migration version: ${version}`);
    seen.add(version);
    return {
      version,
      name,
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    };
  });
  plan.sort((a, b) => a.version.localeCompare(b.version));
  if (plan[0]?.version !== '0001') throw new Error('Identity migration 0001 is required.');
  for (let index = 0; index < plan.length; index += 1) {
    if (plan[index].version !== String(index + 1).padStart(4, '0')) {
      throw new Error('Identity migration versions must be contiguous.');
    }
  }
  return plan;
}

export async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const names = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql'));
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8'),
    })),
  );
  return planMigrations(files);
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Unexpected Identity migration metadata.');
  return value;
}

/**
 * Explicit maintenance-only runner. One connection owns a session advisory lock;
 * each migration and its ledger row commit in one transaction. Never call on web startup.
 */
export async function applyMigrations(
  connection: MigrationConnection,
  migrations: readonly MigrationFile[],
): Promise<readonly string[]> {
  if (migrations[0]?.version !== '0001') throw new Error('Identity migration 0001 is required.');
  const identity = await connection.query('SELECT session_user AS session_user');
  if (identity.rows[0]?.session_user !== 'zhiban_migrator') {
    throw new Error('Identity migrations require the dedicated zhiban_migrator login.');
  }

  await connection.query('SET ROLE zhiban_identity_owner');
  let locked = false;
  try {
    await connection.query('SELECT pg_advisory_lock(20260925, 10001)');
    locked = true;
    const presence = await connection.query(
      "SELECT to_regnamespace('zhiban_identity')::text AS schema_name, " +
        "to_regclass('zhiban_identity.schema_migrations')::text AS ledger_name",
    );
    const schemaExists = typeof presence.rows[0]?.schema_name === 'string';
    const ledgerExists = typeof presence.rows[0]?.ledger_name === 'string';
    if (schemaExists !== ledgerExists) throw new Error('Identity schema/ledger drift detected.');
    const applied = new Map<string, string>();
    if (ledgerExists) {
      const stored = await connection.query(
        'SELECT version, checksum FROM zhiban_identity.schema_migrations ORDER BY version',
      );
      for (const row of stored.rows) applied.set(text(row.version), text(row.checksum));
      if (!applied.has('0001')) throw new Error('Identity bootstrap ledger entry is missing.');
      for (const version of applied.keys()) {
        if (!migrations.some((migration) => migration.version === version)) {
          throw new Error(`Unknown applied Identity migration: ${version}`);
        }
      }
      for (let index = 0; index < applied.size; index += 1) {
        if (!applied.has(migrations[index]?.version)) {
          throw new Error('Identity migration ledger has a version gap.');
        }
      }
      for (const migration of migrations) {
        const oldChecksum = applied.get(migration.version);
        if (oldChecksum !== undefined && oldChecksum !== migration.checksum) {
          throw new Error(`Identity migration checksum drift: ${migration.version}`);
        }
      }
    }

    const completed: string[] = [];
    for (const migration of migrations) {
      const oldChecksum = applied.get(migration.version);
      if (oldChecksum !== undefined) {
        continue;
      }
      await connection.query('BEGIN');
      try {
        // pg's simple-query path executes the entire file; never split on semicolons.
        await connection.query(migration.sql);
        await connection.query(
          'INSERT INTO zhiban_identity.schema_migrations (version, checksum) VALUES ($1, $2)',
          [migration.version, migration.checksum],
        );
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      }
      completed.push(migration.version);
      applied.set(migration.version, migration.checksum);
    }
    return completed;
  } finally {
    if (locked) await connection.query('SELECT pg_advisory_unlock(20260925, 10001)');
    await connection.query('RESET ROLE');
  }
}
