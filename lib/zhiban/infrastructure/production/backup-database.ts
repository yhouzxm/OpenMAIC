/** Owner capabilities are installation-only; no new grants or role edges. */
import { Pool, type PoolClient } from 'pg';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { connection, type ConnectionInput } from './connection';
import { check } from './files';
export const owners = {
  business: 'zhiban_identity_owner',
  content: 'zhiban_openmaic_owner',
  authoring: 'zhiban_authoring_owner',
} as const;
export const keys = ['business', 'content', 'authoring'] as const;
export type DatabaseKey = (typeof keys)[number];
export async function maintenancePool(input: ConnectionInput) {
  const p = new Pool({
    ...(await connection(input)),
    max: 1,
    idle_in_transaction_session_timeout: 0,
    statement_timeout: 120000,
    options: '-c search_path=pg_catalog -c timezone=UTC -c datestyle=ISO -c bytea_output=hex',
  });
  p.on('error', () => console.warn('MAINTENANCE_IDLE_CONNECTION_UNAVAILABLE'));
  return p;
}
const qi = (x: string) => '"' + x.replaceAll('"', '""') + '"';
export async function tables(c: PoolClient) {
  return (
    await c.query(
      "SELECT n.nspname AS schema,r.relname AS name FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND r.relkind IN('r','p') ORDER BY n.nspname,r.relname",
    )
  ).rows as { schema: string; name: string }[];
}
export async function lockWrites(c: PoolClient, _key: DatabaseKey) {
  await c.query('BEGIN');
  await c.query('SET LOCAL row_security=off');
  await c.query("SET LOCAL lock_timeout='10s'");
  const list = await tables(c);
  check(list.length > 0, 'BACKUP_EMPTY_DATABASE_REJECTED');
  await c.query(
    'LOCK TABLE ' + list.map((t) => qi(t.schema) + '.' + qi(t.name)).join(',') + ' IN SHARE MODE',
  );
  return list;
}
export async function dataInventory(c: PoolClient) {
  const out: Record<string, { rows: string; sha256: string }> = {};
  for (const t of await tables(c)) {
    const h = createHash('sha256');
    let count = 0;
    await c.query(
      `DECLARE inventory_cursor NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS value FROM ${qi(t.schema)}.${qi(t.name)} t ORDER BY (row_to_json(t)::text) COLLATE "C"`,
    );
    try {
      for (;;) {
        const r = await c.query('FETCH 200 FROM inventory_cursor');
        for (const v of r.rows) {
          h.update(v.value);
          h.update('\n');
          count++;
        }
        if (r.rows.length < 200) break;
      }
    } finally {
      await c.query('CLOSE inventory_cursor');
    }
    out[t.schema + '.' + t.name] = { rows: String(count), sha256: h.digest('hex') };
  }
  return out;
}
export async function pgTool(
  bin: string,
  tool: 'pg_dump' | 'pg_restore',
  input: ConnectionInput,
  key: DatabaseKey,
  file: string,
  signal: AbortSignal,
) {
  const opts = await connection(input),
    exe = join(bin, tool),
    exec = promisify(execFile);
  check(
    /^pg_(dump|restore) \(PostgreSQL\) 18\./.test(
      (await exec(exe, ['--version'], { encoding: 'utf8', timeout: 10000 })).stdout,
    ),
    'BACKUP_PG18_CLIENT_REQUIRED',
  );
  const args = [
    '--host',
    input.host,
    '--port',
    String(input.port),
    '--username',
    input.role,
    '--dbname',
    input.database,
    '--no-password',
    ...(input.role.startsWith('zhiban_') ? ['--role', owners[key]] : []),
    ...(tool === 'pg_dump'
      ? ['--format=custom', '--file', file]
      : [
          '--single-transaction',
          '--exit-on-error',
          '--data-only',
          '--disable-triggers',
          ...(input.role.startsWith('zhiban_') ? ['--no-owner'] : []),
          file,
        ]),
  ];
  try {
    await exec(exe, args, {
      encoding: 'utf8',
      signal,
      timeout: 1800000,
      maxBuffer: 1024 * 1024,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
        PGPASSWORD: String(opts.password),
        PGSSLMODE: input.transport === 'plain' ? 'disable' : 'verify-full',
        ...(input.caFile ? { PGSSLROOTCERT: input.caFile } : {}),
        PGCONNECT_TIMEOUT: '5',
        PGOPTIONS: '-c statement_timeout=0 -c lock_timeout=10000 -c search_path=pg_catalog',
      },
    });
  } catch {
    throw Error(tool === 'pg_dump' ? 'BACKUP_DUMP_FAILED' : 'RESTORE_DATABASE_FAILED');
  }
}
