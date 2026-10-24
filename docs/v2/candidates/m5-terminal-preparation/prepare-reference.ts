// Explicit disposable preparation. Never reads a DSN, existing data or private keys.
import { Client, Pool } from 'pg';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  official,
  catalogFingerprint,
} from '../../../../lib/zhiban/infrastructure/openmaic/catalog';
import terminal from '../m5-terminal/terminal-installation.cjs';
import { adoptTechnicalBroker } from './technical-broker.cjs';

const root = path.resolve(__dirname, '../../../..');
const candidate = path.resolve(__dirname, '../m5-terminal');
const bin = '/usr/lib/postgresql/16/bin';
const port = 56492;
const indexSql = `SELECT jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) ORDER BY c.relname) indexes FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relnamespace='public'::regnamespace`;
const checks: { name: string; status: string }[] = [];
const passed = (name: string) => {
  checks.push({ name, status: 'PASS' });
  console.log('PASS', name);
};
function sourceBindings() {
  const files = execFileSync(
    'rg',
    [
      '--files',
      'packages/@openmaic/storage/src',
      'packages/@openmaic/storage/dist',
      'packages/@openmaic/dsl/src',
      'packages/@openmaic/dsl/dist',
      'lib/zhiban/infrastructure/openmaic',
      'lib/zhiban/infrastructure/identity/postgres',
      'lib/zhiban/application/identity/ports',
      'lib/zhiban/domain/identity',
      'docs/v2/candidates/m5-terminal-preparation',
    ],
    { cwd: root, encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  files.push(
    'pnpm-lock.yaml',
    'package.json',
    'tsconfig.json',
    'packages/@openmaic/storage/package.json',
    'packages/@openmaic/dsl/package.json',
  );
  return Object.fromEntries(
    [...new Set(files)]
      .sort()
      .map((name) => [name, terminal.sha(fs.readFileSync(path.join(root, name)))]),
  );
}
async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--output-dir')
    throw Error('Use --output-dir NEW_DIRECTORY');
  const output = path.resolve(process.argv[3]);
  // Prevent accidental overwrite of a prior reference or evidence.
  fs.mkdirSync(output, { mode: 0o700 });
  const sources = terminal.sources();
  const bindings = sourceBindings();
  execFileSync(
    'git',
    [
      'diff',
      '--quiet',
      official.sha,
      '--',
      'packages/@openmaic/storage/src',
      'packages/@openmaic/storage/package.json',
      'packages/@openmaic/dsl/src',
      'packages/@openmaic/dsl/package.json',
    ],
    { cwd: root, stdio: 'pipe' },
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-native-reference-'));
  fs.chmodSync(dir, 0o700);
  const data = path.join(dir, 'data'),
    socket = path.join(dir, 'socket');
  const clients: Client[] = [];
  let pool: Pool | undefined;
  let draft: any;
  let observations: any;
  fs.mkdirSync(socket, { mode: 0o700 });
  const connect = async (database: string) => {
    const c = new Client({
      host: socket,
      port,
      user: 'postgres',
      database,
      connectionTimeoutMillis: 3000,
      query_timeout: 10000,
    });
    await c.connect();
    clients.push(c);
    return c;
  };
  const psql = (database: string, relative: string) =>
    execFileSync(
      path.join(bin, 'psql'),
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
        database,
        '-f',
        path.join(root, relative),
      ],
      {
        stdio: 'pipe',
        env: {
          ...process.env,
          PGPASSFILE: '/dev/null',
          PGSERVICEFILE: '/dev/null',
          PSQLRC: '/dev/null',
        },
      },
    );
  try {
    const { build } = createRequire(require.resolve('tsx'))('esbuild');
    const provisionBundle = path.join(dir, 'provision.cjs');
    const built = await build({
      entryPoints: [path.join(root, 'lib/zhiban/infrastructure/openmaic/provision.ts')],
      outfile: provisionBundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      metafile: true,
      logLevel: 'silent',
    });
    const { provisionNative } = require(provisionBundle);
    const buildInputs = Object.fromEntries(
      Object.keys(built.metafile.inputs)
        .sort()
        .map((name) => [name, terminal.sha(fs.readFileSync(path.resolve(root, name)))]),
    );
    execFileSync(
      path.join(bin, 'initdb'),
      [
        '-D',
        data,
        '-U',
        'postgres',
        '--auth-local=trust',
        '--auth-host=reject',
        '--no-locale',
        '--encoding=UTF8',
      ],
      { stdio: 'ignore' },
    );
    execFileSync(
      path.join(bin, 'pg_ctl'),
      [
        '-D',
        data,
        '-l',
        path.join(dir, 'server.log'),
        '-o',
        `-c listen_addresses='' -c unix_socket_directories='${socket}' -c port=${port} -c max_prepared_transactions=0`,
        '-w',
        'start',
      ],
      { stdio: 'ignore' },
    );
    const admin = await connect('postgres');
    await admin.query('CREATE DATABASE zhiban_m1_dev');
    await admin.query('CREATE DATABASE zhiban_m5_native');
    psql('zhiban_m1_dev', 'lib/zhiban/infrastructure/identity/postgres/bootstrap-roles.pg16.sql');
    psql(
      'zhiban_m1_dev',
      'lib/zhiban/infrastructure/identity/postgres/bootstrap-bridge-roles.pg16.sql',
    );
    await admin.query('CREATE ROLE zhiban_academic_runtime NOLOGIN NOINHERIT');
    await admin.query('GRANT CONNECT ON DATABASE zhiban_m1_dev TO zhiban_academic_runtime');
    psql('zhiban_m5_native', 'lib/zhiban/infrastructure/openmaic/bootstrap-native-roles.pg16.sql');
    const business = await connect('zhiban_m1_dev'),
      native = await connect('zhiban_m5_native');
    await business.query('SET ROLE zhiban_identity_owner');
    for (const group of ['identity', 'academic', 'learning', 'assessment']) {
      const folder = path.join(root, `lib/zhiban/infrastructure/${group}/postgres/migrations`);
      for (const name of fs
        .readdirSync(folder)
        .filter((n) => n.endsWith('.sql'))
        .sort()) {
        const sql = fs.readFileSync(path.join(folder, name), 'utf8');
        await business.query(sql);
        await business.query(
          `INSERT INTO zhiban_${group}.schema_migrations(version,checksum) VALUES($1,$2)`,
          [name.slice(0, 4), terminal.sha(sql)],
        );
      }
    }
    await business.query('BEGIN');
    for (const name of ['01-schema.sql', '02-helpers-and-guards.sql', '03-acl.sql'])
      await business.query(fs.readFileSync(path.resolve(candidate, '../m5-content', name), 'utf8'));
    await business.query(
      "INSERT INTO zhiban_content.schema_migrations VALUES('0001','e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324')",
    );
    await business.query('COMMIT');
    await business.query('RESET ROLE');
    pool = new Pool({
      host: socket,
      port,
      database: 'zhiban_m5_native',
      user: 'zhiban_openmaic_migrator',
      max: 1,
      connectionTimeoutMillis: 3000,
    });
    const provision = await provisionNative(
      pool,
      'zhiban_m5_native',
      'DISPOSABLE_NATIVE_REFERENCE_ONLY',
    );
    await pool.end();
    pool = undefined;
    assert.equal(
      provision.storage,
      JSON.parse(
        fs.readFileSync(path.join(root, 'packages/@openmaic/storage/package.json'), 'utf8'),
      ).version,
    );
    assert.equal(
      provision.dsl,
      JSON.parse(fs.readFileSync(path.join(root, 'packages/@openmaic/dsl/package.json'), 'utf8'))
        .version,
    );
    passed('actual provisionNative/public Storage ensure functions create fresh Native schema');
    for (const role of [
      'zhiban_migrator',
      'zhiban_runtime',
      'zhiban_auth_runtime',
      'zhiban_control_runtime',
      'zhiban_bridge_runtime',
      'zhiban_academic_runtime',
      'zhiban_openmaic_migrator',
      'zhiban_openmaic_runtime',
    ])
      await admin.query(`ALTER ROLE ${role} NOLOGIN`);
    const before = await terminal.collectComplete(business, native, false);
    const beforeIndexes = (await native.query(indexSql)).rows[0].indexes;
    await admin.query(fs.readFileSync(path.join(candidate, '00-role-bootstrap.sql'), 'utf8'));
    await business.query(fs.readFileSync(path.join(candidate, '00-business-connect.sql'), 'utf8'));
    await business.query(fs.readFileSync(path.join(candidate, '00-catalog-observer.sql'), 'utf8'));
    await business.query('BEGIN');
    await business.query('SET LOCAL ROLE zhiban_identity_owner');
    for (const name of sources.inv.migration.orderedComponents)
      await business.query(fs.readFileSync(path.join(candidate, name), 'utf8'));
    await business.query("INSERT INTO zhiban_content.schema_migrations VALUES('0002',$1)", [
      sources.migrationSha256,
    ]);
    await business.query('COMMIT');
    await native.query('BEGIN');
    await native.query('SET LOCAL ROLE zhiban_openmaic_owner');
    await native.query(fs.readFileSync(path.join(candidate, '08-native-proof-acl.sql'), 'utf8'));
    await native.query('COMMIT');
    // Collector JSON shape is validated at runtime by verify-profile.py.
    let after: any = await terminal.collectAfter(business, native);
    const inheritedConnect = after.terminal.business.effectiveDatabasePrivileges.filter(
      (v: any) =>
        v.database === 'zhiban_m1_dev' &&
        ['zhiban_reconcile_native_proof', 'zhiban_reconcile_observer'].includes(v.role) &&
        v.privilege === 'CONNECT',
    );
    assert.equal(inheritedConnect.length, 2);
    assert.ok(inheritedConnect.every((v: any) => !v.allowed));
    terminal.matchAfter(after, after, dir);
    const ordinary = (
      await business.query(
        "SELECT r,has_database_privilege(r,current_database(),'CONNECT') allowed FROM unnest(ARRAY['zhiban_identity_owner','zhiban_migrator','zhiban_runtime','zhiban_auth_runtime','zhiban_control_runtime','zhiban_bridge_runtime','zhiban_academic_runtime']) r",
      )
    ).rows;
    assert.equal(ordinary.length, 7);
    assert.ok(ordinary.every((v) => v.allowed));
    passed(
      'TI-03: additive ACL removes PUBLIC-derived cross-DB access and preserves seven ordinary roles',
    );
    draft = {
      formatVersion: 1,
      kind: 'UNSIGNED_INDEPENDENT_NATIVE_REFERENCE_DRAFT',
      status: 'UNSIGNED_REVIEW_REQUIRED',
      profileShapeAccepted: true,
      blockingFinding: null,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      candidateInventorySha256: sources.inventorySha256,
      candidateMigrationSha256: sources.migrationSha256,
      officialDeclared: official,
      trackedStorageAndDslSourcesMatchLocalOfficialCommit: true,
      provisionBundleSha256: terminal.sha(fs.readFileSync(provisionBundle)),
      provisionBuildInputs: buildInputs,
      sourceBindingsSha256: terminal.sha(terminal.canonical(bindings)),
      before,
      after,
      nativeIndexSupplement: beforeIndexes,
      runtimeAccepted: false,
      approvalRef: null,
      limitations: [
        'No target comparison or independent review signature',
        'Business empty migration reference; no real product data',
        'No maintenance host/HBA/credential or recovery execution',
        'No complete terminal proof/recovery/enabled acceptance',
      ],
    };

    // Reproduce a same-name partial-index predicate drift missed by the reviewed collector.
    const oldFingerprint = await catalogFingerprint(native as any, 'public');
    await native.query('BEGIN');
    await native.query('SET LOCAL ROLE zhiban_openmaic_owner');
    await native.query('DROP INDEX public.asset_blobs_unreferenced_idx');
    await native.query(
      'CREATE INDEX asset_blobs_unreferenced_idx ON public.asset_blobs(unreferenced_at) WHERE unreferenced_at IS NULL',
    );
    await native.query('COMMIT');
    const drifted = await terminal.collectAfter(business, native).catch(async (e: unknown) => {
      await native.query('ROLLBACK');
      throw e;
    });
    // Restore the exact source definition after the comparison.
    assert.notEqual(terminal.canonical(drifted), terminal.canonical(after));
    assert.throws(() => terminal.matchAfter(after, drifted, dir));
    assert.notEqual(await catalogFingerprint(native as any, 'public'), oldFingerprint);
    await native.query('SET ROLE zhiban_openmaic_owner');
    await native.query('DROP INDEX public.asset_blobs_unreferenced_idx');
    await native.query(
      'CREATE INDEX asset_blobs_unreferenced_idx ON public.asset_blobs(unreferenced_at) WHERE unreferenced_at IS NOT NULL',
    );
    await native.query('RESET ROLE');
    assert.equal(await catalogFingerprint(native as any, 'public'), oldFingerprint);
    passed(
      'TI-01: same-name Native index predicate drift is rejected by full and terminal profiles',
    );

    await native.query(
      "UPDATE pg_index SET indisvalid=false WHERE indexrelid='public.asset_blobs_unreferenced_idx'::regclass",
    );
    try {
      const invalid = await terminal.collectAfter(business, native);
      assert.throws(() => terminal.matchAfter(after, invalid, dir));
    } finally {
      await native.query(
        "UPDATE pg_index SET indisvalid=true WHERE indexrelid='public.asset_blobs_unreferenced_idx'::regclass",
      );
    }
    passed('TI-01: invalid Native index state is rejected');
    await native.query('SET ROLE zhiban_openmaic_owner');
    await native.query('DROP INDEX public.asset_entries_principal_idx');
    await native.query(
      'CREATE UNIQUE INDEX asset_entries_principal_idx ON public.asset_entries(principal,id)',
    );
    await native.query('RESET ROLE');
    try {
      const unique = await terminal.collectAfter(business, native);
      assert.throws(() => terminal.matchAfter(after, unique, dir));
    } finally {
      await native.query('SET ROLE zhiban_openmaic_owner');
      await native.query('DROP INDEX public.asset_entries_principal_idx');
      await native.query(
        'CREATE INDEX asset_entries_principal_idx ON public.asset_entries(principal,id)',
      );
      await native.query('RESET ROLE');
    }
    passed('TI-01: same-name unique index drift is rejected');

    // Disposable signature fixtures only; no actual local authority is read or provisioned.
    const pair = crypto.generateKeyPairSync('ed25519');
    const put = (name: string, bytes: string | Buffer) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, bytes, { mode: 0o600 });
      return file;
    };
    const pinPath = put('pin.pem', pair.publicKey.export({ format: 'pem', type: 'spki' }));
    const pin = terminal.publicPin(pinPath);
    const sign = (p: any) =>
      terminal.signed(
        {
          formatVersion: 1,
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          authorityKeySha256: pin.digest,
          ...p,
        },
        pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
        pin,
      );
    const expectedPath = put(
      'expected.json',
      JSON.stringify(
        sign({
          purpose: 'REVIEWED_TERMINAL_EXPECTED_PROFILE',
          profile: 'terminal-reconciliation-local-v1',
          candidateInventorySha256: sources.inventorySha256,
          candidateMigrationSha256: sources.migrationSha256,
          review: {
            approvalRef: 'DISPOSABLE_TEST_ONLY_NOT_REAL_REVIEW',
            sourceKind: 'INDEPENDENT_SHADOW_PG16',
            referenceEvidenceSha256: terminal.sha(terminal.canonical(draft)),
          },
          before,
          after,
        }),
      ),
    );
    const target = await terminal.targetFacts(admin, business, native);
    const receiptPath = put(
      'receipt.json',
      JSON.stringify(
        sign({
          purpose: 'TERMINAL_TECHNICAL_INSTALLATION_BLOCKED',
          profile: 'terminal-reconciliation-local-v1',
          status: 'INSTALLED_BLOCKED',
          runtimeAccepted: false,
          terminalActionsAllowed: false,
          installationReady: false,
          approvalRef: 'DISPOSABLE_LOADER_FIXTURE_ONLY',
          issuedAt: new Date().toISOString(),
          candidateInventorySha256: sources.inventorySha256,
          candidateMigrationSha256: sources.migrationSha256,
          expectedArtifactSha256: terminal.sha(fs.readFileSync(expectedPath)),
          combinedCatalogSha256: terminal.sha(terminal.canonical(after)),
          target,
        }),
      ),
    );
    await admin.query('ALTER DATABASE zhiban_m1_dev ALLOW_CONNECTIONS false');
    await admin.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS false');
    const ctx = { admin, business, native, expectedPath, receiptPath, trustPinPath: pinPath };
    await terminal.loadBlockedReceipt(ctx);
    passed('current blocked loader accepts signed disposable receipt over actual Native reference');
    const originalQuery = native.query.bind(native);
    const nativeCollector = fs.readFileSync(
      path.join(candidate, '10-native-catalog-inspect.sql'),
      'utf8',
    );
    let injected = false;
    (native as any).query = async (sql: string, args: any) => {
      const result = await originalQuery(sql, args);
      if (sql === nativeCollector) {
        injected = true;
        await admin.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS true');
      }
      return result;
    };
    await assert.rejects(() => terminal.loadBlockedReceipt(ctx));
    assert.ok(injected);
    assert.equal(
      (await admin.query("SELECT datallowconn FROM pg_database WHERE datname='zhiban_m5_native'"))
        .rows[0].datallowconn,
      true,
    );
    (native as any).query = originalQuery;
    await admin.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS false');
    passed('TI-02: loader rejects late admission drift before returning');
    (native as any).query = async (sql: string, args: any) => {
      const r = await originalQuery(sql, args);
      if (sql === nativeCollector) await admin.query('ALTER ROLE zhiban_bridge_runtime LOGIN');
      return r;
    };
    try {
      await assert.rejects(() => terminal.loadBlockedReceipt(ctx));
    } finally {
      (native as any).query = originalQuery;
      await admin.query('ALTER ROLE zhiban_bridge_runtime NOLOGIN');
    }
    passed('TI-02: loader rejects late ordinary writer LOGIN drift');

    const broker = await adoptTechnicalBroker(ctx);
    assert.equal(broker.status().state, 'HELD_BLOCKED_TECHNICAL');
    const inspecting = broker.inspect();
    await assert.rejects(() => broker.inspect());
    await inspecting;
    passed('prepared broker refuses overlapping inspections');
    passed('prepared broker retains physical sessions and rechecks blocked receipt');
    (native as any).query = async (sql: string, args: any) => {
      const result = await originalQuery(sql, args);
      if (sql === nativeCollector)
        await admin.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS true');
      return result;
    };
    await assert.rejects(() => broker.inspect());
    assert.equal(broker.status().state, 'BLOCKED');
    await assert.rejects(() => broker.inspect());
    passed('prepared broker detects late admission drift and latches BLOCKED without reconnect');
    observations = {
      nativeTableCount: after.complete.native.relations.filter((r: any) => r.kind === 'r').length,
      nativeIndexCount: beforeIndexes.length,
      brokerEndState: broker.status(),
      reviewFindingsAddressed: ['TI-01', 'TI-02', 'TI-03'],
      downstreamProbeOnlyAdjustment: null,
      referenceArtifactAdjustmentApplied: false,
    };
    // Harness-only cleanup connection: broker never repairs/reopens a failed barrier.
    const cleanup = await connect('postgres');
    await cleanup.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS false');
    assert.equal(
      (
        await cleanup.query(
          "SELECT bool_and(NOT datallowconn) closed FROM pg_database WHERE datname IN ('zhiban_m1_dev','zhiban_m5_native')",
        )
      ).rows[0].closed,
      true,
    );
    passed(
      'harness observes closed admission after failure cleanup; broker has no reopen/recovery API',
    );
    assert.deepEqual(sourceBindings(), bindings);
    passed('source and distributed runtime byte bindings stable through reference build');
  } finally {
    if (pool) await pool.end();
    for (const c of clients) await c.end().catch(() => {});
    if (fs.existsSync(path.join(data, 'postmaster.pid')))
      execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], {
        stdio: 'ignore',
      });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const write = (name: string, value: unknown) =>
    fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  write('native-reference-draft.json', draft);
  write('source-bindings.json', bindings);
  write('evidence.json', {
    formatVersion: 1,
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    status: 'PASS_WITH_DEFERRED_MAINTENANCE_GATES',
    candidateInventorySha256: sources.inventorySha256,
    referenceDraftSha256: terminal.sha(
      fs.readFileSync(path.join(output, 'native-reference-draft.json')),
    ),
    sourceBindingsSha256: terminal.sha(terminal.canonical(bindings)),
    checks,
    observations,
    disposableClusterOnly: true,
    tcpListening: false,
    existingClustersConnected: false,
    temporaryClusterStoppedAndRemoved: true,
    realReceiptIssued: false,
    runtimeAccepted: false,
  });
  console.log(
    JSON.stringify({ checksPassed: checks.length, output, existingClustersConnected: false }),
  );
}
main().catch((error) => {
  console.error('Disposable reference preparation failed:', String(error.message).slice(0, 400));
  process.exitCode = 1;
});
