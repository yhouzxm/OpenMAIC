import { Pool } from 'pg';
import { applyMigrations, loadMigrationFiles } from './migrate';

async function main(): Promise<void> {
  const connectionString = process.env.ZHIBAN_IDENTITY_MIGRATOR_DATABASE_URL;
  if (!connectionString) throw new Error('Dedicated Identity migrator connection is required.');
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const client = await pool.connect();
    let reusable = true;
    try {
      const applied = await applyMigrations(
        {
          query: async (sql, parameters) => {
            const result = await client.query(sql, parameters ? [...parameters] : undefined);
            return {
              rows: Array.isArray(result) ? [] : (result.rows as Record<string, unknown>[]),
            };
          },
        },
        await loadMigrationFiles(),
      );
      process.stdout.write(
        `Identity migration versions applied: ${applied.join(', ') || 'none'}\n`,
      );
    } catch (error) {
      reusable = false;
      if (error instanceof Error && error.message.startsWith('Identity migration ')) {
        throw error;
      }
      throw new Error('Identity migration failed; inspect the dedicated maintenance logs.');
    } finally {
      client.release(!reusable);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof Error ? `${error.message}\n` : 'Identity migration failed.\n',
  );
  process.exitCode = 1;
});
