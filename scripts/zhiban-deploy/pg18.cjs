/* eslint-disable @typescript-eslint/no-require-imports -- Versioned bootstrap before application startup. */
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process'),
  crypto = require('node:crypto');
const { privatePath, ancestors } = require('../zhiban-portable.cjs');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const bin = process.env.ZHIBAN_PG18_BIN || '/usr/lib/postgresql/18/bin';
const baseEnv = { ...process.env, ZHIBAN_LOCAL_PG_PROFILE: 'PG18_V1', ZHIBAN_PG18_BIN: bin };
function check(v, reason) {
  if (!v) throw Error(reason);
}
function binary() {
  check(path.isAbsolute(bin) && path.normalize(bin) === bin, 'Absolute PG18 binaries required');
  check(
    /^postgres \(PostgreSQL\) 18\./.test(
      cp.execFileSync(path.join(bin, 'postgres'), ['--version'], { encoding: 'utf8' }),
    ),
    'Actual PG18 binary required',
  );
}
function privateState(root, create) {
  check(
    path.isAbsolute(root) && path.normalize(root) === root && root !== '/',
    'Canonical private state path required',
  );
  ancestors(root);
  if (!fs.existsSync(root)) {
    check(create, 'PG18 state not found');
    fs.mkdirSync(root, { mode: 0o700 });
  }
  privatePath(root, true);
  const p = path.join(root, 'STATE.json'),
    pin = JSON.parse(fs.readFileSync('docs/v2/candidates/openmaic-130/pin-pg18.json'));
  if (!fs.existsSync(p)) {
    check(create, 'PG18 state marker missing');
    fs.writeFileSync(
      p,
      JSON.stringify({
        kind: 'PG18_LOCAL_STATE_V1',
        applicationVersion: '1.3.0',
        root,
        major: 18,
        origin: 'https://127.0.0.1:3478',
        lineage: 'PG18_FRESH_V1',
        referenceSha256: pin.sha256,
      }),
      { mode: 0o600, flag: 'wx' },
    );
  }
  privatePath(p);
  const m = JSON.parse(fs.readFileSync(p));
  check(
    m.kind === 'PG18_LOCAL_STATE_V1' &&
      m.applicationVersion === '1.3.0' &&
      m.root === root &&
      m.major === 18 &&
      m.origin === 'https://127.0.0.1:3478' &&
      m.lineage === 'PG18_FRESH_V1' &&
      m.referenceSha256 === pin.sha256,
    'PG18 state/reference binding rejected',
  );
  return {
    ...baseEnv,
    ZHIBAN_LOCAL_STATE: root,
    ZHIBAN_PG18_LINEAGE: m.lineage || 'PG18_FRESH_V1',
    ZHIBAN_LOCAL_TLS_DIRECTORY: path.join(root, 'tls'),
    ZHIBAN_LOCAL_STARTUP_TRACE: path.join(root, 'startup-start.jsonl'),
  };
}
function tls(root) {
  const dir = path.join(root, 'tls');
  if (fs.existsSync(dir)) {
    privatePath(dir, true);
    return;
  }
  fs.mkdirSync(dir, { mode: 0o700 });
  const run = (a) => cp.execFileSync('openssl', a, { stdio: 'pipe' });
  run([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    path.join(dir, 'ca.key'),
    '-out',
    path.join(dir, 'development-ca.crt'),
    '-days',
    '30',
    '-subj',
    '/CN=Zhiban PG18 disposable CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
  ]);
  run([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    path.join(dir, 'localhost.key'),
    '-out',
    path.join(dir, 'leaf.csr'),
    '-subj',
    '/CN=127.0.0.1',
  ]);
  fs.writeFileSync(
    path.join(dir, 'leaf.ext'),
    'subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n',
    { mode: 0o600 },
  );
  run([
    'x509',
    '-req',
    '-in',
    path.join(dir, 'leaf.csr'),
    '-CA',
    path.join(dir, 'development-ca.crt'),
    '-CAkey',
    path.join(dir, 'ca.key'),
    '-CAcreateserial',
    '-out',
    path.join(dir, 'localhost.crt'),
    '-days',
    '14',
    '-extfile',
    path.join(dir, 'leaf.ext'),
  ]);
  fs.writeFileSync(
    path.join(dir, 'receipt.json'),
    JSON.stringify({
      kind: 'PG18_SYNTHETIC_TLS_V1',
      certificateHash: hash(fs.readFileSync(path.join(dir, 'localhost.crt'))),
      caCertificateHash: hash(fs.readFileSync(path.join(dir, 'development-ca.crt'))),
      scope: 'PRIVATE_CA_NOT_INSTALLED_GLOBALLY',
    }),
    { mode: 0o600 },
  );
  for (const n of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, n), 0o600);
}
async function child(script, args, env) {
  const c = cp.spawn(process.execPath, ['--import', 'tsx', script, ...args], {
    env,
    stdio: 'inherit',
  });
  const stop = () => c.kill('SIGTERM');
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const code = await new Promise((resolve, reject) => {
    c.once('error', reject);
    c.once('exit', (n) => resolve(n ?? 1));
  });
  process.removeListener('SIGTERM', stop);
  process.removeListener('SIGINT', stop);
  return code;
}
async function main() {
  check(!process.env.DATABASE_URL, 'PG18 isolated entry refuses external DATABASE_URL');
  binary();
  const [action, root, ...rest] = process.argv.slice(2);
  if (action === 'reference') {
    check(!process.env.ZHIBAN_PG18_LINEAGE, 'Reference builder accepts no target lineage');
    check(root === undefined || root === '--verify', 'Use reference [--verify]');
    check(rest.length === 0, 'Unexpected argument');
    const dir = fs.mkdtempSync(path.join(process.cwd(), '.zhiban-pg18-tools-'));
    fs.chmodSync(dir, 0o700);
    try {
      require('esbuild').buildSync({
        entryPoints: ['scripts/zhiban-deploy/build-openmaic-130-reference.ts'],
        outfile: path.join(dir, 'tool.mjs'),
        bundle: true,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        banner: {
          js: 'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);',
        },
        logLevel: 'warning',
      });
      const r = cp.spawnSync(
        process.execPath,
        [path.join(dir, 'tool.mjs'), ...(root ? [root] : [])],
        { env: baseEnv, stdio: 'inherit', timeout: 180000 },
      );
      check(r.status === 0, 'PG18 reference construction failed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return;
  }
  check(
    [
      'install',
      'start',
      'accept',
      'stop',
      'info',
      'backup',
      'verify',
      'recover',
      'select',
    ].includes(action) &&
      root &&
      (action === 'select' ? rest.length === 1 : rest.length === 0),
    'Use reference [--verify] | install/start/accept/stop/info/backup/verify/recover ABSOLUTE_STATE | select ABSOLUTE_STATE SNAPSHOT',
  );
  const env = privateState(root, ['install', 'accept'].includes(action));
  if (['install', 'start', 'accept'].includes(action)) {
    tls(root);
    if (!env.OPENMAIC_CONFIG) {
      const config = path.join(root, 'unconfigured-services.json');
      if (!fs.existsSync(config))
        fs.writeFileSync(
          config,
          JSON.stringify({
            providers: {},
            slots: { llm: null, image: null, video: null, tts: null, asr: null, document: null },
            allowUserKeys: false,
          }),
          { mode: 0o600, flag: 'wx' },
        );
      env.OPENMAIC_CONFIG = config;
    }
  }
  if (action === 'install' || action === 'accept')
    check(
      !fs.existsSync(path.join(root, 'snapshots/latest.json')) &&
        !fs.existsSync(path.join(root, 'RUNTIME.json')),
      'State already used; use start or retain failed generation and choose a new state',
    );
  if (action === 'start')
    check(
      fs.existsSync(path.join(root, 'snapshots/latest.json')),
      'PG18 snapshot required; refusing accidental initialization',
    );
  if (action === 'stop' || action === 'info') {
    const m = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-pg18-demo-local.json'));
    check(m.stateRoot === root && m.postgresMajor === 18, 'PG18 active state binding rejected');
    process.exitCode = await child(
      'scripts/zhiban-local/trial-control.ts',
      [action, '--unified-trial'],
      env,
    );
    return;
  }
  if (['backup', 'verify', 'recover', 'select'].includes(action)) {
    process.exitCode = await child(
      'scripts/zhiban-local/persistent-snapshot.ts',
      [action, ...rest],
      env,
    );
    return;
  }
  process.exitCode = await child(
    'scripts/zhiban-local/run-m6-catalog.ts',
    [
      '--unified-trial',
      ...(action === 'accept'
        ? ['--pg18-acceptance']
        : ['--serve', '--persistent', ...(action === 'start' ? ['--resume'] : [])]),
    ],
    env,
  );
}
module.exports = {
  privateState,
  binary,
  prepareSyntheticTls: (root) => {
    privatePath(root, true);
    tls(root);
  },
};
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
