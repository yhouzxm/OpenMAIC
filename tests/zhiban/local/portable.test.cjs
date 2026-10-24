/* eslint-disable @typescript-eslint/no-require-imports -- Bootstrap boundary tests use Node only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  envelope,
  validateSnapshot,
  importPrivate,
  absolute,
  ancestors,
} = require('../../../scripts/zhiban-portable.cjs');
const sha = (b) => createHash('sha256').update(b).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-portable-test-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snap = path.join(root, 'snapshot');
  fs.mkdirSync(snap, { mode: 0o700 });
  fs.mkdirSync(path.join(snap, 'root'), { mode: 0o700 });
  fs.mkdirSync(path.join(snap, 'root/data'), { mode: 0o700 });
  fs.writeFileSync(path.join(snap, 'root/data/PG_VERSION'), '16\n', { mode: 0o600 });
  const manifest = {
    kind: 'LOCAL_PG16_PERSISTENT_SNAPSHOT_V1',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    originalRoot: '/tmp/zhiban-trial-content-PortableNegativeFixture',
    files: { 'data/PG_VERSION': sha('16\n') },
  };
  fs.writeFileSync(path.join(snap, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  return { root, snap, pin: sha(fs.readFileSync(path.join(snap, 'manifest.json'))), manifest };
}
test('verified snapshot permits immutable copy without PG startup', (t) => {
  const f = fixture(t);
  assert.equal(validateSnapshot(f.snap, f.pin).originalRoot, f.manifest.originalRoot);
});
test('manifest substitution rejected', (t) => {
  const f = fixture(t);
  assert.throws(() => validateSnapshot(f.snap, '0'.repeat(64)), /pin/);
});
test('changed PG file rejected', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.snap, 'root/data/PG_VERSION'), '15\n');
  assert.throws(() => validateSnapshot(f.snap, f.pin), /closure/);
});
test('extra unmanifested file rejected', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.snap, 'root/extra'), 'x');
  assert.throws(() => validateSnapshot(f.snap, f.pin), /closure/);
});
test('snapshot link cannot read external private file', (t) => {
  const f = fixture(t);
  fs.symlinkSync('/etc/passwd', path.join(f.snap, 'root/linked'));
  assert.throws(() => validateSnapshot(f.snap, f.pin), /Links/);
});
test('group accessible snapshot directory rejected', (t) => {
  const f = fixture(t);
  fs.chmodSync(f.snap, 0o750);
  assert.throws(() => validateSnapshot(f.snap, f.pin), /Private/);
});
test('symlink ancestor and noncanonical path rejected', (t) => {
  const f = fixture(t);
  fs.symlinkSync(f.snap, path.join(f.root, 'alias'));
  assert.throws(() => ancestors(path.join(f.root, 'alias/root')), /Symlink/);
  assert.throws(() => absolute(f.root + '/../else'), /Canonical/);
});
test('wrong package origin rejected even with its new pin', (t) => {
  const f = fixture(t);
  const p = path.join(f.root, 'MANIFEST.json');
  fs.writeFileSync(
    p,
    JSON.stringify({ kind: 'X', evidenceOrigin: 'GITHUB_ACTIONS', githubActions: true, files: {} }),
    { mode: 0o600 },
  );
  assert.throws(() => envelope(f.root, 'X', sha(fs.readFileSync(p))), /kind/);
});
test('invalid private import leaves target absent', (t) => {
  const f = fixture(t);
  const target = path.join(f.root, 'state');
  assert.throws(() => importPrivate(f.root, target, '0'.repeat(64)));
  assert.equal(fs.existsSync(target), false);
});
test('manifest metadata not accepted as arbitrary restore root', (t) => {
  const f = fixture(t);
  f.manifest.originalRoot = '/home/other/data';
  fs.writeFileSync(path.join(f.snap, 'manifest.json'), JSON.stringify(f.manifest));
  assert.throws(
    () => validateSnapshot(f.snap, sha(fs.readFileSync(path.join(f.snap, 'manifest.json')))),
    /binding/,
  );
});

test('portable launcher strips inherited provider and scanner; accepts only private per-instance service allowlist', (t) => {
  const f = fixture(t);
  const workspace = path.join(f.root, 'workspace'),
    state = path.join(f.root, 'state');
  fs.mkdirSync(workspace, { mode: 0o700 });
  fs.mkdirSync(state, { mode: 0o700 });
  fs.writeFileSync(
    path.join(workspace, 'INSTALLATION.json'),
    JSON.stringify({ kind: 'LOCAL_INDEPENDENT_INSTALLATION_V1', workspace }),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(state, 'INSTANCE.json'),
    JSON.stringify({
      kind: 'LOCAL_PORTABLE_INSTANCE_V1',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
    }),
    { mode: 0o600 },
  );
  const { instanceEnv } = require('../../../scripts/zhiban-portable.cjs');
  const previous = process.env.ZHIBAN_SCANNER_PROFILE;
  process.env.ZHIBAN_SCANNER_PROFILE = '/source/must-not-inherit';
  try {
    assert.equal(instanceEnv(workspace, state).ZHIBAN_SCANNER_PROFILE, undefined);
    const services = path.join(state, 'services.env');
    fs.writeFileSync(services, 'ZHIBAN_SCANNER_PROFILE=/new/explicit/profile\n', { mode: 0o600 });
    assert.equal(instanceEnv(workspace, state).ZHIBAN_SCANNER_PROFILE, '/new/explicit/profile');
    fs.writeFileSync(services, 'HOME=/bad\n');
    assert.throws(() => instanceEnv(workspace, state), /Unsupported/);
    fs.writeFileSync(services, 'ZHIBAN_SCANNER_PROFILE=/new/profile\n');
    fs.chmodSync(services, 0o644);
    assert.throws(() => instanceEnv(workspace, state), /Private/);
  } finally {
    if (previous === undefined) delete process.env.ZHIBAN_SCANNER_PROFILE;
    else process.env.ZHIBAN_SCANNER_PROFILE = previous;
  }
});
