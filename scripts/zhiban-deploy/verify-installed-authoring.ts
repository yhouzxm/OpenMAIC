/** Real disposable PG18: installed schema boots without runtime ownership or DDL. */
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { installAuthoringSchema } from '@/lib/zhiban/infrastructure/production/authoring-schema';
import {
  configureInstalledSchema,
  verifyInstalledSchema,
} from '@/lib/persistence/installed-schema';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { ensureGenerationRunSchema } from '@/lib/persistence/generation-runs';
async function main() {
  const bin = process.env.ZHIBAN_PG18_BIN || '/usr/lib/postgresql/18/bin';
  const root = await mkdtemp(join(tmpdir(), 'zhiban-installed-authoring-')),
    socket = join(root, 'socket'),
    data = join(root, 'data');
  const pools: Pool[] = [];
  let started = false;
  const run = (name: string, args: string[]) =>
    execFileSync(join(bin, name), args, { stdio: 'pipe' });
  const pool = (user: string, database = 'zhiban_install_authoring') => {
    const p = new Pool({
      host: socket,
      port: 56551,
      user,
      database,
      max: 2,
      connectionTimeoutMillis: 3000,
    });
    pools.push(p);
    return p;
  };
  try {
    await mkdir(socket, { mode: 0o700 });
    run('initdb', [
      '-D',
      data,
      '-U',
      'postgres',
      '--auth-local=trust',
      '--auth-host=reject',
      '--no-locale',
      '--encoding=UTF8',
    ]);
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      join(root, 'pg.log'),
      '-o',
      `-p 56551 -k ${socket} -c listen_addresses=''`,
      '-w',
      'start',
    ]);
    started = true;
    const admin = pool('postgres', 'postgres');
    await admin.query('CREATE DATABASE zhiban_authoring_reference');
    await pool('postgres', 'zhiban_authoring_reference').query(
      await readFile('lib/zhiban/infrastructure/production/authoring-roles.sql', 'utf8'),
    );
    const source = await pool('zhiban_authoring_migrator', 'zhiban_authoring_reference').connect();
    let expected;
    try {
      await source.query('SET ROLE zhiban_authoring_owner');
      await source.query('SET search_path=public,pg_catalog');
      expected = await installAuthoringSchema(source);
    } finally {
      source.release(true);
    }
    await admin.query('CREATE DATABASE zhiban_install_authoring');
    const a = pool('postgres');
    await a.query(
      await readFile('lib/zhiban/infrastructure/production/authoring-roles.sql', 'utf8'),
    );
    const c = await pool('zhiban_authoring_migrator').connect();
    let observed;
    try {
      await c.query('SET ROLE zhiban_authoring_owner');
      await c.query('SET search_path=public,pg_catalog');
      observed = await installAuthoringSchema(c);
    } finally {
      c.release(true);
    }
    // Source-only reference is captured before target construction, in another database.
    // The declared target name is configuration, never an observed target catalog value.
    const approved = { ...expected, database: 'zhiban_install_authoring' };
    assert.deepEqual(observed, approved);
    configureInstalledSchema(approved);
    const runtime = pool('zhiban_authoring_runtime');
    assert.equal(await verifyInstalledSchema(runtime), true);
    await assert.rejects(
      runtime.query('CREATE TABLE public.forbidden(id int)'),
      (e) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      runtime.query('UPDATE public.openmaic_schema_migrations SET name=name'),
      (e) => (e as { code: string }).code === '42501',
    );
    const url = `postgresql:///zhiban_install_authoring?host=${encodeURIComponent(socket)}&port=56551&user=zhiban_authoring_runtime`;
    const provider = await getServerPersistenceProvider(url);
    pools.push(provider.pool);
    await ensureGenerationRunSchema(provider.pool);
    await assert.rejects(verifyInstalledSchema(a), /runtime endpoint rejected/);
    await a.query('GRANT TEMP ON DATABASE zhiban_install_authoring TO zhiban_authoring_runtime');
    await assert.rejects(verifyInstalledSchema(runtime), /runtime endpoint rejected/);
    await a.query('REVOKE TEMP ON DATABASE zhiban_install_authoring FROM zhiban_authoring_runtime');
    assert.equal(await verifyInstalledSchema(runtime), true);
    await a.query('SET ROLE zhiban_authoring_owner');
    await a.query(
      "UPDATE public.openmaic_schema_migrations SET checksum=repeat('0',64) WHERE store='runtime'",
    );
    await assert.rejects(verifyInstalledSchema(runtime), /ledger rejected/);
    console.log(
      'PASS real PG18 installed authoring provider; no runtime DDL, ledger writes, privileged endpoint, TEMP elevation or ledger drift accepted',
    );
  } finally {
    for (const p of pools) await p.end();
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
