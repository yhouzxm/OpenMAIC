/* eslint-disable @typescript-eslint/no-require-imports -- Tests exercise the dependency-free CommonJS bootstrap with node:test. */
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { comparable, checkDefinition } = require('../../../scripts/zhiban-deploy/compatibility.cjs');
const { bundle, compare } = require('../../../scripts/zhiban-deploy/pg-transfer.cjs');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
test('only associative Boolean grouping is equivalent; strings and OR grouping retain meaning', () => {
  assert.deepEqual(
    checkDefinition('CHECK (((a AND b) AND c))'),
    checkDefinition('CHECK ((a AND b AND c))'),
  );
  assert.notDeepEqual(
    checkDefinition('CHECK (((a OR b) AND c))'),
    checkDefinition('CHECK ((a OR (b AND c)))'),
  );
  assert.notDeepEqual(
    checkDefinition("CHECK ((x = 'a AND b'))"),
    checkDefinition("CHECK ((x = 'a OR b'))"),
  );
  assert.notDeepEqual(
    checkDefinition('CHECK (((a+b)*c)>0)'),
    checkDefinition('CHECK ((a+(b*c))>0)'),
  );
});
const inventory = () => ({
  databases: {
    app: {
      catalog: {
        tables: [['s', 't', 'owner', true, true]],
        constraints: [],
        acl: [['table', 's', 't', 'owner', 'owner', 'SELECT', false]],
      },
      data: { t: { rows: '1', rowHash: 'original' } },
    },
  },
  roles: [['runtime', false]],
  edges: [],
});
test('new owner MAINTAIN is classified without accepting new runtime privilege or RLS changes', () => {
  const a = inventory(),
    b = structuredClone(a);
  b.databases.app.catalog.acl.push(['table', 's', 't', 'owner', 'owner', 'MAINTAIN', false]);
  assert.deepEqual(comparable(a).facts, comparable(b).facts);
  b.databases.app.catalog.acl.push(['table', 's', 't', 'runtime', 'owner', 'MAINTAIN', false]);
  assert.notDeepEqual(comparable(a).facts, comparable(b).facts);
  const rls = inventory();
  rls.databases.app.catalog.tables[0][3] = false;
  assert.notDeepEqual(comparable(a).facts, comparable(rls).facts);
});
test('row, role and missing table mutations remain differences', () => {
  const a = inventory(),
    b = inventory();
  b.databases.app.data.t.rowHash = 'changed';
  assert.deepEqual(compare(a, b), ['databases.app.data.t.rowHash']);
  b.roles[0][1] = true;
  assert.ok(compare(a, b).includes('roles'));
  delete b.databases.app.data.t;
  assert.ok(compare(a, b).includes('databases.app.data.t'));
});
test('private bundle rejects wrong pin, changed files, unsafe mode, and links before any DB operation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-transfer-unit-'));
  fs.chmodSync(root, 0o700);
  try {
    const inputs = [
      'roles.sql',
      'inventory.json',
      'zhiban_trial_content_disposable.dump',
      'zhiban_trial_content_native.dump',
      'zhiban_trial_lesson_native.dump',
      'host-files/accounts.json',
      'host-files/member-control.json',
      'host-files/content-installation.json',
      'host-files/native-secret/instance-secret.key',
    ];
    for (const name of inputs) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(root, name), 'fixture', { mode: 0o600 });
    }
    const m = {
      kind: 'LOCAL_LOGICAL_PG_TRANSFER_V1',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      sourceMajor: 16,
      targetMajor: 18,
      inventoryVersion: 2,
      scope: 'PRIVATE_QUARANTINE_NO_PROVIDER_ACTIVATION',
      databases: [
        'zhiban_trial_content_disposable',
        'zhiban_trial_content_native',
        'zhiban_trial_lesson_native',
      ],
      files: Object.fromEntries(inputs.map((name) => [name, hash(Buffer.from('fixture'))])),
    };
    const bytes = JSON.stringify(m);
    fs.writeFileSync(path.join(root, 'MANIFEST.json'), bytes, { mode: 0o600 });
    const pin = hash(Buffer.from(bytes));
    assert.equal(bundle(root, pin).targetMajor, 18);
    assert.throws(() => bundle(root, '0'.repeat(64)), /pin/);
    fs.writeFileSync(path.join(root, 'roles.sql'), 'changed');
    assert.throws(() => bundle(root, pin), /closure/);
    fs.writeFileSync(path.join(root, 'roles.sql'), 'fixture');
    fs.chmodSync(path.join(root, 'roles.sql'), 0o644);
    assert.throws(() => bundle(root, pin), /Private/);
    fs.chmodSync(path.join(root, 'roles.sql'), 0o600);
    fs.symlinkSync('roles.sql', path.join(root, 'foreign'));
    assert.throws(() => bundle(root, pin), /Links/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
