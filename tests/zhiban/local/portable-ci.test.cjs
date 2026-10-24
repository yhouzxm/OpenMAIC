/* eslint-disable @typescript-eslint/no-require-imports -- Real crypto/bootstrap tests need no project build. */
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  cp = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const {
  seal,
  unseal,
  fileHash,
  extractDelivery,
} = require('../../../scripts/zhiban-ci/portable-delivery.cjs');
const {
  publicReport,
  safeEnv,
  ciContext,
  hostMatches,
} = require('../../../scripts/zhiban-ci/portable-acceptance.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-portable-ci-test-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'plain');
  fs.writeFileSync(input, randomBytes(8192), { mode: 0o600 });
  return {
    root,
    input,
    key: randomBytes(32),
    cipher: path.join(root, 'sealed'),
    out: path.join(root, 'opened'),
  };
}
test('AES-256-GCM actual roundtrip and private output mode', async (t) => {
  const f = fixture(t);
  await seal(f.input, f.cipher, f.key);
  await unseal(f.cipher, f.out, f.key, await fileHash(f.cipher));
  assert.deepEqual(fs.readFileSync(f.input), fs.readFileSync(f.out));
  assert.equal(fs.statSync(f.out).mode & 0o777, 0o600);
});
test('wrong key never publishes plaintext and removes unauthenticated temporary files', async (t) => {
  const f = fixture(t);
  await seal(f.input, f.cipher, f.key);
  await assert.rejects(unseal(f.cipher, f.out, randomBytes(32), await fileHash(f.cipher)));
  assert.equal(fs.existsSync(f.out), false);
  assert.ok(!fs.readdirSync(f.root).some((n) => n.includes('unauthenticated')));
});
test('ciphertext body tamper with recomputed transport hash still fails GCM authentication', async (t) => {
  const f = fixture(t);
  await seal(f.input, f.cipher, f.key);
  const b = fs.readFileSync(f.cipher);
  b[30] ^= 1;
  fs.writeFileSync(f.cipher, b);
  await assert.rejects(unseal(f.cipher, f.out, f.key, await fileHash(f.cipher)));
  assert.equal(fs.existsSync(f.out), false);
});
test('wrong ciphertext pin rejects before publishing plaintext', async (t) => {
  const f = fixture(t);
  await seal(f.input, f.cipher, f.key);
  await assert.rejects(unseal(f.cipher, f.out, f.key, '0'.repeat(64)), /hash/);
  assert.equal(fs.existsSync(f.out), false);
});
test('seal refuses existing destination and symlink ancestor', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.cipher, 'existing');
  await assert.rejects(seal(f.input, f.cipher, f.key), /exists/);
  assert.equal(fs.readFileSync(f.cipher, 'utf8'), 'existing');
  fs.symlinkSync(f.root, path.join(f.root, 'alias'));
  await assert.rejects(seal(f.input, path.join(f.root, 'alias/new'), f.key), /Symlink/);
});
function tarFixture(root, mode) {
  const archive = path.join(root, 'fixture.tar.gz');
  cp.execFileSync('python3', [
    '-I',
    '-c',
    String.raw`
import tarfile,io,json,hashlib,sys
mode=sys.argv[2];plain=b'fixture'
manifest={'kind':'ZHIBAN_PORTABLE_CI_DELIVERY_V2','evidenceOrigin':'LOCAL','githubActions':False,'directories':['restore','restore/empty'],'files':{'baseline.json':hashlib.sha256(plain).hexdigest()}}
if mode=='nested':
 manifest['files']['restore/one/two/fixture']=hashlib.sha256(plain).hexdigest();manifest['directories']+=['restore/one','restore/one/two']
if mode=='legacy':manifest['kind']='ZHIBAN_PORTABLE_CI_DELIVERY_V1'
with tarfile.open(sys.argv[1],'w:gz') as t:
 def put(name,data):
  m=tarfile.TarInfo(name);m.size=len(data);t.addfile(m,io.BytesIO(data))
 for directory in manifest['directories']:
  if mode=='missingdir' and directory=='restore/empty':continue
  m=tarfile.TarInfo(directory);m.type=tarfile.DIRTYPE;t.addfile(m)
 if mode in ('extradir','dirlink','duplicate-dir'):
  m=tarfile.TarInfo('restore/unmanifested' if mode=='extradir' else 'restore/empty');m.type=tarfile.SYMTYPE if mode=='dirlink' else tarfile.DIRTYPE;m.linkname='/etc';t.addfile(m)
 put('DELIVERY.json',json.dumps(manifest).encode());put('baseline.json',plain)
 if mode=='nested':put('restore/one/two/fixture',plain)
 if mode=='traversal':put('restore/../../outside',b'blocked')
 if mode=='duplicate':put('baseline.json',plain)
 if mode=='link':
  m=tarfile.TarInfo('restore/link');m.type=tarfile.SYMTYPE;m.linkname='/etc/passwd';t.addfile(m)
 if mode=='extra':put('restore/unmanifested',b'blocked')
`,
    archive,
    mode,
  ]);
  return archive;
}
test('delivery extraction verifies exact file set and creates owner-only files', (t) => {
  const f = fixture(t);
  const destination = path.join(f.root, 'delivery');
  extractDelivery(tarFixture(f.root, 'valid'), destination);
  assert.equal(fs.readFileSync(path.join(destination, 'baseline.json'), 'utf8'), 'fixture');
  assert.equal(fs.statSync(path.join(destination, 'restore/empty')).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(path.join(destination, 'restore/empty')), []);
  assert.equal(fs.statSync(path.join(destination, 'baseline.json')).mode & 0o777, 0o600);
});
for (const mode of [
  'traversal',
  'duplicate',
  'link',
  'extra',
  'missingdir',
  'extradir',
  'duplicate-dir',
  'dirlink',
  'legacy',
])
  test('delivery ' + mode + ' rejects and removes its new directory', (t) => {
    const f = fixture(t);
    const destination = path.join(f.root, 'delivery');
    assert.throws(() => extractDelivery(tarFixture(f.root, mode), destination), /rejected/);
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.existsSync(path.join(f.root, 'outside')), false);
  });
test('public report drops credentials, paths, arbitrary child stderr and nested inputs', () => {
  const secret = 'fixture-sensitive-value';
  const report = publicReport({
    status: 'PASS',
    sourceDigest: 'a'.repeat(64),
    tables: 212,
    rows: 572,
    accountsPreserved: true,
    password: secret,
    sourceHashes: { key: secret },
    failure: secret,
    failureStage: secret,
    pg: secret,
    cleanup: { status: 'PASS', privateNamespacePurged: true, token: secret },
  });
  assert.equal(report.status, 'PASS');
  assert.equal(report.tables, 212);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.sourceHashes, undefined);
});
test('candidate child environment excludes transport and GitHub credentials', () => {
  const keys = [
    'ZHIBAN_PORTABLE_TRANSPORT_KEY',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'ACTIONS_RUNTIME_TOKEN',
    'GLM_API_KEY',
    'ZHIBAN_SCANNER_PROFILE',
  ];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) process.env[k] = 'fixture-sensitive-value';
    const env = safeEnv('/private/state');
    for (const k of keys) assert.equal(env[k], undefined);
    assert.equal(env.ZHIBAN_LOCAL_STATE, '/private/state');
  } finally {
    for (const k of keys)
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
  }
});
test('local context cannot claim remote acceptance; stale process identity rejected', () => {
  const old = process.env.GITHUB_ACTIONS;
  try {
    delete process.env.GITHUB_ACTIONS;
    assert.throws(ciContext, /real GitHub/);
  } finally {
    if (old === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = old;
  }
  assert.equal(hostMatches({ pid: process.pid, start: '0', bootstrap: '/unrelated' }), false);
});
test('workflow is manual, pinned, no cache, key scoped to decrypt and upload limited to one summary', () => {
  const yaml = require('js-yaml');
  const workflow = yaml.load(
    fs.readFileSync(
      path.join(__dirname, '../../../.github/workflows/zhiban-portable-acceptance.yml'),
      'utf8',
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs['remote-acceptance'];
  assert.equal(job.environment, 'zhiban-portable-acceptance');
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  // GitHub does not expose the runner context in jobs.<job_id>.env.
  assert.doesNotMatch(JSON.stringify(job.env), /runner\./);
  const steps = job.steps;
  assert.match(steps[0].run, /ACCEPTANCE_ROOT="\$RUNNER_TEMP\/zhiban-portable-/);
  assert.match(steps[0].run, />> "\$GITHUB_ENV"/);
  for (const s of steps.filter((s) => s.uses)) assert.match(s.uses, /@[a-f0-9]{40}$/);
  const decrypt = steps.filter((s) => s.env?.ZHIBAN_PORTABLE_TRANSPORT_KEY);
  assert.equal(decrypt.length, 1);
  assert.ok(!job.env.ZHIBAN_PORTABLE_TRANSPORT_KEY);
  const setup = steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
  assert.equal(setup.with.cache, undefined);
  const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.with.path, '${{ env.ACCEPTANCE_REPORT }}');
  assert.equal(upload.with['retention-days'], 7);
  assert.ok(steps.find((s) => s.name?.startsWith('Stop bound')).if === 'always()');
  assert.equal(createHash('sha256').update('unrelated').digest('hex').length, 64);
});

test('controlled cleanup fault refuses unrelated PID and still purges only its private namespace', async (t) => {
  const f = fixture(t),
    base = path.join(f.root, 'zhiban-portable-123-1');
  fs.mkdirSync(base, { mode: 0o700 });
  const pgRoot = fs.mkdtempSync('/tmp/zhiban-trial-content-CITest');
  fs.chmodSync(pgRoot, 0o700);
  fs.mkdirSync(path.join(pgRoot, 'data'), { mode: 0o700 });
  t.after(() => fs.rmSync(pgRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(pgRoot, 'data/postmaster.pid'),
    process.pid + '\n' + path.join(pgRoot, 'data') + '\n',
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(base, 'custody.json'),
    JSON.stringify({ root: pgRoot, uid: process.getuid(), runId: '123' }),
    { mode: 0o600 },
  );
  fs.writeFileSync(path.join(base, 'private-fixture'), 'fixture-sensitive-value', { mode: 0o600 });
  const keys = ['RUNNER_TEMP', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'],
    previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.env.RUNNER_TEMP = f.root;
    process.env.GITHUB_RUN_ID = '123';
    process.env.GITHUB_RUN_ATTEMPT = '1';
    const { cleanup } = require('../../../scripts/zhiban-ci/portable-acceptance.cjs');
    const errors = await cleanup(base);
    assert.ok(errors.some((e) => e.includes('unverified PG PID')));
    assert.deepEqual(fs.readdirSync(base), []);
    assert.ok(fs.existsSync(pgRoot));
    assert.equal(process.kill(process.pid, 0), true);
  } finally {
    for (const k of keys)
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
  }
});

test('staging copy mode is explicitly private independently of process umask', (t) => {
  const f = fixture(t);
  const dir = path.join(f.root, 'copied-directory');
  fs.mkdirSync(dir, { mode: 0o775 });
  fs.chmodSync(dir, 0o775);
  const file = path.join(dir, 'file');
  fs.writeFileSync(file, 'fixture', { mode: 0o664 });
  fs.chmodSync(file, 0o664);
  const { privateTree } = require('../../../scripts/zhiban-ci/portable-delivery.cjs');
  privateTree(dir);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.symlinkSync(f.input, path.join(dir, 'link'));
  assert.throws(() => privateTree(dir), /type\/owner/);
  assert.equal(fs.statSync(f.input).mode & 0o777, 0o600);
});

test('authenticated extraction keeps every intermediate parent private', (t) => {
  const f = fixture(t),
    out = path.join(f.root, 'nested');
  extractDelivery(tarFixture(f.root, 'nested'), out);
  const { tree } = require('../../../scripts/zhiban-portable.cjs');
  assert.ok(tree(out, '', true)['restore/one/two/fixture']);
});

test('missing, partial and malformed public report stay FAIL and cannot prevent cleanup entry', (t) => {
  const f = fixture(t),
    p = path.join(f.root, 'report.json');
  const { loadPublicReport } = require('../../../scripts/zhiban-ci/portable-acceptance.cjs');
  assert.equal(loadPublicReport(p).status, 'FAIL');
  fs.writeFileSync(p, '{"status":"PASS"');
  assert.equal(loadPublicReport(p).status, 'FAIL');
  fs.writeFileSync(p, 'null');
  assert.equal(loadPublicReport(p).status, 'FAIL');
});

function startupFixture(t, body) {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'workspace/docs/v2/evidence'), { recursive: true });
  fs.mkdirSync(path.join(f.root, 'cargo/install'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'cargo/install/install.cjs'), body);
  fs.writeFileSync(
    path.join(f.root, 'cargo/DELIVERY.json'),
    JSON.stringify({ originalRoot: '/tmp/controlled-startup-fixture' }),
  );
  return f.root;
}
async function stopFixture(host) {
  if (host.exited) return;
  process.kill(-host.pid, 'SIGTERM');
  for (let i = 0; i < 100 && !host.exited; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(host.exited, true);
}
test('real child exit code survives private stderr suppression and report sanitization', async (t) => {
  const { startHost, ready } = require('../../../scripts/zhiban-ci/portable-acceptance.cjs');
  const base = startupFixture(
    t,
    "console.error('secret-token-and-private-path'); setTimeout(()=>process.exit(37),20);",
  );
  const host = await startHost(base, 'start-rebind');
  t.after(() => stopFixture(host));
  await assert.rejects(ready(base, host, undefined, { timeoutMs: 2000, pollMs: 10 }), (e) => {
    const report = publicReport({
      status: 'FAIL',
      diagnostic: e.diagnostic,
      message: 'secret-token-and-private-path',
      phaseTimings: { RESTORE_START: 20, '/private/path': 45 },
    });
    assert.equal(report.diagnostic.code, 'HOST_EXITED');
    assert.equal(report.diagnostic.exitCode, 37);
    assert.equal(report.diagnostic.mode, 'start-rebind');
    assert.deepEqual(report.phaseTimings, { RESTORE_START: 20 });
    assert.ok(!JSON.stringify(report).includes('secret-token'));
    assert.ok(!JSON.stringify(report).includes('/private/path'));
    return true;
  });
});
test('live child without readiness is timeout, changed identity is distinct and never signalled by ready', async (t) => {
  const { startHost, ready } = require('../../../scripts/zhiban-ci/portable-acceptance.cjs');
  const base = startupFixture(t, 'setInterval(()=>{},1000);');
  const host = await startHost(base, 'start');
  t.after(() => stopFixture(host));
  await assert.rejects(
    ready(base, host, undefined, { timeoutMs: 60, pollMs: 10 }),
    (e) => e.diagnostic.code === 'HOST_READINESS_TIMEOUT',
  );
  await assert.rejects(
    ready(base, { ...host, start: '0' }, undefined, { timeoutMs: 100, pollMs: 10 }),
    (e) => e.diagnostic.code === 'HOST_IDENTITY_REJECTED',
  );
  assert.equal(hostMatches(host, base), true);
});
test('malformed startup metadata is a distinct failure and no raw bytes enter the summary', async (t) => {
  const { startHost, ready } = require('../../../scripts/zhiban-ci/portable-acceptance.cjs');
  const base = startupFixture(
    t,
    "require('fs').writeFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json','private-invalid-json');setInterval(()=>{},1000);",
  );
  const host = await startHost(base, 'start');
  t.after(() => stopFixture(host));
  await assert.rejects(
    ready(base, host, undefined, { timeoutMs: 1000, pollMs: 10 }),
    (e) =>
      e.diagnostic.code === 'HOST_METADATA_INVALID' &&
      !JSON.stringify(e.diagnostic).includes('private-invalid'),
  );
});
test('diagnostic allowlist rejects attacker fields, unknown codes, arbitrary signal and duration', () => {
  assert.equal(publicReport({ diagnostic: { code: '/private/secret' } }).diagnostic, undefined);
  assert.deepEqual(
    publicReport({
      diagnostic: {
        code: 'HOST_EXITED',
        exitCode: -1,
        signal: 'SECRET',
        elapsedMs: -1,
        mode: '/private',
        stderr: 'secret',
      },
    }).diagnostic,
    { code: 'HOST_EXITED' },
  );
});

test('private log classifier emits only fixed reasons and refuses symlinks and public files', (t) => {
  const { startupReason } = require('../../../scripts/zhiban-ci/portable-acceptance.cjs');
  const f = fixture(t),
    file = path.join(f.root, 'host-start.log');
  const cases = [
    ['FATAL ERROR: Reached heap limit secret-value', 'NODE_HEAP_LIMIT'],
    ['Cannot find package secret-value from /private/secret', 'DEPENDENCY_MISSING'],
    ['error TS2307: secret-value', 'TYPESCRIPT_BUILD_FAILED'],
    [
      'Command failed: pnpm --filter @openmaic/renderer build secret-value',
      'NATIVE_SDK_BUILD_FAILED',
    ],
    ['Upstream source pin mismatch: /private/path', 'UPSTREAM_SOURCE_REFUSED'],
    ['pg_ctl: could not start server: /private/path', 'PG_START_FAILED'],
    ['opaque secret-value', 'UNCLASSIFIED'],
  ];
  for (const [text, expected] of cases) {
    fs.writeFileSync(file, text, { mode: 0o600 });
    assert.equal(startupReason(f.root, 'start'), expected);
    const r = publicReport({ diagnostic: { code: 'HOST_EXITED', reason: expected, raw: text } });
    assert.equal(r.diagnostic.reason, expected);
    assert.ok(!JSON.stringify(r).includes('secret-value'));
  }
  fs.chmodSync(file, 0o644);
  assert.equal(startupReason(f.root, 'start'), 'UNCLASSIFIED');
  fs.unlinkSync(file);
  fs.symlinkSync(f.input, file);
  assert.equal(startupReason(f.root, 'start'), 'UNCLASSIFIED');
  assert.equal(startupReason(f.root, '../../private'), 'UNCLASSIFIED');
});
