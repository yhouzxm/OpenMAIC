// TEST ONLY fault adapter. Rejects real targets before instrumentation. No production CLI hooks.
const fs = require('node:fs'),
  cp = require('node:child_process'),
  path = require('node:path');
const [approvalPath, publicKeyPath, pin, mode] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(approvalPath)).payload;
if (
  p.target.environment !== 'LOCAL_DISPOSABLE' ||
  !/^\/tmp\/zhiban-observer-pg16-[A-Za-z0-9_-]+\/data$/.test(p.target.dataDirectory) ||
  p.target.port !== 56497
)
  throw Error('TEST_ADAPTER_DISPOSABLE_ONLY');
const originalSpawn = cp.spawn;
cp.spawn = (file, args, options) => {
  const op = path.basename(file) === 'pg_ctl' ? args[0] : null;
  if ((mode === 'stop-refused' && op === 'stop') || (mode === 'start-refused' && op === 'start'))
    return originalSpawn(process.execPath, ['-e', 'process.exitCode=2'], {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const isGuardian = path.basename(args[0] || '') === 'observer-guardian.cjs';
  const ioModes = [
    'release-positive-short',
    'release-zero',
    'release-partial-enospc',
    'release-fsync',
    'release-paused-after-authorization',
    'release-zero-held-ack-lost',
  ];
  const actualArgs =
    isGuardian && ioModes.includes(mode)
      ? [path.join(__dirname, 'observer-test-guardian.cjs'), args[1], mode]
      : args;
  if (
    ['pgpass-before-read', 'snapshot-before-read', 'pgpass-during-read'].includes(mode) &&
    path.basename(file) === 'psql'
  ) {
    if (mode === 'pgpass-during-read')
      fs.appendFileSync(p.paths.pgpassFilePath, '# CHANGED_DURING_READ\n');
  }
  const child = originalSpawn(file, actualArgs, options);
  if (isGuardian && mode === 'release-ack-lost') {
    const emit = child.emit.bind(child);
    child.emit = (name, ...rest) =>
      name === 'message' && rest[0]?.type === 'released' ? true : emit(name, ...rest);
  }
  if (isGuardian && mode === 'release-zero-held-ack-lost') {
    const emit = child.emit.bind(child);
    child.emit = (name, ...rest) =>
      name === 'message' && rest[0]?.type === 'custody-held' ? true : emit(name, ...rest);
  }
  if (isGuardian && ['release-missing-authorization', 'release-wrong-binding'].includes(mode)) {
    const emit = child.emit.bind(child);
    child.emit = (name, ...rest) => {
      if (name === 'exit') {
        const f = path.join(args[1], 'guardian-release-authorized.json');
        if (fs.existsSync(f)) {
          if (mode === 'release-missing-authorization') fs.unlinkSync(f);
          else {
            const v = JSON.parse(fs.readFileSync(f));
            v.approvalSha256 = '0'.repeat(64);
            fs.writeFileSync(f, JSON.stringify(v));
          }
        }
      }
      return emit(name, ...rest);
    };
  }
  if (mode === 'pgpass-after-read' && path.basename(file) === 'psql') {
    const emit = child.emit.bind(child);
    child.emit = (name, ...rest) => {
      if (name === 'close') fs.appendFileSync(p.paths.pgpassFilePath, '# CHANGED_AFTER_READ\n');
      return emit(name, ...rest);
    };
  }
  if (mode === 'tuple-drift-after-read' && path.basename(file) === 'psql') {
    const emit = child.emit.bind(child);
    child.emit = (name, ...rest) => {
      if (name === 'close') {
        const f = path.join(p.target.dataDirectory, 'postmaster.pid'),
          lines = fs.readFileSync(f, 'utf8').split('\n');
        lines[4] = '/tmp/unbound-observer-after-read';
        fs.writeFileSync(f, lines.join('\n'), { mode: 0o600 });
      }
      return emit(name, ...rest);
    };
  }
  if (mode === 'slow-pg-initialization' && op === 'start') {
    const timer = setInterval(() => {
      try {
        const lines = fs
            .readFileSync(path.join(p.target.dataDirectory, 'postmaster.pid'), 'utf8')
            .split('\n'),
          pid = Number(lines[0]);
        if (
          lines[1] !== p.target.dataDirectory ||
          lines[7] === 'ready' ||
          fs.realpathSync('/proc/' + pid + '/exe') !== '/usr/lib/postgresql/16/bin/postgres' ||
          !fs
            .readFileSync('/proc/' + pid + '/cmdline')
            .toString()
            .includes(p.paths.stageDirectory)
        )
          return;
        clearInterval(timer);
        process.kill(pid, 'SIGSTOP');
        process.send({ type: 'pg-initialization-paused' });
        setTimeout(() => process.kill(pid, 'SIGCONT'), 1400);
      } catch {}
    }, 1);
    child.once('close', () => clearInterval(timer));
  }
  if (
    (mode === 'start-ack-lost' && op === 'start') ||
    (mode === 'stop-ack-lost' && op === 'stop')
  ) {
    const emit = child.emit.bind(child);
    child.emit = (name, ...rest) =>
      emit(name, ...(name === 'close' ? [2, ...rest.slice(1)] : rest));
  }
  return child;
};
const c = require('./observer-contract.cjs'),
  originalJournal = c.journal;
const writeNew = c.writeNew;
c.writeNew = (file, ...args) => {
  if (mode === 'result-record-failure' && path.basename(file) === 'result.json') {
    const e = Error('TEST_RESULT_EIO');
    e.code = 'EIO';
    throw e;
  }
  return writeNew(file, ...args);
};
let paused = false;
c.journal = (stage, event) => {
  originalJournal(stage, event);
  if (
    ['pgpass-before-read', 'snapshot-before-read'].includes(mode) &&
    event.state === 'START_BOUND'
  ) {
    if (mode === 'pgpass-before-read')
      fs.appendFileSync(p.paths.pgpassFilePath, '# CHANGED_BEFORE_READ\n');
    else {
      const file = path.join(p.paths.authenticationStageDirectory, 'pgpass');
      fs.chmodSync(file, 0o600);
      fs.appendFileSync(file, '# CHANGED_SNAPSHOT\n');
    }
  }
  if (mode === 'tuple-drift' && event.state === 'START_BOUND') {
    const file = path.join(p.target.dataDirectory, 'postmaster.pid'),
      lines = fs.readFileSync(file, 'utf8').split('\n');
    lines[4] = '/tmp/unbound-observer-socket';
    fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  }
  if (
    !paused &&
    ((mode === 'cut-start-intent' && event.state === 'START_INTENT') ||
      ([
        'cut-start-bound',
        'term-start-bound',
        'cut-start-bound-audit-fail',
        'pause-start-bound',
      ].includes(mode) &&
        event.state === 'START_BOUND'))
  ) {
    if (mode === 'cut-start-bound-audit-fail')
      fs.chmodSync(path.join(stage, 'journal.jsonl'), 0o000);
    paused = true;
    process.send({ type: 'cut', state: event.state });
    process.kill(process.pid, 'SIGSTOP');
  }
};
require('./observer-executor.cjs')
  .run({ approvalPath, publicKeyPath, trustedPublicKeySha256: pin })
  .then(({ result }) => {
    console.log(JSON.stringify(result));
    if (process.connected) process.disconnect();
    process.exitCode = result.status === 'OBSERVED_STOP_CONFIRMED' ? 0 : 2;
  })
  .catch((e) => {
    console.log(
      JSON.stringify({
        status: 'REJECTED',
        code: /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'PRIVATE_INPUT_REJECTED',
      }),
    );
    if (process.connected) process.disconnect();
    process.exitCode = 2;
  });
