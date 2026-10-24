// Pure release contract helpers. No repository resolver, signer or installer dependency.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const ROLE = [
  'zhiban_auth_runtime',
  'zhiban_runtime',
  'zhiban_control_runtime',
  'zhiban_academic_runtime',
  'zhiban_bridge_runtime',
  'zhiban_openmaic_runtime',
];
const HASH = /^[a-f0-9]{64}$/,
  UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}
function insist(ok, why) {
  if (!ok) throw Error(why);
}
function keys(v, names) {
  insist(
    v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      canonical(Object.keys(v).sort()) === canonical([...names].sort()),
    'Closed release contract rejected',
  );
}
function relative(p) {
  insist(
    typeof p === 'string' &&
      p.length &&
      !p.startsWith('/') &&
      !p.includes('\\') &&
      !p.includes('\0') &&
      !p.split('/').some((x) => !x || x === '.' || x === '..'),
    'Closed release path rejected',
  );
}
function bytes(p, privateMode = true) {
  insist(path.isAbsolute(p) && fs.realpathSync(p) === p, 'Canonical leaf required');
  if (privateMode) directory(path.dirname(p));
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const s = fs.fstatSync(fd);
    insist(
      s.isFile() &&
        s.nlink === 1 &&
        s.size < (privateMode ? 32 : 512) * 1024 * 1024 &&
        (!privateMode || (s.uid === process.getuid() && !(s.mode & 0o077))),
      'Release leaf rejected',
    );
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function directory(p) {
  const s = fs.lstatSync(p);
  insist(
    path.isAbsolute(p) &&
      fs.realpathSync(p) === p &&
      s.isDirectory() &&
      s.uid === process.getuid() &&
      !(s.mode & 0o077),
    'Release directory rejected',
  );
}
function signed(raw, pub, purpose, fields) {
  const e = JSON.parse(raw);
  keys(e, ['payload', 'signature']);
  const p = e.payload;
  keys(p, fields);
  const pin = crypto.createPublicKey(pub);
  insist(
    pin.asymmetricKeyType === 'ed25519' &&
      p.formatVersion === 1 &&
      p.evidenceOrigin === 'LOCAL' &&
      p.githubActions === false &&
      p.purpose === purpose &&
      p.authorityKeySha256 === sha(pin.export({ format: 'der', type: 'spki' })) &&
      typeof e.signature === 'string' &&
      Buffer.from(e.signature, 'base64').length === 64 &&
      crypto.verify(null, Buffer.from(canonical(p)), pin, Buffer.from(e.signature, 'base64')),
    'Release signed purpose rejected',
  );
  return p;
}
function config(v, release, credential) {
  keys(v, [
    'formatVersion',
    'profile',
    'releaseId',
    'credentialGenerationId',
    'deploymentId',
    'target',
    'identity',
    'connections',
    'readSecret',
  ]);
  insist(
    v.formatVersion === 1 &&
      v.profile === 'ordinary-host-after-terminal-local-v1' &&
      v.releaseId === release &&
      v.credentialGenerationId === credential &&
      UUID.test(v.deploymentId) &&
      HASH.test(v.readSecret),
    'Ordinary configuration rejected',
  );
  keys(v.target, [
    'environment',
    'cluster',
    'businessOid',
    'nativeOid',
    'dataDirectory',
    'socketDirectory',
    'port',
    'origin',
  ]);
  const t = v.target;
  insist(
    t.origin === 'https://127.0.0.1:3443' &&
      /^[1-9][0-9]*$/.test(t.cluster) &&
      /^[1-9][0-9]*$/.test(t.businessOid) &&
      /^[1-9][0-9]*$/.test(t.nativeOid) &&
      t.businessOid !== t.nativeOid,
    'Target binding rejected',
  );
  if (t.environment === 'LOCAL_DEV')
    insist(
      t.port === 55433 &&
        t.dataDirectory === '/home/zxm/.local/share/zhiban-m1/pgdata' &&
        t.socketDirectory === '/home/zxm/.local/share/zhiban-m1/socket',
      'Development endpoint rejected',
    );
  else
    insist(
      t.environment === 'LOCAL_DISPOSABLE' &&
        t.port === 56496 &&
        t.dataDirectory.startsWith('/tmp/zhiban-release-pg16-') &&
        t.socketDirectory.startsWith('/tmp/zhiban-release-pg16-'),
      'Dedicated TCP fixture required',
    );
  insist(
    Array.isArray(v.connections) &&
      canonical(v.connections.map((x) => x.role).sort()) === canonical([...ROLE].sort()),
    'Exact six ordinary roles required',
  );
  for (const c of v.connections) {
    keys(c, ['role', 'database', 'password']);
    insist(
      c.database ===
        (c.role === 'zhiban_openmaic_runtime' ? 'zhiban_m5_native' : 'zhiban_m1_dev') &&
        HASH.test(c.password),
      'Ordinary credential shape rejected',
    );
  }
  keys(v.identity, ['manifest', 'composition']);
  keys(v.identity.composition, [
    'origin',
    'sessionPolicy',
    'catalog',
    'admission',
    'corpus',
    'operator',
    'membership',
    'transportApprovalRef',
    'deployment',
  ]);
  keys(v.identity.composition.admission, [
    'environment',
    'approvalRef',
    'hmacKey',
    'policyDigests',
  ]);
  keys(v.identity.composition.admission.policyDigests, [
    'LOGIN',
    'REAUTHENTICATE',
    'PASSWORD_CHANGE',
    'INITIAL_PROVISION',
  ]);
  keys(v.identity.composition.corpus, ['approvalRef', 'expectedDigest', 'values']);
  keys(v.identity.composition.sessionPolicy, ['absoluteMs', 'idleMs']);
  keys(v.identity.composition.catalog, ['roleIds', 'approvalRecord', 'expectedDigest']);
  keys(v.identity.manifest, [
    'approvalRef',
    'networkApprovalRef',
    'migrationPreflightRef',
    'operationalAcceptanceRef',
    'backendPrivate',
    'fixedOverwritingProxy',
    'endpoint',
    'runtimeSecrets',
    'poolMax',
    'connectionTimeoutMs',
    'statementTimeoutMs',
    'policy',
  ]);
  keys(v.identity.manifest.endpoint, ['hostname', 'port', 'database']);
  keys(v.identity.manifest.runtimeSecrets, ['auth', 'tenant', 'control']);
  keys(v.identity.manifest.policy, [
    'origin',
    'concurrentRequests',
    'bodyTimeoutMs',
    'retryAfterSeconds',
  ]);
  insist(
    v.identity.composition.origin === t.origin &&
      v.identity.manifest.policy.origin === t.origin &&
      v.identity.manifest.backendPrivate === true &&
      v.identity.manifest.fixedOverwritingProxy === true &&
      v.identity.manifest.poolMax === 3 &&
      v.identity.manifest.connectionTimeoutMs === 3000 &&
      v.identity.manifest.statementTimeoutMs === 5000 &&
      v.identity.manifest.endpoint.hostname === '127.0.0.1' &&
      v.identity.manifest.endpoint.port === t.port &&
      v.identity.manifest.endpoint.database === 'zhiban_m1_dev' &&
      v.identity.composition.operator === null &&
      v.identity.composition.membership === null &&
      HASH.test(v.identity.composition.admission.hmacKey),
    'Frozen ordinary composition rejected',
  );
  return v;
}
module.exports = {
  ROLE,
  HASH,
  UUID,
  sha,
  canonical,
  insist,
  keys,
  relative,
  bytes,
  directory,
  signed,
  config,
};
