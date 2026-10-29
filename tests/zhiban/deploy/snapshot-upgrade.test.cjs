/* eslint-disable @typescript-eslint/no-require-imports -- Owned filesystem/snapshot process boundaries. */
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  cp = require('node:child_process'),
  crypto = require('node:crypto');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-upgrade-guard-'));
fs.chmodSync(root, 0o700);
const source = process.env.ZHIBAN_UPGRADE_SOURCE,
  pin = process.env.ZHIBAN_UPGRADE_SOURCE_PIN;
const entry = path.join(root, 'upgrade.mjs');
require('esbuild').buildSync({
  entryPoints: ['scripts/zhiban-deploy/upgrade-snapshot-130.ts'],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  alias: {
    lodash: require.resolve('lodash'),
    'lodash/isEqual': require.resolve('lodash/isEqual.js'),
    'next/server': 'next/server.js',
    'next/headers': 'next/headers.js',
    '@openmaic/dsl/schema/scene.schema.json': path.resolve(
      'packages/@openmaic/dsl/dist/schema/scene.schema.json',
    ),
  },
  banner: {
    js: `import {createRequire as externalCreateRequire} from 'node:module';const require=externalCreateRequire(${JSON.stringify(path.resolve('package.json'))});`,
  },
  logLevel: 'silent',
});
// External ESM packages resolve relative to this private entry: expose only the existing dependency directory.
fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'));
function run(action, s, p, out, extra = [], env = {}) {
  return cp.spawnSync(process.execPath, [entry, action, s, p, out, '--unified-trial', ...extra], {
    cwd: process.cwd(),
    env: { ...process.env, ZHIBAN_LOCAL_STATE: out, ...env },
    encoding: 'utf8',
    timeout: 120000,
  });
}
test(
  'wrong pin, overlapping output and external DSN are refused before source mutation',
  { skip: !source || !pin },
  () => {
    const before = fs.readFileSync(path.join(source, 'manifest.json'));
    let r = run('inspect', source, '0'.repeat(64), path.join(root, 'bad-pin'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /pin mismatch/);
    r = run('inspect', source, pin, path.join(source, 'nested'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /disjoint/);
    assert.equal(fs.existsSync(path.join(source, 'nested')), false);
    r = run('inspect', source, pin, path.join(root, 'dsn'), [], {
      DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/foreign',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /external database/);
    assert.deepEqual(fs.readFileSync(path.join(source, 'manifest.json')), before);
  },
);
test(
  'partial Native DDL and pre-snapshot cuts leave no pointer or working clone',
  { skip: !source || !pin },
  () => {
    const sourceBytes = fs.readFileSync(path.join(source, 'manifest.json'));
    const original = JSON.parse(sourceBytes).originalRoot;
    for (const phase of ['AFTER_NATIVE', 'BEFORE_SNAPSHOT', 'AFTER_SNAPSHOT']) {
      const out = path.join(root, phase);
      const r = run('upgrade', source, pin, out, ['--fault=' + phase]);
      assert.notEqual(r.status, 0, r.stdout);
      assert.match(r.stderr, new RegExp('Injected owned-copy cut: ' + phase));
      assert.equal(fs.existsSync(original), false);
      assert.equal(fs.existsSync(path.join(out, 'snapshots/latest.json')), false);
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(out, 'FAILED.json'))).status,
        'FAILED_NO_POINTER_SWITCH',
      );
      assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'PHASE.json'))).phase, phase);
    }
    assert.equal(hash(fs.readFileSync(path.join(source, 'manifest.json'))), hash(sourceBytes));
    assert.equal(fs.existsSync(path.join(path.dirname(source), '.operation-lock')), false);
  },
);
test('pre-v1.3 snapshot restore refuses before creating its bound working directory', () => {
  const state = path.join(root, 'state');
  const snapshots = path.join(state, 'snapshots');
  const snap = path.join(snapshots, 'old');
  const data = path.join(snap, 'root/data');
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  const original = path.join(
    os.tmpdir(),
    'zhiban-trial-content-Guard' + crypto.randomBytes(4).toString('hex'),
  );
  fs.writeFileSync(path.join(data, 'PG_VERSION'), '16\n', { mode: 0o600 });
  const m = {
    kind: 'LOCAL_PG16_PERSISTENT_SNAPSHOT_V1',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    originalRoot: original,
    metadata: { contentInstallation: { provider: { storage: '0.37.3' } } },
    files: { 'data/PG_VERSION': hash('16\n') },
  };
  fs.writeFileSync(path.join(snap, 'manifest.json'), JSON.stringify(m), { mode: 0o600 });
  fs.writeFileSync(
    path.join(snapshots, 'latest.json'),
    JSON.stringify({ path: snap, manifestHash: hash(JSON.stringify(m)) }),
    { mode: 0o600 },
  );
  const script = path.join(root, 'snapshot.mjs');
  require('esbuild').buildSync({
    entryPoints: ['scripts/zhiban-local/persistent-snapshot.ts'],
    outfile: script,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const r = cp.spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m=await import(${JSON.stringify('file://' + script)});await m.restoreLatest()`,
    ],
    { env: { ...process.env, ZHIBAN_LOCAL_STATE: state }, encoding: 'utf8' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /explicit offline copy upgrader/);
  assert.equal(fs.existsSync(original), false);
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
