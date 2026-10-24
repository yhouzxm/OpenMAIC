// Closed observation contract. No signer, credential issuer, or real-target defaults.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const HERE = __dirname,
  ROOT = path.resolve(HERE, '../../../..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const requireValue = (ok, code) => {
  if (!ok) throw Error(code);
};
const canonical = (v) =>
  JSON.stringify(
    v && typeof v === 'object'
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, JSON.parse(canonical(v[k]))]),
          )
      : v,
  );
function keys(v, expected) {
  requireValue(
    v &&
      !Array.isArray(v) &&
      typeof v === 'object' &&
      Object.keys(v).sort().join('\0') === [...expected].sort().join('\0'),
    'CONTRACT_KEYS',
  );
}
function directory(p) {
  requireValue(
    typeof p === 'string' && /^\/[A-Za-z0-9_./-]+$/.test(p) && fs.realpathSync(p) === p,
    'CANONICAL_DIRECTORY',
  );
  const s = fs.lstatSync(p);
  requireValue(
    s.isDirectory() && s.uid === process.getuid() && !(s.mode & 0o077),
    'PRIVATE_DIRECTORY',
  );
  return s;
}
function bytes(p, privateFile = true) {
  requireValue(path.isAbsolute(p) && fs.realpathSync(p) === p, 'CANONICAL_FILE');
  if (privateFile) directory(path.dirname(p));
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const s = fs.fstatSync(fd);
    requireValue(
      s.isFile() &&
        s.nlink === 1 &&
        s.size <= 2 * 1024 * 1024 &&
        (!privateFile || (s.uid === process.getuid() && !(s.mode & 0o077))),
      'PRIVATE_FILE',
    );
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function sources() {
  const p = path.join(HERE, 'inventory.json'),
    raw = fs.readFileSync(p),
    i = JSON.parse(raw);
  for (const [n, h] of Object.entries(i.filesSha256))
    requireValue(sha(fs.readFileSync(path.join(HERE, n))) === h, 'OBSERVER_SOURCE_DRIFT');
  for (const [n, h] of Object.entries(i.sourceBindingsSha256 || {}))
    requireValue(sha(fs.readFileSync(path.join(ROOT, n))) === h, 'OBSERVER_DESIGN_DRIFT');
  const r6 = path.join(ROOT, 'docs/v2/candidates/m5-handoff/inventory.json'),
    r = fs.readFileSync(r6),
    h = JSON.parse(r);
  requireValue(sha(r) === i.r6InventorySha256, 'R6_SOURCE_DRIFT');
  for (const [n, s] of Object.entries(h.filesSha256))
    requireValue(sha(fs.readFileSync(path.join(path.dirname(r6), n))) === s, 'R6_SOURCE_DRIFT');
  for (const [n, s] of Object.entries(h.sourceBindingsSha256))
    requireValue(sha(fs.readFileSync(path.join(ROOT, n))) === s, 'R6_SOURCE_DRIFT');
  return {
    observerInventorySha256: sha(raw),
    r6InventorySha256: sha(r),
    migrationSha256: h.migration.aggregateSha256,
  };
}
function approval(file, publicKeyPath, trustedPublicKeySha256) {
  requireValue(/^[a-f0-9]{64}$/.test(trustedPublicKeySha256), 'EXTERNAL_PIN_REQUIRED');
  const publicBytes = bytes(publicKeyPath),
    key = crypto.createPublicKey(publicBytes);
  requireValue(
    key.asymmetricKeyType === 'ed25519' &&
      sha(key.export({ type: 'spki', format: 'der' })) === trustedPublicKeySha256,
    'AUTHORITY_PIN',
  );
  const raw = bytes(file),
    e = JSON.parse(raw);
  keys(e, ['payload', 'signature']);
  requireValue(
    typeof e.signature === 'string' &&
      /^[A-Za-z0-9+/]{86}==$/.test(e.signature) &&
      crypto.verify(
        null,
        Buffer.from(canonical(e.payload)),
        key,
        Buffer.from(e.signature, 'base64'),
      ),
    'APPROVAL_SIGNATURE',
  );
  const v = e.payload;
  keys(v, [
    'formatVersion',
    'purpose',
    'status',
    'evidenceOrigin',
    'githubActions',
    'humanAuthorizationRef',
    'approvalId',
    'attemptId',
    'issuedAt',
    'expiresAt',
    'source',
    'target',
    'paths',
    'hashes',
    'lock',
    'configurationClosure',
    'binarySha256',
    'expectedStartArgumentsSha256',
    'scope',
  ]);
  requireValue(
    v.formatVersion === 1 &&
      v.purpose === 'LOCAL_MANAGEMENT_READONLY_OBSERVATION' &&
      v.status === 'ISSUED' &&
      v.evidenceOrigin === 'LOCAL' &&
      v.githubActions === false,
    'APPROVAL_PURPOSE',
  );
  for (const k of ['approvalId', 'attemptId'])
    requireValue(/^[a-zA-Z0-9_-]{8,64}$/.test(v[k]), 'APPROVAL_ID');
  requireValue(
    typeof v.humanAuthorizationRef === 'string' &&
      v.humanAuthorizationRef.length >= 8 &&
      v.humanAuthorizationRef.length <= 256,
    'HUMAN_AUTHORIZATION_REF',
  );
  requireValue(
    Number.isSafeInteger(v.issuedAt) &&
      Number.isSafeInteger(v.expiresAt) &&
      v.issuedAt <= Date.now() &&
      v.expiresAt > Date.now() &&
      v.expiresAt - v.issuedAt <= 300000,
    'APPROVAL_TTL',
  );
  keys(v.source, ['observerInventorySha256', 'r6InventorySha256', 'migrationSha256']);
  requireValue(canonical(v.source) === canonical(sources()), 'APPROVAL_SOURCE');
  keys(v.target, ['environment', 'dataDirectory', 'systemIdentifier', 'port', 'uid']);
  requireValue(
    v.target.uid === process.getuid() && /^[1-9][0-9]*$/.test(v.target.systemIdentifier),
    'TARGET_OWNER_IDENTITY',
  );
  if (v.target.environment === 'LOCAL_DEV')
    requireValue(
      v.target.dataDirectory === '/home/zxm/.local/share/zhiban-m1/pgdata' &&
        v.target.port === 55433 &&
        v.target.systemIdentifier === '7694054813252049413',
      'REAL_TARGET',
    );
  else
    requireValue(
      v.target.environment === 'LOCAL_DISPOSABLE' &&
        /^\/tmp\/zhiban-observer-pg16-[A-Za-z0-9_-]+\/data$/.test(v.target.dataDirectory) &&
        v.target.port === 56497,
      'DISPOSABLE_TARGET',
    );
  keys(v.paths, [
    'controlDirectory',
    'stageDirectory',
    'pgpassFilePath',
    'authenticationStageDirectory',
  ]);
  directory(v.paths.controlDirectory);
  requireValue(
    v.paths.pgpassFilePath !== path.join(v.paths.controlDirectory, 'maintenance.json') &&
      !v.paths.pgpassFilePath.startsWith(v.target.dataDirectory + '/') &&
      !v.paths.pgpassFilePath.startsWith(v.paths.controlDirectory + '/'),
    'SEPARATE_AUTH_STAGING',
  );
  requireValue(
    path.dirname(v.paths.stageDirectory) === v.paths.controlDirectory &&
      path.basename(v.paths.stageDirectory) === 'observe-' + v.attemptId &&
      !fs.existsSync(v.paths.stageDirectory) &&
      !v.paths.controlDirectory.startsWith(v.target.dataDirectory + '/'),
    'FRESH_STAGE',
  );
  requireValue(v.paths.controlDirectory !== v.target.dataDirectory, 'SEPARATE_CONTROL_ROOT');
  directory(path.dirname(v.paths.pgpassFilePath));
  requireValue(
    v.paths.authenticationStageDirectory ===
      path.join(path.dirname(v.paths.pgpassFilePath), 'observe-auth-' + v.attemptId) &&
      !fs.existsSync(v.paths.authenticationStageDirectory),
    'FRESH_AUTHENTICATION_STAGE',
  );
  keys(v.hashes, ['guardSha256', 'pgpassSha256', 'configurationClosureSha256']);
  for (const s of Object.values(v.hashes)) requireValue(/^[a-f0-9]{64}$/.test(s), 'APPROVAL_HASH');
  keys(v.lock, ['device', 'inode']);
  requireValue(
    Number.isSafeInteger(v.lock.device) && Number.isSafeInteger(v.lock.inode),
    'LOCK_BINDING',
  );
  keys(v.binarySha256, ['postgres', 'pg_ctl', 'psql', 'pg_controldata', 'node']);
  for (const s of Object.values(v.binarySha256))
    requireValue(/^[a-f0-9]{64}$/.test(s), 'BINARY_HASH');
  requireValue(
    Array.isArray(v.configurationClosure) &&
      v.configurationClosure.length >= 2 &&
      v.configurationClosure.length <= 32,
    'CONFIGURATION_CLOSURE',
  );
  for (const x of v.configurationClosure) {
    keys(x, ['path', 'sha256']);
    requireValue(/^[a-f0-9]{64}$/.test(x.sha256), 'CONFIGURATION_HASH');
  }
  requireValue(
    sha(Buffer.from(canonical(v.configurationClosure))) === v.hashes.configurationClosureSha256,
    'CONFIGURATION_CLOSURE_HASH',
  );
  requireValue(/^[a-f0-9]{64}$/.test(v.expectedStartArgumentsSha256), 'START_ARGUMENTS_HASH');
  keys(v.scope, [
    'managementReadOnly',
    'internalLifecycleWrites',
    'privateAuthenticationStaging',
    'businessWrites',
    'launch',
    'clear',
    'receiptIssuance',
    'credentialMutation',
    'persistentConfigurationMutation',
  ]);
  requireValue(
    v.scope.managementReadOnly === true &&
      v.scope.internalLifecycleWrites === true &&
      v.scope.privateAuthenticationStaging === true &&
      Object.entries(v.scope)
        .filter(
          ([k]) =>
            ![
              'managementReadOnly',
              'internalLifecycleWrites',
              'privateAuthenticationStaging',
            ].includes(k),
        )
        .every(([, x]) => x === false),
    'OBSERVATION_SCOPE',
  );
  return { value: v, approvalSha256: sha(raw) };
}
const bin = '/usr/lib/postgresql/16/bin';
function argumentsFor(v) {
  const template = JSON.parse(fs.readFileSync(path.join(HERE, 'request.template.json')));
  const overrides = {
    ...template.fixedServerOverrides,
    port: String(v.target.port),
    unix_socket_group: '',
    bonjour: 'off',
    config_file: path.join(v.paths.stageDirectory, 'postgresql.conf'),
    data_directory: v.target.dataDirectory,
    hba_file: path.join(v.paths.stageDirectory, 'pg_hba.conf'),
    ident_file: path.join(v.paths.stageDirectory, 'pg_ident.conf'),
    unix_socket_directories: path.join(v.paths.stageDirectory, 'socket'),
  };
  return [
    '-D',
    v.target.dataDirectory,
    ...Object.entries(overrides).flatMap(([k, x]) => ['-c', k + '=' + x]),
  ];
}
function writeNew(file, data, mode = 0o600) {
  const fd = fs.openSync(
    file,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
    mode,
  );
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDir(path.dirname(file));
}
function syncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function journal(stage, event) {
  const fd = fs.openSync(
    path.join(stage, 'journal.jsonl'),
    fs.constants.O_APPEND | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    // Separate OFDs serialize complete records, including any short-write retries.
    require('node:child_process').execFileSync('/usr/bin/flock', ['-x', '-w', '2', '3'], {
      stdio: ['ignore', 'ignore', 'ignore', fd],
      timeout: 2500,
    });
    const raw = Buffer.from(JSON.stringify({ ...event, time: Date.now() }) + '\n');
    let offset = 0;
    while (offset < raw.length) {
      const n = fs.writeSync(fd, raw, offset, raw.length - offset);
      requireValue(
        Number.isInteger(n) && n > 0 && n <= raw.length - offset,
        'JOURNAL_WRITE_INCOMPLETE',
      );
      offset += n;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
module.exports = {
  HERE,
  ROOT,
  bin,
  sha,
  canonical,
  requireValue,
  keys,
  directory,
  bytes,
  sources,
  approval,
  argumentsFor,
  writeNew,
  syncDir,
  journal,
};
