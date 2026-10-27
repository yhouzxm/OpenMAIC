/* eslint-disable @typescript-eslint/no-require-imports -- Bootstrap contract tests. */
'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  cp = require('node:child_process'),
  crypto = require('node:crypto');
const { context, environment } = require('../../../scripts/zhiban-deploy/pg18-acceptance.cjs');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-pg18-contract-'));
fs.chmodSync(root, 0o700);
const modulePath = path.join(root, 'version.mjs');
require('esbuild').buildSync({
  entryPoints: ['scripts/zhiban-local/pg-version.ts'],
  outfile: modulePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});
function invoke(code, env = {}) {
  const e = { ...process.env, ...env };
  if (env.ZHIBAN_LOCAL_PG_PROFILE === null) delete e.ZHIBAN_LOCAL_PG_PROFILE;
  return cp.spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m=await import(${JSON.stringify('file://' + modulePath)});${code}`,
    ],
    { env: e, cwd: root, encoding: 'utf8' },
  );
}
const dir = path.join(root, 'docs/v2/candidates/pg18-provider-v1');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
function fixture() {
  const source = Buffer.from('approved SQL');
  fs.writeFileSync(path.join(root, 'source.sql'), source);
  const r = {
    kind: 'PG18_SOURCE_BUILT_REFERENCE_V1',
    major: 18,
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    constructionOnly: true,
    profiles: { 'old.json': { scope: 'PG18' } },
    sourceHashes: { 'source.sql': hash(source) },
    importedPg16: { major: 18, profiles: { 'old.json': { scope: 'IMPORT' } } },
  };
  const bytes = JSON.stringify(r);
  fs.writeFileSync(path.join(dir, 'reference.json'), bytes);
  fs.writeFileSync(
    path.join(dir, 'pin.json'),
    JSON.stringify({ kind: 'PG18_REFERENCE_PIN_V1', sha256: hash(bytes) }),
  );
}
const pg18 = { ZHIBAN_LOCAL_PG_PROFILE: 'PG18_V1', ZHIBAN_PG18_LINEAGE: 'PG18_FRESH_V1' };
test('PG16 default reads the original profile with no PG18 reference requirement', () => {
  fs.writeFileSync(path.join(root, 'old.json'), '{"scope":"PG16","frozen":true}');
  const r = invoke(
    "console.log(JSON.stringify([m.localPgMajor,await m.readProfileReference('old.json')]))",
    { ZHIBAN_LOCAL_PG_PROFILE: null },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [16, { scope: 'PG16', frozen: true }]);
});
test('PG18 source-built reference and explicit imported lineage remain separate', () => {
  fixture();
  let r = invoke("console.log((await m.readProfileReference('old.json')).scope)", pg18);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'PG18');
  r = invoke("console.log((await m.readProfileReference('old.json')).scope)", {
    ...pg18,
    ZHIBAN_PG18_LINEAGE: 'PG16_IMPORTED_V1',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'IMPORT');
});
test('bad expected pin, changed SQL and unrecognized major or lineage fail closed', () => {
  fixture();
  fs.appendFileSync(path.join(dir, 'reference.json'), ' ');
  assert.notEqual(invoke('await m.pg18Reference()', pg18).status, 0);
  fixture();
  fs.appendFileSync(path.join(root, 'source.sql'), ' changed');
  assert.notEqual(invoke('await m.pg18Reference()', pg18).status, 0);
  assert.notEqual(invoke('', { ...pg18, ZHIBAN_LOCAL_PG_PROFILE: 'PG18' }).status, 0);
  assert.notEqual(invoke('', { ...pg18, ZHIBAN_PG18_LINEAGE: 'AUTO' }).status, 0);
});
test('LOCAL cannot silently become GitHub evidence without real-shaped run identity', () => {
  const local = invoke('console.log(JSON.stringify(m.executionEvidence()))', {
    ...pg18,
    GITHUB_ACTIONS: 'false',
  });
  assert.equal(local.status, 0, local.stderr);
  assert.equal(JSON.parse(local.stdout).evidenceOrigin, 'LOCAL');
  assert.notEqual(
    invoke('m.executionEvidence()', {
      ...pg18,
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '',
      GITHUB_SHA: '',
    }).status,
    0,
  );
});
test('acceptance child environment excludes credentials and foreign state', () => {
  const old = process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  assert.deepEqual(context(), { evidenceOrigin: 'LOCAL', githubActions: false });
  process.env.OPENMAIC_CONFIG = '/secret';
  process.env.GH_TOKEN = 'test';
  process.env.ZHIBAN_LOCAL_STATE = '/foreign';
  const e = environment();
  assert.equal(e.OPENMAIC_CONFIG, undefined);
  assert.equal(e.GH_TOKEN, undefined);
  assert.equal(e.ZHIBAN_LOCAL_STATE, undefined);
  delete process.env.OPENMAIC_CONFIG;
  delete process.env.GH_TOKEN;
  delete process.env.ZHIBAN_LOCAL_STATE;
  if (old !== undefined) process.env.GITHUB_ACTIONS = old;
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('PG18 snapshot loader rejects PG16 kind, manifest pin drift and added files', () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-pg18-snapshot-'));
  try {
    const snapshots = path.join(state, 'snapshots'),
      snapshot = path.join(snapshots, 'fixture');
    fs.mkdirSync(path.join(snapshot, 'root'), { recursive: true, mode: 0o700 });
    const manifest = {
      kind: 'LOCAL_PG16_PERSISTENT_SNAPSHOT_V1',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      originalRoot: '/tmp/zhiban-trial-content-NegativeOnly',
      files: {},
    };
    const file = path.join(snapshot, 'manifest.json');
    fs.writeFileSync(file, JSON.stringify(manifest), { mode: 0o600 });
    const tool = path.join(state, 'snapshot.mjs');
    require('esbuild').buildSync({
      entryPoints: ['scripts/zhiban-local/persistent-snapshot.ts'],
      outfile: tool,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const run = (pin) =>
      cp.spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const m=await import(${JSON.stringify('file://' + tool)});await m.inspectSnapshot(${JSON.stringify(snapshot)},${JSON.stringify(pin)});`,
        ],
        { env: { ...process.env, ...pg18, ZHIBAN_LOCAL_STATE: state }, encoding: 'utf8' },
      );
    assert.match(run(undefined).stderr, /Snapshot kind rejected/);
    manifest.kind = 'SYNTHETIC_PG18_PERSISTENT_SNAPSHOT_V1';
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.match(run('0'.repeat(64)).stderr, /manifest hash mismatch/);
    fs.writeFileSync(path.join(snapshot, 'root', 'unexpected'), '', { mode: 0o600 });
    assert.match(run(undefined).stderr, /file\/hash closure mismatch/);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('state binds exact major, reference, origin and supported installation lineage', () => {
  const { privateState } = require('../../../scripts/zhiban-deploy/pg18.cjs');
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-pg18-state-'));
  try {
    privateState(state, true);
    const marker = path.join(state, 'STATE.json'),
      original = JSON.parse(fs.readFileSync(marker));
    for (const patch of [
      { major: 16 },
      { referenceSha256: '0'.repeat(64) },
      { origin: 'https://127.0.0.1:3461' },
      { lineage: 'PG16_IMPORTED_V1' },
    ]) {
      fs.writeFileSync(marker, JSON.stringify({ ...original, ...patch }));
      assert.throws(() => privateState(state, false), /state\/reference binding rejected/);
    }
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('cleanup refuses an incomplete standalone postmaster identity and retains its root', async () => {
  const { cleanup } = require('../../../scripts/zhiban-deploy/pg18-acceptance.cjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-pg18-cleanup-')),
    target = fs.mkdtempSync('/tmp/zhiban-trial-content-');
  try {
    const state = path.join(base, 'instance');
    fs.mkdirSync(state, { mode: 0o700 });
    fs.mkdirSync(path.join(target, 'data'), { mode: 0o700 });
    fs.writeFileSync(path.join(target, 'data/postmaster.pid'), '-999999999\n', { mode: 0o600 });
    fs.writeFileSync(
      path.join(state, 'RUNTIME.json'),
      JSON.stringify({
        kind: 'PG18_OWNED_RUNTIME_V1',
        major: 18,
        root: target,
        socket: target + '/socket',
        port: 56517,
        pid: 999999999,
      }),
      { mode: 0o600 },
    );
    await assert.rejects(cleanup(base), /Incomplete postmaster identity/);
    assert.ok(fs.existsSync(path.join(target, 'data/postmaster.pid')));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});
