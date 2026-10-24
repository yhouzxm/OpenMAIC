#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CI supervisor. */
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  cp = require('node:child_process'),
  https = require('node:https');
const { createHash } = require('node:crypto');
const portable = require('../zhiban-portable.cjs'),
  delivery = require('./portable-delivery.cjs');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const bin = '/usr/lib/postgresql/16/bin';
const failureCodes = new Set([
  'COMMAND_FAILED',
  'COMMAND_TIMEOUT',
  'HOST_SPAWN_FAILED',
  'HOST_EXITED',
  'HOST_IDENTITY_REJECTED',
  'HOST_METADATA_INVALID',
  'HOST_READINESS_TIMEOUT',
]);
const startupReasons = new Set([
  'NODE_HEAP_LIMIT',
  'DEPENDENCY_MISSING',
  'TYPESCRIPT_BUILD_FAILED',
  'UPSTREAM_SOURCE_REFUSED',
  'PRIVATE_PATH_REFUSED',
  'NATIVE_SDK_BUILD_FAILED',
  'PG_START_FAILED',
  'STORAGE_EXHAUSTED',
  'UNCLASSIFIED',
]);
function startupReason(base, mode) {
  if (!['start', 'start-rebind'].includes(mode)) return 'UNCLASSIFIED';
  const file = path.join(base, 'host-' + mode + '.log');
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077) return 'UNCLASSIFIED';
    const bytes = Buffer.alloc(Math.min(info.size, 1024 * 1024));
    fs.readSync(fd, bytes, 0, bytes.length, info.size - bytes.length);
    const text = bytes.toString('utf8');
    const rules = [
      ['NODE_HEAP_LIMIT', /JavaScript heap out of memory|Reached heap limit/],
      ['STORAGE_EXHAUSTED', /No space left on device|ENOSPC/],
      ['DEPENDENCY_MISSING', /ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)/],
      ['TYPESCRIPT_BUILD_FAILED', /error TS[0-9]+:/],
      [
        'UPSTREAM_SOURCE_REFUSED',
        /Upstream source pin mismatch|Quiz extension (?:pin rejected|source mismatch)/,
      ],
      [
        'PRIVATE_PATH_REFUSED',
        /Private owned (?:path|file\/directory) required|Local M1 files require owner-only/,
      ],
      [
        'NATIVE_SDK_BUILD_FAILED',
        /Command failed: pnpm --filter @openmaic\/(?:dsl|storage|editor|renderer|generation) build/,
      ],
      [
        'PG_START_FAILED',
        /pg_ctl: could not start server|FATAL:.*(?:database|shared memory|configuration)/,
      ],
    ];
    return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? 'UNCLASSIFIED';
  } catch {
    return 'UNCLASSIFIED';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
const signals = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV', 'SIGBUS']);
function safeFailure(value) {
  if (!value || !failureCodes.has(value.code)) return undefined;
  const out = { code: value.code };
  if (Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255)
    out.exitCode = value.exitCode;
  if (signals.has(value.signal)) out.signal = value.signal;
  if (Number.isSafeInteger(value.elapsedMs) && value.elapsedMs >= 0 && value.elapsedMs <= 5400000)
    out.elapsedMs = value.elapsedMs;
  if (['start', 'start-rebind'].includes(value.mode)) out.mode = value.mode;
  if (startupReasons.has(value.reason)) out.reason = value.reason;
  return out;
}
function failure(code, details = {}) {
  const error = new Error(code);
  error.diagnostic = safeFailure({ ...details, code });
  return error;
}
function ciContext(requireApproval = true) {
  check(
    process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch',
    'Manual real GitHub Actions context required',
  );
  check(
    /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') &&
      /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? ''),
    'Run identity required',
  );
  check(
    /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') &&
      (!requireApproval || process.env.GITHUB_SHA === process.env.APPROVED_WORKFLOW_SHA),
    'Approved workflow SHA required',
  );
  check(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(process.env.GITHUB_REPOSITORY ?? ''),
    'Repository identity rejected',
  );
}
function basePath(base) {
  portable.absolute(base);
  portable.ancestors(base);
  const temp = fs.realpathSync(process.env.RUNNER_TEMP ?? '/nonexistent-runner');
  check(
    base ===
      path.join(
        temp,
        'zhiban-portable-' + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT,
      ),
    'Runner-owned acceptance namespace required',
  );
  portable.privatePath(base, true);
}
function safeEnv(state) {
  const env = {
    ...process.env,
    ZHIBAN_LOCAL_STATE: state,
    ZHIBAN_LOCAL_TLS_DIRECTORY: path.join(state, 'tls'),
  };
  for (const key of Object.keys(env))
    if (
      /^(?:GH_TOKEN|GITHUB_TOKEN|ZHIBAN_PORTABLE_TRANSPORT_KEY|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|ACCEPTANCE_REPORT|GLM_|OPENAI_|ANTHROPIC_|ZHIBAN_SCANNER_|ZHIBAN_MATERIAL_)/.test(
        key,
      ) ||
      key === 'DEFAULT_MODEL'
    )
      delete env[key];
  return env;
}
function command(cmd, args, log, options = {}) {
  const fd = fs.openSync(log, 'a', 0o600);
  const began = Date.now();
  try {
    return cp.execFileSync(cmd, args, {
      stdio: ['ignore', fd, fd],
      timeout: 25 * 60 * 1000,
      ...options,
    });
  } catch (error) {
    throw failure(error.code === 'ETIMEDOUT' ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED', {
      exitCode: error.status,
      signal: error.signal,
      elapsedMs: Date.now() - began,
    });
  } finally {
    fs.closeSync(fd);
  }
}
function processStart(pid) {
  return fs
    .readFileSync('/proc/' + pid + '/stat', 'utf8')
    .split(') ')[1]
    .trim()
    .split(/\s+/)[19];
}
function hostMatches(record, base) {
  if (!base || record.bootstrap !== path.join(base, 'cargo/install/install.cjs')) return false;
  try {
    const args = fs.readFileSync('/proc/' + record.pid + '/cmdline', 'utf8').split('\0');
    return (
      fs.statSync('/proc/' + record.pid).uid === process.getuid() &&
      processStart(record.pid) === record.start &&
      args[1] === record.bootstrap &&
      ['start', 'start-rebind'].includes(args[2]) &&
      args[3] === path.join(base, 'workspace') &&
      args[4] === path.join(base, 'state') &&
      fs.readlinkSync('/proc/' + record.pid + '/cwd') === path.join(base, 'workspace')
    );
  } catch {
    return false;
  }
}
async function startHost(base, mode) {
  const kit = path.join(base, 'cargo/install'),
    workspace = path.join(base, 'workspace'),
    state = path.join(base, 'state');
  const bootstrap = path.join(kit, 'install.cjs'),
    fd = fs.openSync(path.join(base, 'host-' + mode + '.log'), 'a', 0o600);
  const child = cp.spawn(process.execPath, [bootstrap, mode, workspace, state], {
    cwd: workspace,
    env: safeEnv(state),
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  fs.closeSync(fd);
  const record = { pid: child.pid, bootstrap, mode, began: Date.now(), exited: false };
  child.on('exit', (code, signal) => {
    record.exited = true;
    record.exitCode = code;
    record.signal = signal;
  });
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(failure('HOST_SPAWN_FAILED', record)));
    });
    record.start = processStart(child.pid);
  } catch (error) {
    if (error.diagnostic) throw error;
    throw failure('HOST_EXITED', { ...record, elapsedMs: Date.now() - record.began });
  }
  save(path.join(base, 'host.json'), { pid: record.pid, start: record.start, bootstrap });
  child.unref();
  return record;
}
async function ready(base, host, previousPid, options = {}) {
  const began = Date.now();
  const budget = options.timeoutMs ?? 180000;
  const fail = (code) =>
    failure(code, {
      ...host,
      reason: startupReason(base, host.mode),
      elapsedMs: Date.now() - began,
    });
  const file = path.join(base, 'workspace/docs/v2/evidence/zhiban-trial-content-demo-local.json');
  while (Date.now() - began < budget) {
    if (host.exited) throw fail('HOST_EXITED');
    if (!hostMatches(host, base)) {
      // Give an already-exited child's exit event a turn before classifying identity loss.
      await delay(0);
      throw fail(host.exited ? 'HOST_EXITED' : 'HOST_IDENTITY_REJECTED');
    }
    if (fs.existsSync(file)) {
      let m;
      try {
        m = json(file);
      } catch {
        throw fail('HOST_METADATA_INVALID');
      }
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw fail('HOST_METADATA_INVALID');
      if (
        m.status === 'RUNNING_LOCAL_PERSISTENT' &&
        m.pid !== previousPid &&
        fs.existsSync('/proc/' + m.pid) &&
        m.root === json(path.join(base, 'cargo/DELIVERY.json')).originalRoot
      )
        return m;
    }
    await delay(Math.min(options.pollMs ?? 1000, Math.max(1, budget - (Date.now() - began))));
  }
  throw fail('HOST_READINESS_TIMEOUT');
}
function stopHost(base) {
  const workspace = path.join(base, 'workspace'),
    state = path.join(base, 'state'),
    bootstrap = path.join(base, 'cargo/install/install.cjs');
  command(process.execPath, [bootstrap, 'stop', workspace, state], path.join(base, 'stop.log'), {
    cwd: workspace,
    env: safeEnv(state),
    timeout: 90000,
  });
}
function readInfo(base, label) {
  const log = path.join(base, 'info-' + label + '.log');
  command(
    process.execPath,
    [
      path.join(base, 'cargo/install/install.cjs'),
      'info',
      path.join(base, 'workspace'),
      path.join(base, 'state'),
    ],
    log,
    { env: safeEnv(path.join(base, 'state')) },
  );
  const text = fs.readFileSync(log, 'utf8'),
    m = JSON.parse(text.slice(text.indexOf('{')));
  check(m.sourceMatches === true && m.sourceDriftCount === 0, 'Live source drift rejected');
  return m;
}
function verifyBrowserTrust(base) {
  const nss = path.join(os.homedir(), '.pki/nssdb'),
    alias = 'zhiban-portable-' + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT;
  fs.mkdirSync(nss, { recursive: true, mode: 0o700 });
  portable.ancestors(nss);
  const log = path.join(base, 'nss.log');
  if (!fs.existsSync(path.join(nss, 'cert9.db')))
    command('certutil', ['-N', '--empty-password', '-d', 'sql:' + nss], log);
  command(
    'certutil',
    [
      '-A',
      '-d',
      'sql:' + nss,
      '-n',
      alias,
      '-t',
      'C,,',
      '-i',
      path.join(base, 'cargo/restore/tls/development-ca.crt'),
    ],
    log,
  );
  save(path.join(base, 'nss.json'), { nss, alias });
}
async function httpsGet(ca) {
  return new Promise((done, reject) => {
    const r = https.get('https://127.0.0.1:3461/zhiban', { ca }, (res) => {
      res.resume();
      res.on('end', () => done(res.statusCode));
    });
    r.on('error', reject);
    r.setTimeout(10000, () => r.destroy(Error('HTTPS timeout')));
  });
}
let phase = 'CONTEXT';
let phaseBegan = Date.now();
const elapsed = {};
function setPhase(next) {
  elapsed[phase] = (elapsed[phase] ?? 0) + Date.now() - phaseBegan;
  phase = next;
  phaseBegan = Date.now();
}
function phaseTimings() {
  return { ...elapsed, [phase]: (elapsed[phase] ?? 0) + Date.now() - phaseBegan };
}
async function run(base) {
  ciContext();
  basePath(base);
  setPhase('DELIVERY');
  const cargo = path.join(base, 'cargo'),
    m = delivery.validateDelivery(cargo);
  check(
    m.sourceMachineHash !== sha(fs.readFileSync('/etc/machine-id')),
    'Same source host rejected as cross-machine evidence',
  );
  const workspace = path.join(base, 'workspace'),
    state = path.join(base, 'state'),
    log = path.join(base, 'acceptance-private.log');
  const store = path.resolve(process.env.npm_config_store_dir ?? '/invalid-store');
  check(
    store === path.join(base, 'pnpm-store') && !fs.existsSync(store),
    'Fresh private pnpm store required',
  );
  setPhase('PREREQUISITES');
  const pg = cp
    .execFileSync(path.join(bin, 'postgres'), ['--version'], { encoding: 'utf8' })
    .trim();
  check(pg === m.host.pg, 'Exact PG physical profile required');
  check(!fs.existsSync(m.originalRoot), 'Internal restore root already exists');

  setPhase('FROZEN_INSTALL');
  command(
    process.execPath,
    [
      path.join(cargo, 'install/install.cjs'),
      'install',
      path.join(cargo, 'install'),
      workspace,
      m.installManifestSha256,
    ],
    log,
    { env: safeEnv(state) },
  );
  check(
    !fs.lstatSync(path.join(workspace, 'node_modules')).isSymbolicLink() &&
      !fs.existsSync(path.join(workspace, '.git/objects/info/alternates')),
    'Independent installation rejected',
  );
  setPhase('BROWSER_PREREQUISITES');
  command('pnpm', ['exec', 'playwright', 'install', '--with-deps', 'chromium'], log, {
    cwd: workspace,
    env: safeEnv(state),
  });
  setPhase('PRIVATE_IMPORT');
  check(!fs.existsSync(m.originalRoot), 'Restore root appeared before import');
  save(path.join(base, 'custody.json'), {
    root: m.originalRoot,
    uid: process.getuid(),
    runId: process.env.GITHUB_RUN_ID,
  });
  command(
    process.execPath,
    [
      path.join(cargo, 'install/install.cjs'),
      'import-private',
      path.join(cargo, 'restore'),
      state,
      m.restoreManifestSha256,
    ],
    log,
    { env: safeEnv(state) },
  );
  setPhase('NSS_TRUST');
  verifyBrowserTrust(base);
  setPhase('RESTORE_START');
  const host = await startHost(base, 'start-rebind'),
    initial = await ready(base, host);
  setPhase('DATA_ROLES_HTTPS');
  const comparison = path.join(base, 'comparison-local-harness.json');
  command(
    'pnpm',
    [
      'exec',
      'tsx',
      'scripts/zhiban-local/verify-portable.ts',
      'compare',
      path.join(cargo, 'baseline.json'),
      comparison,
    ],
    log,
    { cwd: workspace, env: safeEnv(state) },
  );
  const verified = json(comparison);
  check(verified.status === 'PASS', 'Role/data/browser verification refused');
  readInfo(base, 'initial');
  setPhase('NORMAL_RESTART');
  const receipt = sha(fs.readFileSync(path.join(m.originalRoot, 'content-installation.json')));
  stopHost(base);
  check(
    !fs.existsSync(m.originalRoot),
    'Normal stop failed to retain snapshot and remove owned root',
  );
  const pointer = json(path.join(state, 'snapshots/latest.json'));
  portable.validateSnapshot(pointer.path, pointer.manifestHash);
  const normal = await startHost(base, 'start');
  const current = await ready(base, normal, initial.pid);
  check(
    !fs.readFileSync('/proc/' + current.pid + '/cmdline', 'utf8').includes('--upgrade-local'),
    'Ordinary restart unexpectedly upgraded',
  );
  check(
    receipt === sha(fs.readFileSync(path.join(m.originalRoot, 'content-installation.json'))),
    'Ordinary restart reissued receipt',
  );
  const after = path.join(base, 'after-normal.json');
  command(
    'pnpm',
    ['exec', 'tsx', 'scripts/zhiban-local/verify-portable.ts', 'capture', after],
    log,
    { cwd: workspace, env: safeEnv(state) },
  );
  check(
    JSON.stringify(json(after)) === JSON.stringify(json(path.join(cargo, 'baseline.json'))),
    'Restart changed data/account fingerprints',
  );
  readInfo(base, 'normal');
  check(
    (await httpsGet(fs.readFileSync(path.join(state, 'tls/development-ca.crt')))) === 200,
    'Verified HTTPS failed',
  );
  stopHost(base);
  check(!fs.existsSync(m.originalRoot), 'Final normal stop did not clean root');
  setPhase('FINAL_SNAPSHOT');
  const finalPointer = json(path.join(state, 'snapshots/latest.json'));
  portable.validateSnapshot(finalPointer.path, finalPointer.manifestHash);
  return {
    kind: 'ZHIBAN_PORTABLE_REMOTE_ACCEPTANCE_V1',
    executionOrigin: 'GITHUB_ACTIONS',
    inputEvidenceOrigin: 'LOCAL',
    status: 'PASS',
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    repository: process.env.GITHUB_REPOSITORY,
    workflowSha: process.env.GITHUB_SHA,
    sourceDigest: m.sourceDigest,
    installManifestSha256: m.installManifestSha256,
    restoreManifestSha256: m.restoreManifestSha256,
    node: process.version,
    pg,
    sourceUid: m.sourceUid,
    destinationUid: process.getuid(),
    distinctMachine: true,
    freshDependencyStore: true,
    threeRoleLoginAndWorkspace: true,
    trustedBrowserHttps: true,
    sourceMatches: true,
    sourceDriftCount: 0,
    tables: verified.tables,
    rows: verified.rows,
    accountsPreserved: true,
    allNonIdentityRowFingerprintsPreserved: true,
    ordinaryRestartReceiptUnchanged: true,
    ordinaryRestartDataPreserved: true,
    finalSnapshotVerified: true,
    scope: 'EPHEMERAL_GITHUB_UBUNTU_VM_INSTALL_RESTORE_SAME_INTERNAL_PG_ROOT',
    phaseTimings: phaseTimings(),
    productionDeployment: false,
    originalSourceHostUntouched: true,
    modelCalls: false,
    parserCalls: false,
    fullClassroomRetest: false,
  };
}
async function cleanup(base) {
  basePath(base);
  const errors = [];
  try {
    const hostFile = path.join(base, 'host.json');
    if (fs.existsSync(hostFile)) {
      const h = json(hostFile);
      if (hostMatches(h, base)) {
        try {
          process.kill(-h.pid, 'SIGTERM');
        } catch (e) {
          if (e.code !== 'ESRCH') errors.push('host group stop');
        }
        await delay(3000);
      }
    }
  } catch {
    errors.push('host custody parse');
  }
  try {
    const custody = path.join(base, 'custody.json');
    if (fs.existsSync(custody)) {
      const c = json(custody);
      check(
        c.uid === process.getuid() &&
          c.runId === process.env.GITHUB_RUN_ID &&
          /^\/tmp\/zhiban-trial-content-[a-zA-Z0-9]+$/.test(c.root),
        'Cleanup custody rejected',
      );
      if (fs.existsSync(c.root)) {
        portable.privatePath(c.root, true);
        const pidFile = path.join(c.root, 'data/postmaster.pid');
        if (fs.existsSync(pidFile)) {
          const lines = fs.readFileSync(pidFile, 'utf8').split('\n'),
            pid = Number(lines[0]);
          let matching = false;
          try {
            const args = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0');
            matching =
              fs.statSync('/proc/' + pid).uid === process.getuid() &&
              path.basename(args[0]) === 'postgres' &&
              args.indexOf('-D') >= 0 &&
              args[args.indexOf('-D') + 1] === path.join(c.root, 'data') &&
              lines[1] === path.join(c.root, 'data');
          } catch {
            /* A stale or unrelated PID is never signalled. */
          }
          if (matching) {
            try {
              command(
                path.join(bin, 'pg_ctl'),
                ['-D', path.join(c.root, 'data'), '-m', 'fast', '-w', 'stop'],
                path.join(base, 'cleanup-private.log'),
                { timeout: 30000 },
              );
            } catch {
              errors.push('owned PG stop');
            }
          } else errors.push('unverified PG PID; retained root');
        }
        if (!fs.existsSync(pidFile)) fs.rmSync(c.root, { recursive: true, force: true });
      }
    }
  } catch {
    errors.push('PG custody refused');
  }
  try {
    const nssFile = path.join(base, 'nss.json');
    if (fs.existsSync(nssFile)) {
      const n = json(nssFile);
      check(
        n.nss === path.join(os.homedir(), '.pki/nssdb') &&
          n.alias ===
            'zhiban-portable-' + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT,
        'NSS cleanup rejected',
      );
      command(
        'certutil',
        ['-D', '-d', 'sql:' + n.nss, '-n', n.alias],
        path.join(base, 'cleanup-private.log'),
      );
    }
  } catch {
    errors.push('NSS trust removal');
  }
  // Even a refused PG PID must not prevent purging the known private namespace.
  try {
    for (const name of fs.readdirSync(base))
      fs.rmSync(path.join(base, name), { recursive: true, force: true });
  } catch {
    errors.push('private namespace purge');
  }
  return errors;
}
function publicReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = { status: 'FAIL' };
  const out = {
    kind: 'ZHIBAN_PORTABLE_REMOTE_ACCEPTANCE_V1',
    executionOrigin: 'GITHUB_ACTIONS',
    status: value.status === 'PASS' ? 'PASS' : 'FAIL',
  };
  const patterns = {
    runId: /^\d{1,20}$/,
    runAttempt: /^\d{1,6}$/,
    repository: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    workflowSha: /^[a-f0-9]{40}$/,
    sourceDigest: /^[a-f0-9]{64}$/,
    installManifestSha256: /^[a-f0-9]{64}$/,
    restoreManifestSha256: /^[a-f0-9]{64}$/,
    node: /^v22\.\d+\.\d+$/,
    pg: /^postgres \(PostgreSQL\) 16\.[0-9]+ \(Ubuntu 16\.[0-9]+-1\.pgdg24\.04\+[0-9]+\)$/,
    failureStage:
      /^(CONTEXT|DELIVERY|PREREQUISITES|FROZEN_INSTALL|BROWSER_PREREQUISITES|PRIVATE_IMPORT|NSS_TRUST|RESTORE_START|DATA_ROLES_HTTPS|NORMAL_RESTART|FINAL_SNAPSHOT)$/,
  };
  for (const [key, pattern] of Object.entries(patterns))
    if (typeof value[key] === 'string' && pattern.test(value[key])) out[key] = value[key];
  const diagnostic = safeFailure(value.diagnostic);
  if (diagnostic) out.diagnostic = diagnostic;
  if (value.phaseTimings && typeof value.phaseTimings === 'object') {
    const timings = {};
    for (const [name, duration] of Object.entries(value.phaseTimings))
      if (
        patterns.failureStage.test(name) &&
        Number.isSafeInteger(duration) &&
        duration >= 0 &&
        duration <= 5400000
      )
        timings[name] = duration;
    out.phaseTimings = timings;
  }
  const booleans = [
    'distinctMachine',
    'freshDependencyStore',
    'threeRoleLoginAndWorkspace',
    'trustedBrowserHttps',
    'sourceMatches',
    'accountsPreserved',
    'allNonIdentityRowFingerprintsPreserved',
    'ordinaryRestartReceiptUnchanged',
    'ordinaryRestartDataPreserved',
    'finalSnapshotVerified',
    'productionDeployment',
    'originalSourceHostUntouched',
    'modelCalls',
    'parserCalls',
    'fullClassroomRetest',
  ];
  for (const key of booleans) if (typeof value[key] === 'boolean') out[key] = value[key];
  for (const key of ['sourceUid', 'destinationUid', 'sourceDriftCount', 'tables', 'rows'])
    if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 2147483647)
      out[key] = value[key];
  if (value.inputEvidenceOrigin === 'LOCAL') out.inputEvidenceOrigin = 'LOCAL';
  if (value.scope === 'EPHEMERAL_GITHUB_UBUNTU_VM_INSTALL_RESTORE_SAME_INTERNAL_PG_ROOT')
    out.scope = value.scope;
  if (value.cleanup)
    out.cleanup = {
      status: value.cleanup.status === 'PASS' ? 'PASS' : 'FAIL',
      privateNamespacePurged: value.cleanup.privateNamespacePurged === true,
    };
  return out;
}
function loadPublicReport(report) {
  try {
    return publicReport(fs.existsSync(report) ? json(report) : { status: 'FAIL' });
  } catch {
    return publicReport({ status: 'FAIL' });
  }
}
if (require.main === module) {
  void (async () => {
    const [action, base, report] = process.argv.slice(2);
    check(['run', 'cleanup'].includes(action) && base && report, 'Use run/cleanup BASE REPORT');
    ciContext(action !== 'cleanup');
    basePath(base);
    portable.absolute(report);
    check(!report.startsWith(base + '/'), 'Public report must be outside secret namespace');
    if (action === 'cleanup') {
      const previous = loadPublicReport(report);
      try {
        const errors = await cleanup(base);
        previous.cleanup = {
          status: errors.length ? 'FAIL' : 'PASS',
          privateNamespacePurged: fs.readdirSync(base).length === 0,
        };
        if (errors.length) {
          previous.status = 'FAIL';
          process.exitCode = 1;
        }
      } catch {
        previous.status = 'FAIL';
        previous.cleanup = { status: 'FAIL', privateNamespacePurged: false };
        process.exitCode = 1;
      }
      try {
        for (const name of fs.readdirSync(base))
          fs.rmSync(path.join(base, name), { recursive: true, force: true });
      } catch {
        previous.status = 'FAIL';
        previous.cleanup.privateNamespacePurged = false;
        process.exitCode = 1;
      }
      save(report, publicReport(previous));
      console.log('Portable acceptance cleanup recorded; no private diagnostics uploaded');
    } else {
      try {
        save(report, publicReport(await run(base)));
        console.log('PASS remote install/restore; only allowlisted summary retained');
      } catch (error) {
        save(
          report,
          publicReport({
            kind: 'ZHIBAN_PORTABLE_REMOTE_ACCEPTANCE_V1',
            executionOrigin: 'GITHUB_ACTIONS',
            status: 'FAIL',
            runId: process.env.GITHUB_RUN_ID,
            workflowSha: process.env.GITHUB_SHA,
            failureStage: phase,
            diagnostic: error.diagnostic,
            phaseTimings: phaseTimings(),
          }),
        );
        process.exitCode = 1;
        console.error('Portable acceptance failed; private diagnostic output withheld');
      }
    }
  })().catch(() => {
    console.error('Portable CI context/custody refused');
    process.exitCode = 1;
  });
}
module.exports = {
  ciContext,
  hostMatches,
  safeEnv,
  publicReport,
  cleanup,
  loadPublicReport,
  startHost,
  ready,
  safeFailure,
  startupReason,
};
