#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Disposable cloud source generation only. */
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process');
const { privatePath, ancestors } = require('../zhiban-portable.cjs');
const { prepareSyntheticTls } = require('./pg18.cjs');
const check = (v, m) => {
  if (!v) throw Error(m);
};
const read = (p) => JSON.parse(fs.readFileSync(p));
const pause = () => new Promise((r) => setTimeout(r, 500));
async function create(root) {
  check(
    path.isAbsolute(root) && path.normalize(root) === root && !fs.existsSync(root),
    'New absolute synthetic source namespace required',
  );
  ancestors(root);
  privatePath(path.dirname(root), true);
  fs.mkdirSync(root, { mode: 0o700 });
  prepareSyntheticTls(root);
  const env = {
    ...process.env,
    ZHIBAN_LOCAL_STATE: root,
    ZHIBAN_LOCAL_TLS_DIRECTORY: path.join(root, 'tls'),
    ZHIBAN_LOCAL_STARTUP_TRACE: path.join(root, 'startup-start.jsonl'),
  };
  for (const k of Object.keys(env))
    if (
      /^(DATABASE_URL|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGPASSFILE|PGSERVICE|PGOPTIONS|ZHIBAN_LOCAL_PG_PROFILE|ZHIBAN_PG18_LINEAGE|ZHIBAN_SCANNER_.*|ZHIBAN_MATERIAL_.*|OPENMAIC_.*|OPENAI_.*|GLM_.*|ANTHROPIC_.*)$/.test(
        k,
      )
    )
      delete env[k];
  const neutral = path.join(root, 'no-services.json');
  fs.writeFileSync(
    neutral,
    JSON.stringify({
      providers: {},
      slots: { llm: null, image: null, video: null, tts: null, asr: null, document: null },
      allowUserKeys: false,
    }),
    { mode: 0o600 },
  );
  env.OPENMAIC_CONFIG = neutral;
  const log = fs.openSync(path.join(root, 'host.log'), 'wx', 0o600);
  const child = cp.spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/zhiban-local/run-m6-catalog.ts',
      '--unified-trial',
      '--serve',
      '--persistent',
    ],
    { env, stdio: ['ignore', log, log] },
  );
  fs.closeSync(log);
  let cancelled = false,
    runtime;
  child.on('error', () => {});
  const interrupt = () => {
    cancelled = true;
    child.kill('SIGTERM');
  };
  process.once('SIGTERM', interrupt);
  process.once('SIGINT', interrupt);
  const exit = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  try {
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      check(!cancelled, 'Synthetic source interrupted');
      check(child.exitCode === null, 'Synthetic source host failed; private log retained');
      try {
        runtime = read(path.join(root, 'RUNTIME.json'));
        const m = read('docs/v2/evidence/zhiban-trial-content-demo-local.json');
        if (
          runtime.kind === 'PG16_OWNED_RUNTIME_V1' &&
          m.pid === runtime.pid &&
          m.root === runtime.root &&
          m.status === 'RUNNING_DISPOSABLE' &&
          m.origin === 'https://127.0.0.1:3461'
        )
          break;
        runtime = null;
      } catch {
        runtime = null;
      }
      await pause();
    }
    check(runtime, 'Synthetic source readiness timeout');
    const stat = fs
      .readFileSync(`/proc/${runtime.pid}/stat`, 'utf8')
      .split(') ')[1]
      .trim()
      .split(/\s+/)[19];
    check(stat === runtime.processStart, 'Synthetic worker identity changed');
    // Exercise the real instance-key provider so even a service-free synthetic source
    // has complete private recovery material. No real provider key or model is used.
    const keyLog = fs.openSync(path.join(root, 'instance-key.log'), 'wx', 0o600);
    try {
      cp.execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '-e',
          'const s=require("./lib/server/secret-box.ts");s.configureSecretStorageDirectory(require("node:path").join(process.argv[1],"native-secret"));s.instanceKey();',
          runtime.root,
        ],
        { env, stdio: ['ignore', keyLog, keyLog], timeout: 30000 },
      );
    } finally {
      fs.closeSync(keyLog);
    }
    // Signal the bound worker, then wait for the launcher to finish its normal snapshot and cleanup.
    process.kill(runtime.pid, 'SIGTERM');
    const code = await Promise.race([
      exit,
      new Promise((resolve) => {
        const t = setTimeout(() => resolve('timeout'), 90000);
        t.unref();
      }),
    ]);
    check(code === 0, 'Synthetic source failed to stop/save');
    privatePath(path.join(root, 'snapshots/latest.json'));
    return read(path.join(root, 'snapshots/latest.json'));
  } finally {
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGINT', interrupt);
    if (child.exitCode === null) child.kill('SIGTERM');
  }
}
module.exports = { create };
if (require.main === module)
  create(process.argv[2])
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
