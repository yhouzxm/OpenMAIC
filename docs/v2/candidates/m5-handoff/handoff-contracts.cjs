// Closed LOCAL contracts and fixed metadata collectors. No signer or PG mutation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const t = require('../m5-terminal/terminal-installation.cjs');
const { privateDirectory } = require('../m5-terminal/maintenance-lock.cjs');
const { relative } = require('./dependency-closure.cjs');
const ROOT = path.resolve(__dirname, '../../../..');
const PROFILE = 'ordinary-host-after-terminal-local-v1';
const LOGIN = [
  'zhiban_auth_runtime',
  'zhiban_runtime',
  'zhiban_control_runtime',
  'zhiban_academic_runtime',
  'zhiban_bridge_runtime',
  'zhiban_openmaic_runtime',
];
const ROLES = [
  ...LOGIN,
  'zhiban_identity_owner',
  'zhiban_openmaic_owner',
  'zhiban_migrator',
  'zhiban_openmaic_migrator',
  'zhiban_reconcile_controller',
  'zhiban_reconcile_issuer',
  'zhiban_reconcile_executor',
  'zhiban_reconcile_native_proof',
  'zhiban_reconcile_observer',
];
const SCHEMAS = [
  'zhiban_identity',
  'zhiban_bridge',
  'zhiban_academic',
  'zhiban_learning',
  'zhiban_assessment',
  'zhiban_content',
  'zhiban_reconcile',
  'zhiban_reconcile_catalog',
  'zhiban_handoff',
];
const PURPOSES = Object.fromEntries(
  [
    'prepare-approval',
    'handoff-receipt',
    'clear-approval',
    'cleared-gate',
    'revoke-approval',
    'host-ack',
    'install-approval',
  ].map((n) => [
    JSON.parse(fs.readFileSync(path.join(__dirname, n + '.template.json'))).purpose,
    n,
  ]),
);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const positive = /^[1-9][0-9]*$/;
function requireValue(ok, message) {
  if (!ok) throw Error(message);
}
function privateBytes(file) {
  requireValue(
    path.isAbsolute(file) && fs.realpathSync(file) === file,
    'Private canonical file required',
  );
  privateDirectory(path.dirname(file));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const s = fs.fstatSync(fd);
    requireValue(
      s.isFile() &&
        s.uid === process.getuid() &&
        !(s.mode & 0o077) &&
        s.nlink === 1 &&
        s.size <= 16 * 1024 * 1024,
      'Private leaf rejected',
    );
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function sources() {
  const raw = fs.readFileSync(path.join(__dirname, 'inventory.json')),
    inv = JSON.parse(raw);
  for (const [n, h] of Object.entries(inv.filesSha256))
    requireValue(t.sha(fs.readFileSync(path.join(__dirname, n))) === h, 'Handoff source drift');
  for (const [n, h] of Object.entries(inv.sourceBindingsSha256))
    requireValue(t.sha(fs.readFileSync(path.join(ROOT, n))) === h, 'Handoff binding drift');
  requireValue(
    t.sources().inventorySha256 === inv.terminalPrerequisiteInventorySha256,
    'Terminal prerequisite drift',
  );
  return { inv, inventorySha256: t.sha(raw) };
}
function targetShape(v) {
  t.keys(v, [
    'environment',
    'cluster',
    'businessOid',
    'nativeOid',
    'dataDirectory',
    'socketDirectory',
    'port',
    'origin',
  ]);
  requireValue(
    ['LOCAL_DEV', 'LOCAL_DISPOSABLE'].includes(v.environment) &&
      positive.test(v.cluster) &&
      positive.test(v.businessOid) &&
      positive.test(v.nativeOid) &&
      v.businessOid !== v.nativeOid,
    'Target identifiers rejected',
  );
  requireValue(
    path.isAbsolute(v.dataDirectory) &&
      path.isAbsolute(v.socketDirectory) &&
      Number.isInteger(v.port) &&
      v.port > 0 &&
      v.port < 65536 &&
      v.origin === 'https://127.0.0.1:3443',
    'Target endpoint rejected',
  );
  if (v.environment === 'LOCAL_DEV')
    requireValue(
      v.port === 55433 &&
        v.dataDirectory === '/home/zxm/.local/share/zhiban-m1/pgdata' &&
        v.socketDirectory === '/home/zxm/.local/share/zhiban-m1/socket',
      'Fixed development target required',
    );
  else
    requireValue(
      ['/tmp/zhiban-handoff-executor-', '/tmp/zhiban-release-pg16-'].some(
        (prefix) => v.dataDirectory.startsWith(prefix) && v.socketDirectory.startsWith(prefix),
      ) && path.dirname(v.dataDirectory) === path.dirname(v.socketDirectory),
      'Disposable target must be dedicated',
    );
}
function verify(raw, pin, purpose, source = sources()) {
  const p = t.verifyEnvelope(JSON.parse(raw), pin, purpose),
    name = PURPOSES[purpose];
  requireValue(name, 'Unknown handoff purpose');
  t.keys(
    p,
    Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, name + '.template.json')))),
  );
  requireValue(p.status === 'ISSUED', 'Unissued handoff artifact rejected');
  for (const [k, v] of Object.entries(p)) {
    if (k.endsWith('Id')) requireValue(uuid.test(v), 'UUIDv7 binding required');
    if (k.endsWith('Sha256')) requireValue(digest.test(v), 'Digest binding required');
    if (['epoch', 'fenceSequence', 'closedEventSequence'].includes(k))
      requireValue(positive.test(v), 'Positive decimal binding required');
  }
  if (p.sourceBindingsSha256)
    requireValue(
      p.sourceBindingsSha256 === source.inventorySha256,
      'Current source approval required',
    );
  if (p.target) targetShape(p.target);
  for (const k of [
    'launchAllowed',
    'terminalActionsAllowed',
    'runtimeAccepted',
    'productionSignoff',
  ])
    if (k in p) requireValue(p[k] === false, 'Forbidden handoff capability');
  if ('capabilities' in p)
    requireValue(
      t.canonical(p.capabilities) === t.canonical(['M1', 'M2', 'M3', 'M4', 'M5_TEXT']),
      'Ordinary capability set required',
    );
  if ('approvedLoginRoles' in p)
    requireValue(
      t.canonical(p.approvedLoginRoles) === t.canonical(LOGIN),
      'Exact ordinary LOGIN set required',
    );
  if (purpose === 'LOCAL_STARTUP_RELEASE_GATE')
    requireValue(
      p.databaseCommitRequired === true &&
        p.activationRule ===
          JSON.parse(fs.readFileSync(path.join(__dirname, 'cleared-gate.template.json')))
            .activationRule,
      'Commit-required gate contract',
    );
  if (purpose === 'LOCAL_PRODUCT_HANDOFF_VERIFIED') {
    t.keys(p.readAuthorization, ['deploymentId', 'releaseId', 'permissionDigest']);
    requireValue(
      p.readAuthorization.deploymentId === p.deploymentId &&
        p.readAuthorization.releaseId === p.releaseId &&
        digest.test(p.readAuthorization.permissionDigest),
      'Read scope binding rejected',
    );
  }
  return { payload: p, digest: t.sha(raw), raw };
}
function live(p) {
  const n = Date.now();
  requireValue(
    Number.isSafeInteger(p.issuedAt) &&
      Number.isSafeInteger(p.expiresAt) &&
      p.issuedAt <= n &&
      p.expiresAt > n &&
      p.expiresAt - p.issuedAt > 0 &&
      p.expiresAt - p.issuedAt <= 300000,
    'Live approval deadline rejected',
  );
}
function expected(raw, pin, source = sources()) {
  const p = t.verifyEnvelope(JSON.parse(raw), pin, 'REVIEWED_ORDINARY_HANDOFF_PROFILE');
  t.keys(p, [
    'formatVersion',
    'purpose',
    'evidenceOrigin',
    'githubActions',
    'authorityKeySha256',
    'profile',
    'sourceBindingsSha256',
    'review',
    'before',
    'after',
  ]);
  t.keys(p.review, ['sourceKind', 'approvalRef', 'referenceEvidenceSha256']);
  requireValue(
    p.profile === PROFILE &&
      p.sourceBindingsSha256 === source.inventorySha256 &&
      p.review.sourceKind === 'INDEPENDENT_SHADOW_PG16' &&
      typeof p.review.approvalRef === 'string' &&
      p.review.approvalRef.length > 0 &&
      digest.test(p.review.referenceEvidenceSha256),
    'Independent ordinary reference required',
  );
  for (const v of [p.before, p.after]) {
    t.keys(v, ['business', 'native']);
    for (const part of Object.values(v)) t.keys(part, ['complete', 'terminal']);
  }
  return { payload: p, digest: t.sha(raw) };
}
async function collect(b, n, after = true) {
  const result = {};
  for (const [part, c, schemas, sql, column] of [
    [
      'business',
      b,
      after ? SCHEMAS : SCHEMAS.slice(0, -1),
      '05-business-terminal-catalog.sql',
      'terminal_catalog',
    ],
    ['native', n, ['public'], '06-native-terminal-catalog.sql', 'terminal_native_catalog'],
  ]) {
    await c.query('BEGIN READ ONLY');
    try {
      await c.query('SET LOCAL search_path=pg_catalog');
      result[part] = {
        complete: (
          await c.query(fs.readFileSync(path.join(__dirname, '04-complete-catalog.sql'), 'utf8'), [
            schemas,
            ROLES,
          ])
        ).rows[0].installation_catalog,
        terminal: (await c.query(fs.readFileSync(path.join(__dirname, sql), 'utf8'))).rows[0][
          column
        ],
      };
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
  }
  return result;
}
function profile(actual, wanted, preopenedController = false) {
  const a = structuredClone(actual);
  if (preopenedController)
    for (const part of Object.values(a))
      for (const catalog of Object.values(part))
        for (const field of ['roles', 'userRoleInventory'])
          for (const r of catalog[field] || [])
            if (r.name === 'zhiban_reconcile_controller') r.login = false;
  requireValue(t.canonical(a) === t.canonical(wanted), 'Exact ordinary catalog profile rejected');
  const roles = actual.business.complete.userRoleInventory;
  requireValue(
    Array.isArray(roles) &&
      t.canonical(
        roles
          .filter(
            (r) =>
              r.login &&
              r.name !== 'postgres' &&
              !(preopenedController && r.name === 'zhiban_reconcile_controller'),
          )
          .map((r) => r.name)
          .sort(),
      ) === t.canonical([...LOGIN].sort()),
    'Ordinary role admission rejected',
  );
}
async function target(b, p) {
  targetShape(p);
  const a = (
    await b.query(
      "SELECT current_database() db,current_setting('server_version_num')::integer pg,current_setting('data_directory') data,current_setting('unix_socket_directories') socket,current_setting('port') port,(SELECT system_identifier::text FROM pg_control_system()) cluster,(SELECT oid::text FROM pg_database WHERE datname='zhiban_m1_dev') business,(SELECT oid::text FROM pg_database WHERE datname='zhiban_m5_native') native",
    )
  ).rows[0];
  requireValue(
    a.db === 'zhiban_m1_dev' &&
      a.pg >= 160000 &&
      a.pg < 170000 &&
      a.data === p.dataDirectory &&
      a.socket === p.socketDirectory &&
      a.port === String(p.port) &&
      a.cluster === p.cluster &&
      a.business === p.businessOid &&
      a.native === p.nativeOid,
    'Physical target rejected',
  );
}
async function nativeTarget(c, p) {
  const a = (
    await c.query(
      "SELECT current_database() db,current_setting('server_version_num')::integer pg,current_setting('data_directory') data,current_setting('port') port,(SELECT system_identifier::text FROM pg_control_system()) cluster,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid",
    )
  ).rows[0];
  requireValue(
    a.db === 'zhiban_m5_native' &&
      a.pg >= 160000 &&
      a.pg < 170000 &&
      a.data === p.dataDirectory &&
      a.port === String(p.port) &&
      a.cluster === p.cluster &&
      a.oid === p.nativeOid,
    'Native physical target rejected',
  );
}
function ordinaryEndpoint(c, p, role) {
  const v = c.connectionParameters;
  requireValue(
    v?.user === role &&
      v.port === p.port &&
      v.host ===
        (p.environment === 'LOCAL_DEV' ||
        (p.environment === 'LOCAL_DISPOSABLE' &&
          p.port === 56496 &&
          p.dataDirectory.startsWith('/tmp/zhiban-release-pg16-'))
          ? '127.0.0.1'
          : p.socketDirectory),
    'Fixed ordinary connection required',
  );
}
function artifacts(dir, manifest, rawDigest) {
  privateDirectory(dir);
  requireValue(
    t.sha(privateBytes(path.join(dir, 'artifact-manifest.json'))) === rawDigest,
    'Artifact manifest drift',
  );
  t.keys(manifest, ['formatVersion', 'releaseId', 'credentialGenerationId', 'files']);
  requireValue(
    manifest.formatVersion === 1 &&
      uuid.test(manifest.releaseId) &&
      uuid.test(manifest.credentialGenerationId) &&
      Array.isArray(manifest.files) &&
      manifest.files.length > 0,
    'Artifact manifest rejected',
  );
  const names = new Set();
  for (const f of manifest.files) {
    t.keys(f, ['path', 'sha256']);
    relative(f.path);
    requireValue(!names.has(f.path) && digest.test(f.sha256), 'Artifact leaf rejected');
    names.add(f.path);
    requireValue(t.sha(privateBytes(path.join(dir, f.path))) === f.sha256, 'Artifact leaf drift');
  }
  // No unbound executable/config leaf may hide beside the declared artifact set.
  const outputs = new Set([
    'artifact-manifest.json',
    'handoff-receipt.json',
    'host-validation-ack.json',
  ]);
  function walk(current, prefix = '') {
    privateDirectory(current);
    for (const name of fs.readdirSync(current)) {
      const rel = prefix + name,
        leaf = path.join(current, name),
        stat = fs.lstatSync(leaf);
      if (stat.isDirectory()) {
        requireValue(
          [...names].some((n) => n.startsWith(rel + '/')),
          'Undeclared artifact directory',
        );
        walk(leaf, rel + '/');
      } else {
        privateBytes(leaf);
        requireValue(names.has(rel) || outputs.has(rel), 'Undeclared artifact leaf');
      }
    }
  }
  walk(dir);
  return manifest;
}
function ordinaryLedgers(source = sources()) {
  const rows = [];
  for (const [name, checksum] of Object.entries(t.sources().inv.prerequisitesSha256)) {
    const match = name.match(
      /^lib\/zhiban\/infrastructure\/(identity|academic|learning|assessment)\/postgres\/migrations\/(\d{4})_/,
    );
    if (match) rows.push({ context: match[1], version: match[2], checksum });
  }
  rows.push(
    {
      context: 'content',
      version: '0001',
      checksum: 'e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324',
    },
    {
      context: 'content',
      version: '0002',
      checksum: source.inv.terminalPrerequisiteMigrationSha256,
    },
    { context: 'handoff', version: '0001', checksum: source.inv.migration.aggregateSha256 },
  );
  return rows.sort((a, b) =>
    (a.context + ' ' + a.version).localeCompare(b.context + ' ' + b.version),
  );
}
module.exports = {
  ...t,
  PROFILE,
  LOGIN,
  ROLES,
  SCHEMAS,
  uuid,
  digest,
  positive,
  requireValue,
  privateBytes,
  sources,
  verify,
  live,
  expected,
  collect,
  profile,
  target,
  nativeTarget,
  ordinaryEndpoint,
  artifacts,
  ordinaryLedgers,
};
