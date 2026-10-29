/** Copy-only, socket-only PG16 upgrade. No DSN, original pointer replacement, old receipt relabeling or live target. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Pool } from 'pg';
import { ensureAssetSchema } from '@openmaic/storage/asset/pg';
import { ensureDocumentSchema } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, verifySchemaMigrations } from '@openmaic/storage/pg-migrations';
import { APP_SCHEMA_STORES } from '../../lib/persistence/schema-stores';
import { getServerPersistenceProvider } from '../../lib/persistence/server-provider';
import {
  configureMaterialByteStore,
  LocalMaterialByteStore,
} from '../../lib/server/materials/bytes';
import { upgradeMaterialPointers130 } from './material-upgrade-130';
import { catalogFingerprint, official } from '../../lib/zhiban/infrastructure/openmaic/catalog';
import {
  expectedSchemaState,
  verifyNativeSchemaState,
} from '../../lib/zhiban/infrastructure/openmaic/schema-state';
import { contentProfile } from '../zhiban-local/content-profile';
import { privateEntry, saveSnapshot, snapshotHome } from '../zhiban-local/persistent-snapshot';
import { issueUpgradedContent130 } from '../zhiban-local/trial-content';
import { privateFile } from '../zhiban-local/config';
const portable = createRequire(import.meta.url)(resolve('scripts/zhiban-portable.cjs'));
const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const bin = '/usr/lib/postgresql/16/bin';
const business = 'zhiban_trial_content_disposable',
  nativeDb = 'zhiban_trial_content_native',
  lessonDb = 'zhiban_trial_lesson_native';
type Table = { schema: string; name: string; columns: string[]; count: number; digest: string };
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
async function facts(p: Pool, previous?: Table[]): Promise<Table[]> {
  const tables =
    previous ??
    (
      await p.query(
        "SELECT schemaname AS schema,tablename AS name FROM pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' ORDER BY 1,2",
      )
    ).rows;
  const out: Table[] = [];
  for (const t of tables) {
    if (t.name.endsWith('schema_migrations')) continue;
    const columns: string[] =
      t.columns ??
      (
        await p.query(
          'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
          [t.schema, t.name],
        )
      ).rows
        .map((r) => r.column_name)
        .filter(
          (n) =>
            !(
              t.schema === 'public' &&
              t.name === 'owner_material' &&
              ['asset_id', 'oss_key'].includes(n)
            ),
        );
    const where =
      t.schema === 'zhiban_bridge' && t.name === 'deployment_registry'
        ? " WHERE deployment_ref <> 'LOCAL_OFFLINE_OPENMAIC_130'"
        : '';
    const rows = (
      await p.query(
        `SELECT row_to_json(v)::text AS v FROM (SELECT ${columns.map(quote).join(',')} FROM ${quote(t.schema)}.${quote(t.name)}${where}) v ORDER BY 1`,
      )
    ).rows;
    out.push({
      schema: t.schema,
      name: t.name,
      columns,
      count: rows.length,
      digest: hash(JSON.stringify(rows)),
    });
  }
  return out;
}
async function nativeUpgrade(p: Pool, expectedBefore: string) {
  const c = await p.connect();
  try {
    assert.equal((await c.query('SELECT pg_try_advisory_lock(12061017) AS ok')).rows[0].ok, true);
    await c.query('SET ROLE zhiban_openmaic_owner');
    await c.query('SET search_path=pg_catalog,public,pg_temp');
    assert.equal(
      await catalogFingerprint(c, 'public'),
      expectedBefore,
      'Historical Native profile drift',
    );
    await c.query('SET ROLE zhiban_openmaic_owner');
    await c.query('SET search_path=public,pg_catalog,pg_temp');
    const ledger = (
      await c.query(
        'SELECT store,version,name,checksum FROM openmaic_schema_migrations ORDER BY store,version',
      )
    ).rows;
    const expected = await expectedSchemaState();
    assert.deepEqual(
      ledger,
      expected.filter((row) => !(row.store === 'asset' && row.version === 2)),
      'Historical Native ledger must be exact',
    );
    for (const row of ledger)
      assert.deepEqual(
        row,
        expected.find((v) => v.store === row.store && v.version === row.version),
        'Applied Native migration mismatch',
      );
    await c.query('SET ROLE zhiban_openmaic_owner');
    await c.query('SET search_path=public,pg_catalog,pg_temp');
    await ensureAssetSchema(c);
    await ensureDocumentSchema(c);
    await c.query('GRANT SELECT ON asset_root_refs TO zhiban_openmaic_runtime');
    await c.query(
      'GRANT UPDATE(rule_version) ON asset_reference_tracking TO zhiban_openmaic_runtime',
    );
    await verifyNativeSchemaState(c);
  } finally {
    c.release(true);
  }
}
async function businessUpgrade(p: Pool) {
  for (const ctx of (await readdir('lib/zhiban/infrastructure', { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)) {
    const dir = `lib/zhiban/infrastructure/${ctx}/postgres/migrations`;
    if (!(await lstat(dir).catch(() => null))?.isDirectory()) continue;
    const schema = 'zhiban_' + ctx.replaceAll('-', '_');
    const c = await p.connect();
    try {
      const rows = (
        await c.query(
          `SELECT version,checksum FROM ${quote(schema)}.schema_migrations ORDER BY version`,
        )
      ).rows;
      const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
      assert.ok(
        rows.every((row) => files.some((f) => f.slice(0, 4) === row.version)),
        'Unknown applied business migration: ' + ctx,
      );
      for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
        const sql = await readFile(join(dir, f)),
          version = f.slice(0, 4),
          old = rows.find((r) => r.version === version);
        if (old) {
          assert.equal(old.checksum, hash(sql), 'Applied business SQL changed: ' + ctx + '/' + f);
          continue;
        }
        assert.equal(
          ctx + '/' + f,
          'identity/0015_openmaic_130_versions.sql',
          'Unexpected pending business migration',
        );
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE zhiban_identity_owner');
        await c.query(sql.toString());
        await c.query(`INSERT INTO ${quote(schema)}.schema_migrations VALUES($1,$2)`, [
          version,
          hash(sql),
        ]);
        await c.query('COMMIT');
      }
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}
async function main() {
  for (const key of [
    'DATABASE_URL',
    'PGHOST',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGPASSFILE',
    'PGSERVICE',
    'PGOPTIONS',
    'ZHIBAN_LOCAL_PG_PROFILE',
  ])
    assert.ok(!process.env[key], 'Offline copy refuses external database overrides');
  const raw = process.argv.slice(2).filter((v) => v !== '--unified-trial');
  const faults = raw.filter((v) => v.startsWith('--fault='));
  assert.ok(
    faults.length <= 1 &&
      faults.every((v) =>
        [
          '--fault=AFTER_COPY',
          '--fault=AFTER_NATIVE',
          '--fault=BEFORE_SNAPSHOT',
          '--fault=AFTER_SNAPSHOT',
        ].includes(v),
      ),
    'Unsupported fault cut',
  );
  const args = raw.filter((v) => !v.startsWith('--fault='));
  if (args.length !== 4 || !['inspect', 'upgrade'].includes(args[0]))
    throw Error('Use inspect|upgrade SNAPSHOT MANIFEST_SHA256 OUTPUT_STATE');
  const [action, source, pin, output] = args;
  assert.ok(isAbsolute(source) && resolve(source) === source);
  assert.ok(isAbsolute(output) && resolve(output) === output && output !== '/');
  assert.equal(
    process.env.ZHIBAN_LOCAL_STATE,
    output,
    'Explicit isolated ZHIBAN_LOCAL_STATE must equal OUTPUT_STATE',
  );
  assert.equal(snapshotHome, join(output, 'snapshots'));
  portable.ancestors(output);
  portable.ancestors(source);
  const m = portable.validateSnapshot(source, pin);
  for (const other of [source, m.originalRoot])
    assert.ok(
      output !== other && !output.startsWith(other + '/') && !other.startsWith(output + '/'),
      'Source/output paths must be disjoint',
    );
  assert.equal(
    m.metadata?.contentInstallation?.provider?.storage,
    '0.37.3',
    'Only pinned pre-v1.3.0 snapshots are accepted',
  );
  const previous = JSON.parse(
    await readFile(join(source, 'root/content-installation.json'), 'utf8'),
  );
  const historical = JSON.parse(
    await readFile('docs/v2/evidence/m5-png-profile-reference-teacher-local.json', 'utf8'),
  );
  assert.equal(
    previous.nativeFingerprint,
    historical.nativeFingerprint,
    'Prior independently constructed Native reference required',
  );
  assert.equal(previous.profile, m.metadata.contentInstallation.profile);
  assert.deepEqual(previous, m.metadata.contentInstallation, 'Snapshot/receipt metadata mismatch');
  assert.deepEqual(previous.provider, historical.provider, 'Historical provider tuple mismatch');
  assert.equal(previous.origin, 'https://127.0.0.1:3461');
  assert.equal(previous.certificateHash, hash(await privateFile('localhost.crt')));
  assert.equal(
    await lstat(m.originalRoot).catch(() => null),
    null,
    'Original bound working root exists; stop/remove it through its own lifecycle first',
  );
  const summary = {
    kind: 'LOCAL_OPENMAIC_130_COPY_UPGRADE_V1',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    sourceManifestSha256: pin,
    sourceSnapshot: source,
    originalPointerChanged: false,
    sourceMutated: false,
    outputState: output,
    workingRoot: m.originalRoot,
    official,
  };
  if (action === 'inspect') {
    console.log(JSON.stringify({ ...summary, status: 'PLAN', executesDdl: false }));
    return;
  }
  assert.equal(await lstat(output).catch(() => null), null, 'Output exists; refusing overwrite');
  await mkdir(output, { mode: 0o700 });
  await privateEntry(output, true);
  await writeFile(
    join(output, 'UPGRADING.json'),
    JSON.stringify({ ...summary, pid: process.pid }),
    { mode: 0o600, flag: 'wx' },
  );
  const lock = join(dirname(source), '.operation-lock');
  await mkdir(lock, { mode: 0o700 });
  let started = false,
    copied = false,
    complete = false;
  let aborted = false;
  const interrupt = () => {
    aborted = true;
  };
  process.once('SIGTERM', interrupt);
  process.once('SIGINT', interrupt);
  const checkpoint = async (phase: string) => {
    await writeFile(
      join(output, 'PHASE.json'),
      JSON.stringify({ phase, evidenceOrigin: 'LOCAL', at: new Date().toISOString() }),
      { mode: 0o600 },
    );
    assert.ok(!aborted, 'Upgrade interrupted; no snapshot selected');
    if (faults[0] === '--fault=' + phase) throw Error('Injected owned-copy cut: ' + phase);
  };
  const pools: Pool[] = [];
  const pool = (user = 'postgres', db = business) => {
    const p = new Pool({
      host: join(m.originalRoot, 'socket'),
      port: 56517,
      user,
      database: db,
      max: 1,
      connectionTimeoutMillis: 3000,
    });
    pools.push(p);
    return p;
  };
  try {
    portable.validateSnapshot(source, pin);
    await mkdir(m.originalRoot, { mode: 0o700 });
    copied = true;
    for (const name of await readdir(join(source, 'root')))
      await cp(join(source, 'root', name), join(m.originalRoot, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: false,
      });
    await mkdir(join(m.originalRoot, 'socket'), { mode: 0o700 });
    await checkpoint('AFTER_COPY');
    assert.equal(
      await lstat(join(m.originalRoot, 'data/postmaster.pid')).catch(() => null),
      null,
      'Stopped backup required',
    );
    execFileSync(
      join(bin, 'pg_ctl'),
      [
        '-D',
        join(m.originalRoot, 'data'),
        '-l',
        join(m.originalRoot, 'postgres.log'),
        '-o',
        `-p 56517 -k ${m.originalRoot}/socket -c listen_addresses=''`,
        '-w',
        'start',
      ],
      { stdio: 'pipe' },
    );
    started = true;
    const master = pool('postgres', 'postgres');
    const identity = (
      await master.query(
        "SELECT current_setting('data_directory') AS dir,current_setting('listen_addresses') AS tcp,current_setting('server_version_num')::int AS v",
      )
    ).rows[0];
    assert.equal(identity.dir, join(m.originalRoot, 'data'));
    assert.equal(identity.tcp, '');
    assert.ok(identity.v >= 160000 && identity.v < 170000);
    assert.equal(
      Number(
        (
          await master.query(
            "SELECT count(*) AS n FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()",
          )
        ).rows[0].n,
      ),
      0,
      'Unexpected writer on isolated clone',
    );
    const before: Record<string, Table[]> = {};
    for (const db of [business, nativeDb, lessonDb]) before[db] = await facts(pool('postgres', db));
    const accountHash = hash(await readFile(join(m.originalRoot, 'accounts.json')));
    assert.equal(
      (await contentProfile(pool())).fingerprint,
      previous.profile,
      'Historical business profile drift',
    );
    await businessUpgrade(pool());
    await nativeUpgrade(pool('zhiban_openmaic_migrator', nativeDb), previous.nativeFingerprint);
    await checkpoint('AFTER_NATIVE');
    const lesson = pool('zhiban_lesson_runtime', lessonDb),
      client = await lesson.connect();
    try {
      await client.query('SET search_path=public,pg_catalog,pg_temp');
      await verifySchemaMigrations(client, APP_SCHEMA_STORES);
      for (const set of APP_SCHEMA_STORES) await applySchemaMigrations(client, set);
      await verifySchemaMigrations(client, APP_SCHEMA_STORES);
    } finally {
      client.release();
    }
    const url = `postgresql:///${lessonDb}?host=${encodeURIComponent(join(m.originalRoot, 'socket'))}&port=56517&user=zhiban_lesson_runtime`;
    process.env.DATABASE_URL = url;
    const provider = await getServerPersistenceProvider(url);
    pools.push(provider.pool);
    configureMaterialByteStore(
      new LocalMaterialByteStore(join(m.originalRoot, 'native-materials')),
    );
    const materialReport = await upgradeMaterialPointers130(provider);
    const current = await issueUpgradedContent130({
      owned: m.originalRoot,
      socket: join(m.originalRoot, 'socket'),
      pool,
      certificateHash: previous.certificateHash,
      snapshotManifestSha256: pin,
    });
    for (const db of [business, nativeDb, lessonDb])
      assert.deepEqual(
        await facts(pool('postgres', db), before[db]),
        before[db],
        'Existing data changed: ' + db,
      );
    assert.equal(hash(await readFile(join(m.originalRoot, 'accounts.json'))), accountHash);
    for (const p of pools) await p.end();
    pools.length = 0;
    execFileSync(
      join(bin, 'pg_ctl'),
      ['-D', join(m.originalRoot, 'data'), '-m', 'fast', '-w', 'stop'],
      { stdio: 'pipe' },
    );
    started = false;
    const metadata = {
      ...m.metadata,
      contentInstallation: current,
      applicationVersion: '1.3.0',
      offlineUpgrade: { ...summary, materialReport, accountsSha256: accountHash },
    };
    await checkpoint('BEFORE_SNAPSHOT');
    const snapshot = await saveSnapshot(m.originalRoot, false, metadata);
    await checkpoint('AFTER_SNAPSHOT');
    portable.validateSnapshot(source, pin);
    await writeFile(
      join(output, 'UPGRADE.json'),
      JSON.stringify(
        {
          ...summary,
          status: 'MIGRATED_COPY',
          snapshot,
          materialReport,
          accountsSha256: accountHash,
          dataPreserved: true,
          historicalDeploymentsPreserved: true,
          previousReceiptSha256: hash(
            await readFile(join(source, 'root/content-installation.json')),
          ),
          newDeploymentId: current.deploymentId,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    complete = true;
    await rm(join(output, 'UPGRADING.json'));
    console.log(JSON.stringify({ ...summary, status: 'MIGRATED_COPY', snapshot, materialReport }));
  } finally {
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGINT', interrupt);
    for (const p of pools) await p.end().catch(() => {});
    if (started)
      execFileSync(
        join(bin, 'pg_ctl'),
        ['-D', join(m.originalRoot, 'data'), '-m', 'fast', '-w', 'stop'],
        { stdio: 'pipe' },
      );
    if (copied) await rm(m.originalRoot, { recursive: true, force: true });
    if (!complete) await rm(join(snapshotHome, 'latest.json'), { force: true });
    if (!complete)
      await writeFile(
        join(output, 'FAILED.json'),
        JSON.stringify({ ...summary, status: 'FAILED_NO_POINTER_SWITCH' }),
        { mode: 0o600 },
      );
    await rm(lock, { recursive: true });
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Offline upgrade refused');
  process.exitCode = 1;
});
