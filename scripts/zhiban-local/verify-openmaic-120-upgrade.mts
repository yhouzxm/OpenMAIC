/** Owned, socket-only PG16. No development config or shared database inputs. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { DSL_VERSION } from '@openmaic/dsl';
import {
  ensureDocumentSchema,
  PgDocumentStore,
  splitSqlStatements,
} from '@openmaic/storage/document/pg';
import { DOCUMENT_PG_MIGRATIONS } from '@openmaic/storage/document/pg';
import { verifySchemaMigrations } from '@openmaic/storage/pg-migrations';
import {
  documentOwnership,
  ownershipSchema,
} from '../../lib/zhiban/infrastructure/openmaic/document-ownership';
import { verifyNativeSchemaState } from '../../lib/zhiban/infrastructure/openmaic/schema-state';
import {
  provisionRuntimeNative,
  verifyRuntimeProvisioning,
} from '../../lib/zhiban/infrastructure/openmaic/runtime/provision';
import { official } from '../../lib/zhiban/infrastructure/openmaic/catalog';

const bin = '/usr/lib/postgresql/16/bin';
const owned = await mkdtemp(join(tmpdir(), 'zhiban-upgrade-120-pg16-'));
const data = join(owned, 'data'),
  socket = join(owned, 'socket');
const port = 56531,
  database = 'zhiban_openmaic_120_contract';
const checks: string[] = [];
const pools: Pool[] = [];
const sourceHashes: Record<string, string> = {};
let pinned: PoolClient | undefined;
let started = false,
  failure: unknown;
const interrupted = () => {
  console.error('Owned upgrade verification interrupted; no PASS receipt issued');
  if (started) {
    try {
      execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], {
        stdio: 'pipe',
      });
    } catch {
      /* leave diagnostic root */
    }
  }
  process.exit(143);
};
process.once('SIGTERM', interrupted);
process.once('SIGINT', interrupted);
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const pool = (db = database) => {
  const p = new Pool({ host: socket, port, database: db, user: 'postgres', max: 2 });
  pools.push(p);
  return p;
};
const record = (s: string) => {
  checks.push(s);
  console.log('PASS ' + s);
};
try {
  await mkdir(socket, { mode: 0o700 });
  execFileSync(
    join(bin, 'initdb'),
    ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'],
    { stdio: 'pipe' },
  );
  execFileSync(
    join(bin, 'pg_ctl'),
    [
      '-D',
      data,
      '-l',
      join(owned, 'postgres.log'),
      '-o',
      `-p ${port} -k ${socket} -c listen_addresses=''`,
      '-w',
      'start',
    ],
    { stdio: 'pipe' },
  );
  started = true;
  const master = pool('postgres');
  assert.equal(
    Math.floor(
      Number((await master.query('SHOW server_version_num')).rows[0].server_version_num) / 10000,
    ),
    16,
  );
  await master.query(`CREATE DATABASE ${database}`);
  await master.query('CREATE ROLE zhiban_openmaic_runtime LOGIN NOINHERIT');
  const admin = await pool().connect();
  pinned = admin;
  const oldSource = execFileSync(
    'git',
    [
      'show',
      '1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce:packages/@openmaic/storage/src/document/pg.ts',
    ],
    { encoding: 'utf8' },
  );
  sourceHashes.oldDocumentProvider = hash(oldSource);
  const oldSchema = oldSource.match(/export const DOCUMENT_PG_SCHEMA = `([\s\S]*?)`;/)?.[1];
  assert.ok(oldSchema && !oldSchema.includes('${'));
  for (const sql of splitSqlStatements(oldSchema)) await admin.query(sql);
  const stage = { id: 'retained-stage', name: 'Retained 1.1.2', createdAt: 1000, updatedAt: 1000 };
  await admin.query(
    'INSERT INTO document_stages(id,name,created_at,updated_at,owner_id,data) VALUES($1,$2,1000,1000,$3,$4)',
    [stage.id, stage.name, 'opaque-owner-a', { ...stage, dslVersion: DSL_VERSION }],
  );
  await admin.query(
    "ALTER TABLE document_stages ALTER COLUMN owner_id SET NOT NULL, ALTER COLUMN owner_id SET DEFAULT 'opaque-owner-a'",
  );
  const before = (await admin.query('SELECT data FROM document_stages WHERE id=$1', [stage.id]))
    .rows[0].data;
  await ensureDocumentSchema(admin);
  await admin.query('BEGIN');
  await admin.query(ownershipSchema);
  await admin.query('COMMIT');
  assert.deepEqual(
    (await admin.query('SELECT data FROM document_stages WHERE id=$1', [stage.id])).rows[0].data,
    before,
  );
  assert.deepEqual((await admin.query('SELECT * FROM zhiban_document_ownership')).rows, [
    { stage_id: stage.id, owner_id: 'opaque-owner-a', lock_anchor: false },
  ]);
  const store = (owner: string) =>
    new PgDocumentStore(admin, {
      ownerId: owner,
      documentOwnership,
      withTransaction: async (body) => {
        const c = admin;
        try {
          await c.query('BEGIN');
          const r = await body(c);
          await c.query('COMMIT');
          return r;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      },
    });
  assert.ok(await store('opaque-owner-a').readFreshnessManifest(stage.id));
  assert.equal(await store('opaque-owner-b').readFreshnessManifest(stage.id), null);
  assert.equal((await store('opaque-owner-a').loadDocument(stage.id))?.stage.name, stage.name);
  await assert.rejects(
    store('opaque-owner-b').saveDocument({
      dslVersion: DSL_VERSION,
      stage: { ...stage, name: 'forged' },
      scenes: [],
    }),
  );
  record(
    'Exact v1.1.2 document DDL upgrades in place; retained JSON/owner unchanged; wrong owner manifest/write denied',
  );
  await admin.query('SET ROLE zhiban_openmaic_runtime');
  await admin.query('BEGIN');
  await admin.query('SELECT owner_id FROM zhiban_document_ownership WHERE stage_id=$1 FOR SHARE', [
    stage.id,
  ]);
  await admin.query('COMMIT');
  for (const sql of [
    "UPDATE zhiban_document_ownership SET owner_id='forged'",
    "UPDATE zhiban_document_ownership SET stage_id='forged'",
    'DELETE FROM zhiban_document_ownership',
    'UPDATE openmaic_schema_migrations SET version=99',
  ]) {
    await assert.rejects(
      admin.query(sql),
      (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '42501',
    );
  }
  await admin.query('RESET ROLE');
  record('Runtime FOR SHARE works; ownership keys, deletion and schema ledger mutations denied');
  await admin.query(
    "INSERT INTO document_stages(id,name,created_at,updated_at,data) VALUES('unowned','Unowned',1000,1000,$1)",
    [{ ...stage, id: 'unowned', dslVersion: DSL_VERSION }],
  );
  await assert.rejects(admin.query(ownershipSchema), /Native ownership backfill rejected/);
  await admin.query("DELETE FROM document_stages WHERE id='unowned'");
  await ensureDocumentSchema(admin);
  await verifySchemaMigrations(admin, [DOCUMENT_PG_MIGRATIONS]);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM openmaic_schema_migrations WHERE store='document'",
      )
    ).rows[0].n,
    2,
  );
  await admin.query(
    "UPDATE openmaic_schema_migrations SET version=99 WHERE store='document' AND version=2",
  );
  await assert.rejects(ensureDocumentSchema(admin));
  await admin.query(
    "UPDATE openmaic_schema_migrations SET version=2 WHERE store='document' AND version=99",
  );
  const checksum = (
    await admin.query(
      "SELECT checksum FROM openmaic_schema_migrations WHERE store='document' AND version=2",
    )
  ).rows[0].checksum;
  await admin.query(
    "UPDATE openmaic_schema_migrations SET checksum=$1 WHERE store='document' AND version=2",
    ['0'.repeat(64)],
  );
  await assert.rejects(ensureDocumentSchema(admin));
  await assert.rejects(verifyNativeSchemaState(admin, [DOCUMENT_PG_MIGRATIONS]));
  await admin.query(
    "UPDATE openmaic_schema_migrations SET checksum=$1 WHERE store='document' AND version=2",
    [checksum],
  );
  record(
    'Unowned legacy row rejected; repeat upgrade idempotent; ahead-version and checksum tampering refused',
  );
  await master.query('CREATE DATABASE zhiban_openmaic_120_runtime');
  execFileSync(
    join(bin, 'psql'),
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      socket,
      '-p',
      String(port),
      '-U',
      'postgres',
      '-d',
      'zhiban_openmaic_120_runtime',
      '-f',
      'lib/zhiban/infrastructure/openmaic/bootstrap-native-roles.pg16.sql',
    ],
    { stdio: 'pipe' },
  );
  const runtimeMaintenance = new Pool({
    host: socket,
    port,
    database: 'zhiban_openmaic_120_runtime',
    user: 'zhiban_openmaic_migrator',
    max: 1,
  });
  pools.push(runtimeMaintenance);
  const runtimeReceipt = await provisionRuntimeNative(
    runtimeMaintenance,
    'zhiban_openmaic_120_runtime',
    'LOCAL_UPGRADE',
  );
  assert.equal(
    (await verifyRuntimeProvisioning(runtimeMaintenance, runtimeReceipt)).status,
    'VERIFIED',
  );
  await assert.rejects(
    provisionRuntimeNative(runtimeMaintenance, 'zhiban_openmaic_120_runtime', 'LOCAL_REPEAT'),
  );
  record(
    'Runtime fresh installer/readonly receipt supports the versioned owner-only ledger; nonempty reinstall denied',
  );
  // Upstream TRUNCATE fixtures own their complete database. Keep the host's
  // retained ownership relation in its own DB so its FK cannot affect them.
  await master.query('CREATE DATABASE zhiban_openmaic_120_sdk_contract');
  // Run the upstream PG contract suite in a separate owned database.
  const url = `postgresql://postgres@localhost:${port}/zhiban_openmaic_120_sdk_contract?host=${encodeURIComponent(socket)}`;
  await new Promise<void>((resolveDone, reject) => {
    const child = spawn(
      'pnpm',
      [
        '--filter',
        '@openmaic/storage',
        'test',
        ...execFileSync('rg', ['--files', 'packages/@openmaic/storage/test'], { encoding: 'utf8' })
          .trim()
          .split('\n')
          .filter((path) => path.endsWith('.pg.test.ts'))
          .map((path) => path.replace('packages/@openmaic/storage/', '')),
        '--maxWorkers=1',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PG_CONTRACT_URL: url,
          STORAGE_PG_CONTRACT_REQUIRED: '1',
        },
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolveDone() : reject(Error(`Upstream PG suite exited ${code ?? signal}`)),
    );
  });
  record('Official required PG16 contract suite passed against owned socket-only cluster');
} catch (e) {
  failure = e;
  console.error(e);
} finally {
  pinned?.release(true);
  for (const p of pools) await p.end().catch(() => {});
  if (started)
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  for (const path of [
    'lib/zhiban/infrastructure/openmaic/document-ownership.ts',
    'lib/zhiban/infrastructure/openmaic/provision.ts',
    'lib/zhiban/infrastructure/openmaic/schema-state.ts',
    'lib/zhiban/infrastructure/openmaic/runtime/provision.ts',
    'lib/zhiban/infrastructure/identity/postgres/migrations/0014_openmaic_120_versions.sql',
    'packages/@openmaic/storage/src/document/pg.ts',
    'packages/@openmaic/storage/src/pg-migrations.ts',
    'scripts/zhiban-local/verify-openmaic-120-upgrade.mts',
    'pnpm-lock.yaml',
  ])
    sourceHashes[path] = hash(await readFile(path));
  sourceHashes.executedVerifierArtifact = hash(await readFile(process.argv[1]));
  if (!failure) await rm(owned, { recursive: true });
  await writeFile(
    resolve('docs/v2/evidence/zhiban-openmaic-120-upgrade-pg16-local.json'),
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: failure ? 'FAIL' : 'PASS',
        at: new Date().toISOString(),
        provider: official,
        node: process.version,
        checks,
        sourceHashes,
        lifecycle: {
          root: owned,
          port,
          database,
          socketOnly: true,
          stopped: true,
          removed: !failure,
        },
        failure: failure instanceof Error ? failure.message : null,
        excluded: [
          'real 55432/55433',
          'production data upgrade or rollback',
          'real Native maintenance delivery',
          'AI generation/provider calls',
          'CI signoff',
        ],
      },
      null,
      2,
    ) + '\n',
  );
}
if (failure) process.exitCode = 1;
