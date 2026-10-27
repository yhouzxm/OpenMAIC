#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated deployment supervisor. */
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process');
const { privatePath, ancestors } = require('../zhiban-portable.cjs');
const check = (v, s) => {
  if (!v) throw Error(s);
};
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const save = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
function context() {
  if (process.env.GITHUB_ACTIONS !== 'true')
    return { evidenceOrigin: 'LOCAL', githubActions: false };
  check(
    process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '') &&
      process.env.APPROVED_WORKFLOW_SHA === process.env.GITHUB_SHA &&
      /^\d+$/.test(process.env.GITHUB_RUN_ID || '') &&
      /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || ''),
    'Approved manual GitHub context required',
  );
  return {
    evidenceOrigin: 'GITHUB_ACTIONS',
    githubActions: true,
    run: {
      sha: process.env.GITHUB_SHA,
      id: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
    },
  };
}
function environment() {
  const env = { ...process.env, ZHIBAN_LOCAL_PG_PROFILE: 'PG18_V1' };
  for (const k of Object.keys(env))
    if (
      /^(?:DATABASE_URL|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGPASSFILE|PGSERVICE|PGOPTIONS|GH_TOKEN|GITHUB_TOKEN|ACTIONS_.*TOKEN|OPENMAIC_|OPENAI_|ANTHROPIC_|GLM_|ZHIBAN_SCANNER_|ZHIBAN_MATERIAL_|ZHIBAN_LOCAL_STATE|ZHIBAN_LOCAL_TLS_DIRECTORY|ZHIBAN_PG18_LINEAGE)/.test(
        k,
      )
    )
      delete env[k];
  return env;
}
function checkedBase(base) {
  check(
    path.isAbsolute(base) && path.normalize(base) === base && base !== '/',
    'Canonical private base required',
  );
  ancestors(base);
  privatePath(base, true);
}
async function runCommand(base, args, label, extra = {}) {
  const fd = fs.openSync(path.join(base, label + '.log'), 'a', 0o600),
    env = { ...environment(), ...extra };
  const child = cp.spawn(process.execPath, args, { env, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => {
          child.kill('SIGTERM');
          reject(Error('COMMAND_TIMEOUT'));
        },
        25 * 60 * 1000,
      );
      child.once('error', () => reject(Error('COMMAND_SPAWN_FAILED')));
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(Error('COMMAND_FAILED_' + label)),
      );
    });
  } finally {
    clearTimeout(timer);
  }
}
async function host(base, action) {
  const fd = fs.openSync(path.join(base, 'host-' + action + '.log'), 'a', 0o600),
    state = path.join(base, 'instance');
  const c = cp.spawn(process.execPath, ['scripts/zhiban-deploy/pg18.cjs', action, state], {
    env: environment(),
    stdio: ['ignore', fd, fd],
  });
  fs.closeSync(fd);
  c.on('error', () => {});
  const began = Date.now();
  while (Date.now() - began < 15 * 60 * 1000) {
    if (c.exitCode !== null) throw Error('HOST_EXITED_' + action);
    let m;
    try {
      m = json('docs/v2/evidence/zhiban-pg18-demo-local.json');
    } catch {
      /* not ready */
    }
    if (
      m?.stateRoot === state &&
      m.postgresMajor === 18 &&
      m.status === 'RUNNING_LOCAL_PERSISTENT' &&
      fs.existsSync('/proc/' + m.pid + '/stat') &&
      m.pid !== json(path.join(base, 'HOST.json')).previousPid
    ) {
      save(path.join(base, 'HOST.json'), { previousPid: m.pid, launcher: c.pid });
      return c;
    }
    await delay(500);
  }
  c.kill('SIGTERM');
  throw Error('HOST_TIMEOUT_' + action);
}
async function stop(base, c) {
  await runCommand(
    base,
    ['scripts/zhiban-deploy/pg18.cjs', 'stop', path.join(base, 'instance')],
    'stop',
  );
  if (c.exitCode === null)
    await Promise.race([new Promise((r) => c.once('exit', r)), delay(60000)]);
  check(c.exitCode === 0, 'HOST_SHUTDOWN_FAILED');
  await runCommand(
    base,
    ['scripts/zhiban-deploy/pg18.cjs', 'verify', path.join(base, 'instance')],
    'snapshot-verify',
  );
}
async function cleanup(base) {
  checkedBase(base);
  for (const name of ['directed', 'instance']) {
    const state = path.join(base, name),
      marker = path.join(state, 'RUNTIME.json');
    if (!fs.existsSync(marker)) continue;
    privatePath(state, true);
    privatePath(marker);
    const r = json(marker);
    check(
      r.kind === 'PG18_OWNED_RUNTIME_V1' &&
        r.major === 18 &&
        /^\/tmp\/zhiban-trial-content-[a-zA-Z0-9]+$/.test(r.root) &&
        r.socket === r.root + '/socket' &&
        r.port === 56517,
      'Owned runtime marker rejected',
    );
    if (!fs.existsSync(r.root)) continue;
    privatePath(r.root, true);
    if (fs.existsSync('/proc/' + r.pid + '/stat')) {
      const start = fs
          .readFileSync('/proc/' + r.pid + '/stat', 'utf8')
          .split(') ')[1]
          .trim()
          .split(/\s+/)[19],
        args = fs.readFileSync('/proc/' + r.pid + '/cmdline', 'utf8').split('\0');
      check(
        start === r.processStart &&
          args[1] === r.build &&
          path.dirname(r.build).startsWith(path.join(process.cwd(), '.zhiban-catalog-run-')) &&
          path.basename(r.build) === 'verify.mjs' &&
          require('node:crypto')
            .createHash('sha256')
            .update(fs.readFileSync(r.build))
            .digest('hex') === r.buildSha256,
        'Runtime process binding rejected',
      );
      process.kill(r.pid, 'SIGTERM');
      for (let i = 0; i < 120 && fs.existsSync('/proc/' + r.pid + '/stat'); i++) await delay(500);
      check(!fs.existsSync('/proc/' + r.pid + '/stat'), 'Host still active; material retained');
    }
    const pidfile = path.join(r.root, 'data/postmaster.pid');
    if (fs.existsSync(pidfile)) {
      const pid = Number(fs.readFileSync(pidfile, 'utf8').split('\n')[0]);
      check(
        Number.isSafeInteger(pid) && pid > 1,
        'Incomplete postmaster identity; private target retained',
      );
      const args = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0');
      check(
        args[0] ===
          path.join(process.env.ZHIBAN_PG18_BIN || '/usr/lib/postgresql/18/bin', 'postgres') &&
          args.includes(path.join(r.root, 'data')),
        'Postmaster binding rejected',
      );
      cp.execFileSync(
        path.join(process.env.ZHIBAN_PG18_BIN || '/usr/lib/postgresql/18/bin', 'pg_ctl'),
        ['-D', path.join(r.root, 'data'), '-m', 'fast', '-w', 'stop'],
        { stdio: 'pipe', timeout: 60000 },
      );
    }
    check(!fs.existsSync(pidfile), 'Refusing cleanup of live database');
    fs.rmSync(r.root, { recursive: true, force: true });
  }
}
async function main() {
  const [action, base, report] = process.argv.slice(2);
  check(
    ['run', 'cleanup'].includes(action) && base,
    'Use run PRIVATE_BASE REPORT | cleanup PRIVATE_BASE',
  );
  checkedBase(base);
  if (action === 'cleanup') {
    await cleanup(base);
    return;
  }
  check(
    report && path.isAbsolute(report) && !fs.existsSync(report),
    'New absolute public report required',
  );
  const identity = context(),
    phases = [];
  let current = 'reference',
    child;
  check(
    !fs.existsSync(path.join(base, 'HOST.json')) && !fs.existsSync(path.join(base, 'instance')),
    'Fresh acceptance base required',
  );
  save(path.join(base, 'HOST.json'), { previousPid: null });
  const began = Date.now();
  try {
    await runCommand(
      base,
      ['scripts/zhiban-deploy/pg18.cjs', 'reference', '--verify'],
      'reference',
    );
    phases.push('INDEPENDENT_REFERENCE_REBUILD');
    current = 'directed-product';
    await runCommand(
      base,
      ['scripts/zhiban-deploy/pg18.cjs', 'accept', path.join(base, 'directed')],
      'directed',
    );
    phases.push('PG18_NATIVE_PUBLICATION_RUNTIME_AUTHORIZATION_AND_NEGATIVE_GATES');
    current = 'install';
    child = await host(base, 'install');
    await runCommand(
      base,
      [
        '--import',
        'tsx',
        'scripts/zhiban-deploy/pg18-readback.ts',
        'capture',
        path.join(base, 'baseline.json'),
        path.join(base, 'capture.json'),
      ],
      'capture',
      { ZHIBAN_LOCAL_STATE: path.join(base, 'instance') },
    );
    phases.push('FRESH_INSTALL_THREE_ROLES_HTTPS_AND_PRIVATE_BASELINE');
    current = 'live-backup';
    await runCommand(
      base,
      ['scripts/zhiban-deploy/pg18.cjs', 'backup', path.join(base, 'instance')],
      'live-backup',
    );
    const liveBackup = json(path.join(base, 'instance/snapshots/latest.json')).path;
    phases.push('PG18_LIVE_BASEBACKUP');
    await stop(base, child);
    child = null;
    current = 'restore';
    child = await host(base, 'start');
    await runCommand(
      base,
      [
        '--import',
        'tsx',
        'scripts/zhiban-deploy/pg18-readback.ts',
        'compare',
        path.join(base, 'baseline.json'),
        path.join(base, 'compare.json'),
      ],
      'compare',
      { ZHIBAN_LOCAL_STATE: path.join(base, 'instance') },
    );
    phases.push('OFFLINE_SNAPSHOT_RESTORE_IDENTICAL_ROWS_ACCOUNTS_THREE_ROLES');
    await stop(base, child);
    child = null;
    current = 'live-backup-restore';
    await runCommand(
      base,
      ['scripts/zhiban-deploy/pg18.cjs', 'select', path.join(base, 'instance'), liveBackup],
      'select-live-backup',
    );
    child = await host(base, 'start');
    await runCommand(
      base,
      [
        '--import',
        'tsx',
        'scripts/zhiban-deploy/pg18-readback.ts',
        'compare',
        path.join(base, 'baseline.json'),
        path.join(base, 'live-compare.json'),
      ],
      'live-compare',
      { ZHIBAN_LOCAL_STATE: path.join(base, 'instance') },
    );
    phases.push('LIVE_BASEBACKUP_RESTORE_IDENTICAL_ROWS_ACCOUNTS_THREE_ROLES');
    await stop(base, child);
    child = null;
    save(report, {
      status: 'PASS',
      ...identity,
      postgresMajor: 18,
      referenceSha256: json('docs/v2/candidates/pg18-provider-v1/pin.json').sha256,
      sourceSha: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      phases,
      elapsedMs: Date.now() - began,
      privateMaterialsUploaded: false,
      scope: 'SYNTHETIC_PG18_FRESH_INSTALL_AND_SAME_MAJOR_RESTORE',
      excluded: [
        'PG16_IMPORTED_ACTIVATION',
        'CLOUD_PRODUCTION',
        'EXTERNAL_PROVIDERS',
        'OLD_NATIVE_MAINTENANCE',
      ],
    });
  } catch (e) {
    save(report, {
      status: 'FAIL',
      ...identity,
      postgresMajor: 18,
      phase: current,
      completed: phases,
      elapsedMs: Date.now() - began,
      diagnostic: 'PRIVATE_LOGS_RETAINED_LOCALLY_NOT_UPLOADED',
    });
    throw e;
  } finally {
    if (child) await stop(base, child).catch(() => {});
  }
  console.log(
    'PASS PG18 install, three roles, live backup and normal restore; public summary written',
  );
}
module.exports = { context, environment, checkedBase, cleanup };
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
