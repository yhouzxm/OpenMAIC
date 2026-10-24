import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { createRequire } from 'node:module';
const { acquire } = createRequire(import.meta.url)(
  '../../docs/v2/candidates/m5-terminal/maintenance-lock.cjs',
) as {
  acquire(directory: string, mode: 'launcher'): { fd: number; release(): void };
};
import {
  directory,
  database,
  pgPort,
  pgBin,
  loadRuntime,
  privateFile,
  requirePrivateClusterDirectories,
} from './config';
import { loadMigrationFiles } from '@/lib/zhiban/infrastructure/identity/postgres/migrate';

async function main() {
  // Shared flock is held through child exit; exclusive maintenance cannot race launch.
  const maintenance = acquire(directory, 'launcher');
  process.once('exit', () => maintenance.release());
  await loadRuntime();
  await requirePrivateClusterDirectories();
  const data = join(directory, 'pgdata');
  // pg_ctl operates only this task's fixed, owned cluster; never the test cluster.
  try {
    execFileSync(join(pgBin, 'pg_ctl'), ['-D', data, 'status'], { stdio: 'pipe' });
  } catch {
    execFileSync(
      join(pgBin, 'pg_ctl'),
      ['-D', data, '-l', join(directory, 'postgres.log'), '-w', 'start'],
      { stdio: 'pipe' },
    );
  }
  const pool = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database,
    user: 'postgres',
    max: 1,
  });
  try {
    await pool.query('BEGIN READ ONLY');
    const identity = (
      await pool.query(
        "SELECT current_setting('data_directory') AS directory,current_setting('server_version_num')::integer AS version,current_database() AS database",
      )
    ).rows[0];
    if (
      identity.directory !== data ||
      identity.database !== database ||
      identity.version < 160000 ||
      identity.version > 169999
    )
      throw new Error('Local cluster identity rejected.');
    const rows = (
      await pool.query(
        'SELECT version,checksum FROM zhiban_identity.schema_migrations ORDER BY version',
      )
    ).rows;
    const files = await loadMigrationFiles();
    const receipt = JSON.parse((await privateFile('receipt.json')).toString());
    if (
      rows.length !== files.length ||
      receipt.migrations.length !== files.length ||
      rows.some(
        (row, i) =>
          row.version !== files[i].version ||
          row.checksum !== files[i].checksum ||
          row.checksum !== receipt.migrations[i].checksum ||
          row.version !== receipt.migrations[i].version,
      )
    )
      throw new Error('Migration ledger/source/receipt mismatch.');
    await pool.query('COMMIT');
  } finally {
    await pool.end();
  }
  // The maintenance connection is closed before the HTTPS process starts.
  let contentReady = false;
  try {
    await privateFile('content.json');
    contentReady = true;
  } catch (e) {
    if ((e as any).code !== 'ENOENT') throw e;
  }
  const child = spawn(
    process.execPath,
    contentReady
      ? [join(directory, 'm5-server.mjs')]
      : ['--import', 'tsx', resolve('scripts/zhiban-local/server.ts')],
    { stdio: ['inherit', 'inherit', 'inherit', maintenance.fd] },
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => {
    maintenance.release();
    process.exitCode = code ?? 1;
  });
}
void main().catch(() => {
  console.error(
    'Local M1 launch rejected; check private configuration, owned PG16 cluster and migration hashes.',
  );
  process.exitCode = 1;
});
