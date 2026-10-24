// Linux/PG16 management observation. Approval is externally signed and source-bound.
const fs = require('node:fs'),
  path = require('node:path'),
  net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const c = require('./observer-contract.cjs'),
  preflight = require('./observer-preflight.cjs'),
  custody = require('./observer-custody.cjs');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function environment() {
  return { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: '/nonexistent' };
}
function command(binary, args, { timeout = 30000, env = environment(), fd = null } = {}) {
  return new Promise((resolve) => {
    let result = '',
      error = '',
      timedOut = false,
      finished = false;
    const child = spawn(binary, args, {
      env,
      stdio: fd === null ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', fd],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);
    const append = (buf, name) => {
      if (name === 'out') result += buf.toString();
      else error += buf.toString();
      if (result.length + error.length > 2 * 1024 * 1024) {
        timedOut = true;
        child.kill('SIGKILL');
      }
    };
    child.stdout.on('data', (b) => append(b, 'out'));
    child.stderr.on('data', (b) => append(b, 'err'));
    function done(code) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code, timedOut, stdout: result, stderr: error });
    }
    child.on('error', () => done(-1));
    child.on('close', (code) => done(code));
  });
}
function ticks(pid) {
  return fs
    .readFileSync('/proc/' + pid + '/stat', 'utf8')
    .split(') ')[1]
    .split(' ')[19];
}
function boundPostmaster(v) {
  const file = path.join(v.target.dataDirectory, 'postmaster.pid');
  if (!fs.existsSync(file)) return null;
  const lines = c.bytes(file).toString().split('\n'),
    pid = Number(lines[0]);
  c.requireValue(
    Number.isSafeInteger(pid) &&
      pid > 1 &&
      lines[1] === v.target.dataDirectory &&
      Number(lines[3]) === v.target.port &&
      lines[4] === path.join(v.paths.stageDirectory, 'socket'),
    'POSTMASTER_NOT_ATTEMPT_BOUND',
  );
  const exe = fs.realpathSync('/proc/' + pid + '/exe');
  const argv = fs
    .readFileSync('/proc/' + pid + '/cmdline')
    .toString()
    .split('\0')
    .filter(Boolean);
  c.requireValue(
    exe === path.join(c.bin, 'postgres') &&
      c.canonical(argv.slice(1)) === c.canonical(c.argumentsFor(v)),
    'POSTMASTER_NOT_ATTEMPT_BOUND',
  );
  return {
    pid,
    startTicks: ticks(pid),
    pidFileStartSeconds: lines[2],
    dataDirectory: lines[1],
    port: Number(lines[3]),
    socket: lines[4],
    executable: exe,
  };
}
function sameProcess(tuple) {
  try {
    return (
      ticks(tuple.pid) === tuple.startTicks &&
      fs.realpathSync('/proc/' + tuple.pid + '/exe') === tuple.executable
    );
  } catch {
    return false;
  }
}
async function tcpAbsent(port) {
  await new Promise((resolve, reject) => {
    const s = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(Error('TCP_ENDPOINT_UNKNOWN'));
    }, 700);
    s.once('connect', () => {
      clearTimeout(timer);
      s.destroy();
      reject(Error('TCP_ENDPOINT_PRESENT'));
    });
    s.once('error', (e) => {
      clearTimeout(timer);
      s.destroy();
      e.code === 'ECONNREFUSED' ? resolve() : reject(Error('TCP_ENDPOINT_UNKNOWN'));
    });
  });
  // Empty listen_addresses forbids both IP families; refuse known listeners of either family.
  const result = await command('/usr/bin/ss', ['-ltnH', 'sport = :' + port], { timeout: 1500 });
  c.requireValue(result.code === 0 && !result.stdout.trim(), 'TCP_ENDPOINT_PRESENT_OR_UNKNOWN');
}
async function control(v, stopped) {
  const r = await command(path.join(c.bin, 'pg_controldata'), [v.target.dataDirectory], {
    timeout: 3000,
  });
  c.requireValue(
    r.code === 0 &&
      r.stdout.match(/Database system identifier:\s*(\d+)/)?.[1] === v.target.systemIdentifier,
    'CONTROL_TARGET_MISMATCH',
  );
  if (stopped)
    c.requireValue(
      /Database cluster state:\s*shut down\s*\n/.test(r.stdout) &&
        !fs.existsSync(path.join(v.target.dataDirectory, 'postmaster.pid')),
      'STOP_NOT_CONFIRMED',
    );
  return r;
}
function takeLock(v) {
  const file = path.join(v.paths.controlDirectory, 'maintenance.lock');
  const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
  try {
    const s = fs.fstatSync(fd);
    c.requireValue(
      s.isFile() &&
        s.uid === process.getuid() &&
        !(s.mode & 0o077) &&
        s.nlink === 1 &&
        s.dev === v.lock.device &&
        s.ino === v.lock.inode,
      'LOCK_BINDING',
    );
    execFileSync('/usr/bin/flock', ['-n', '-x', '3'], {
      stdio: ['ignore', 'ignore', 'ignore', fd],
      timeout: 2000,
    });
    return fd;
  } catch {
    fs.closeSync(fd);
    throw Error('EXISTING_LOCK_BUSY_OR_INVALID');
  }
}
function assertLock(v, fd) {
  const a = fs.fstatSync(fd),
    b = fs.lstatSync(path.join(v.paths.controlDirectory, 'maintenance.lock'));
  c.requireValue(
    a.ino === b.ino &&
      a.dev === b.dev &&
      a.ino === v.lock.inode &&
      a.dev === v.lock.device &&
      b.nlink === 1 &&
      b.uid === process.getuid() &&
      !(b.mode & 0o077),
    'LOCK_REPLACED',
  );
  preflight.guard(v);
}
function guardian(v, fd) {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'observer-guardian.cjs'), v.paths.stageDirectory],
    { env: environment(), stdio: ['ignore', 'ignore', 'ignore', fd, 'ipc'] },
  );
  let exited = false;
  const gone = new Promise((resolve) =>
    child.once('exit', () => {
      exited = true;
      resolve();
    }),
  );
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error('LOCK_CUSTODIAN_UNKNOWN')), 3000);
    child.once('error', () => {
      clearTimeout(t);
      reject(Error('LOCK_CUSTODIAN_UNKNOWN'));
    });
    child.once('exit', () => {
      clearTimeout(t);
      reject(Error('LOCK_CUSTODIAN_UNKNOWN'));
    });
    child.once('message', (m) => {
      clearTimeout(t);
      m?.type === 'ready' && m.pid === child.pid
        ? resolve({ pid: m.pid, startTicks: m.startTicks })
        : reject(Error('LOCK_CUSTODIAN_UNKNOWN'));
    });
  });
  return { child, identity: null, ready, gone, exited: () => exited };
}
async function releaseGuardian(g, stage, stop) {
  g.releaseRequested = true;
  g.peerAckObserved = false;
  g.holdConfirmed = false;
  let acknowledged = false;
  g.child.on('message', (m) => {
    if (m?.type === 'released') acknowledged = true;
    if (m?.type === 'released') g.peerAckObserved = true;
    if (
      m?.type === 'custody-held' &&
      m.pid === g.identity.pid &&
      m.startTicks === g.identity.startTicks &&
      m.stopProofSha256 === stop.sha256
    )
      g.holdConfirmed = true;
  });
  g.child.send({ type: 'release-after-confirmed-stop', stopProofSha256: stop.sha256 }, () => {});
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), 2000);
  });
  const departed = await Promise.race([g.gone.then(() => true), timeout]);
  clearTimeout(timer);
  c.requireValue(departed && g.exited(), 'LOCK_CUSTODIAN_DEPARTURE_UNKNOWN');
  const sha256 = custody.departure(stage, stop);
  return { sha256, ackUnknown: !acknowledged };
}
function retained(g) {
  if (g) {
    if (g.child.connected) g.child.disconnect();
    g.child.unref();
  }
}
function observation(v, text, tuple) {
  const rows = text
    .split('\n')
    .filter((x) => x.startsWith('{'))
    .map((x) => JSON.parse(x));
  c.requireValue(
    rows.length === 5 &&
      rows.map((x) => x.kind).join(',') ===
        'MANAGEMENT_IDENTITY,TARGET_DATABASES,ROLE_ATTRIBUTES,BACKEND_IDENTITIES,PREPARED_COUNT',
    'OBSERVATION_SHAPE',
  );
  const a = rows[0];
  c.requireValue(
    a.database === 'postgres' &&
      a.currentUser === 'postgres' &&
      a.sessionUser === 'postgres' &&
      a.serverVersionNum >= 160000 &&
      a.serverVersionNum < 170000 &&
      a.systemIdentifier === v.target.systemIdentifier &&
      a.dataDirectory === v.target.dataDirectory &&
      Number(a.port) === v.target.port &&
      a.socketDirectories === tuple.socket &&
      a.listenAddresses === '' &&
      a.inRecovery === false &&
      a.transactionReadOnly === 'on' &&
      a.defaultTransactionReadOnly === 'on' &&
      a.sharedPreload === '' &&
      a.sessionPreload === '' &&
      a.localPreload === '' &&
      a.workerProcesses === '0' &&
      a.logicalWorkers === '0',
    'OBSERVATION_TARGET_ISOLATION',
  );
  // PgStartTime is captured later than PID-file MyStartTime; they are different facts.
  // Process identity is checked around collection with exact PID/startTicks/exe/argv.
  c.requireValue(
    Number.isFinite(Date.parse(a.postmasterStart)),
    'OBSERVATION_POSTMASTER_TIMESTAMP_INVALID',
  );
  c.requireValue(
    rows[1].values.length === 2 &&
      rows[1].values
        .map((x) => x.name)
        .sort()
        .join(',') === 'zhiban_m1_dev,zhiban_m5_native' &&
      new Set(rows[1].values.map((x) => x.oid)).size === 2 &&
      rows[1].values.every((x) => /^[1-9][0-9]*$/.test(x.oid)) &&
      rows[4].count === '0',
    'TARGET_DATABASES_OR_PREPARED_STATE',
  );
  c.requireValue(
    rows[3].values
      .filter((x) => x.backend_type === 'client backend')
      .every((x) => x.role === 'postgres' && x.database_oid === a.databaseOid),
    'UNEXPECTED_CLIENT_BACKEND',
  );
  // Exact current management backend identity must be the only client backend.
  c.requireValue(
    rows[3].values.filter((x) => x.backend_type === 'client backend').length === 1,
    'UNEXPECTED_CLIENT_BACKEND',
  );
  return rows;
}
async function run({ approvalPath, publicKeyPath, trustedPublicKeySha256 }) {
  const approved = c.approval(approvalPath, publicKeyPath, trustedPublicKeySha256),
    v = approved.value,
    stage = v.paths.stageDirectory;
  let fd = null,
    g = null,
    tuple = null,
    startRequested = false,
    confirmed = false,
    failed = null,
    startAckUnknown = false,
    stopAckUnknown = false,
    releaseAckUnknown = false,
    releaseConfirmed = false,
    snapshot = null,
    parentCustody = null,
    aborted = false;
  const started = Date.now(),
    abort = () => {
      aborted = true;
    },
    assertTime = () =>
      c.requireValue(
        !aborted && Date.now() - started < 120000 && Date.now() < v.expiresAt,
        'ATTEMPT_ABORTED_OR_EXPIRED',
      );
  process.on('SIGTERM', abort);
  process.on('SIGINT', abort);
  try {
    fd = takeLock(v);
    preflight.inputs(v);
    await control(v, true);
    await tcpAbsent(v.target.port);
    await tcpAbsent(3443);
    assertTime();
    assertLock(v, fd);
    c.writeNew(
      path.join(v.paths.controlDirectory, 'observer-permit-' + v.approvalId + '.json'),
      JSON.stringify({ approvalSha256: approved.approvalSha256, attemptId: v.attemptId }) + '\n',
    );
    fs.mkdirSync(stage, { mode: 0o700 });
    c.syncDir(v.paths.controlDirectory);
    c.writeNew(path.join(stage, 'journal.jsonl'), '');
    c.writeNew(
      path.join(stage, 'intent.json'),
      JSON.stringify({
        status: 'OBSERVATION_INTENT',
        attemptId: v.attemptId,
        approvalSha256: approved.approvalSha256,
        source: v.source,
        target: v.target,
        paths: v.paths,
        guardSha256: v.hashes.guardSha256,
        lock: v.lock,
        expectedArgv: c.argumentsFor(v),
        time: Date.now(),
      }) + '\n',
    );
    c.journal(stage, { state: 'INTENT' });
    g = guardian(v, fd);
    g.identity = await g.ready;
    snapshot = preflight.sealPassword(v, stage);
    fs.mkdirSync(path.join(stage, 'socket'), { mode: 0o700 });
    c.syncDir(stage);
    c.writeNew(
      path.join(stage, 'pg_hba.conf'),
      fs.readFileSync(path.join(__dirname, 'management-only-hba.conf')),
    );
    c.writeNew(path.join(stage, 'pg_ident.conf'), '# no maps\n');
    c.writeNew(
      path.join(stage, 'postgresql.conf'),
      '# approved isolated observer; all settings explicitly on argv\n',
    );
    c.writeNew(path.join(stage, 'startup.log'), '');
    // Recheck selected inputs after lock/staging; no trusted defaults or config inheritance.
    preflight.inputs(v);
    assertLock(v, fd);
    assertTime();
    const argv = c.argumentsFor(v),
      quote = (x) => "'" + x.replaceAll("'", "'\\''") + "'";
    c.journal(stage, { state: 'START_INTENT', argumentsSha256: v.expectedStartArgumentsSha256 });
    startRequested = true;
    const start = await command(
      path.join(c.bin, 'pg_ctl'),
      [
        'start',
        '-D',
        v.target.dataDirectory,
        '-p',
        path.join(c.bin, 'postgres'),
        '-l',
        path.join(stage, 'startup.log'),
        '-w',
        '-t',
        '30',
        '-o',
        argv.slice(2).map(quote).join(' '),
      ],
      { fd, timeout: 32000 },
    );
    c.writeNew(path.join(stage, 'start-tool.json'), JSON.stringify(start) + '\n');
    tuple = boundPostmaster(v);
    if (tuple) {
      c.writeNew(path.join(stage, 'postmaster.json'), JSON.stringify(tuple) + '\n');
      c.journal(stage, { state: 'START_BOUND', ...tuple });
    }
    startAckUnknown = start.code !== 0 || start.timedOut;
    c.requireValue(!startAckUnknown && tuple, 'START_ACK_UNKNOWN_OR_FAILED');
    assertLock(v, fd);
    assertTime();
    await tcpAbsent(v.target.port);
    await control(v, false);
    const env = {
      ...environment(),
      PGPASSFILE: snapshot.path,
      PGCONNECT_TIMEOUT: '3',
      PGOPTIONS:
        '-c default_transaction_read_only=on -c session_preload_libraries= -c local_preload_libraries=',
    };
    preflight.authentication(v, snapshot);
    const read = await command(
      path.join(c.bin, 'psql'),
      [
        '-X',
        '-w',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        tuple.socket,
        '-p',
        String(v.target.port),
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-f',
        path.join(__dirname, 'management-observe.sql'),
      ],
      { env, timeout: 15000 },
    );
    c.writeNew(
      path.join(stage, 'read-tool.json'),
      JSON.stringify({
        code: read.code,
        timedOut: read.timedOut,
        stderr: read.stderr,
        stdout: read.stdout,
      }) + '\n',
    );
    c.requireValue(read.code === 0 && !read.timedOut, 'AUTHENTICATION_OR_READ_FAILED');
    preflight.authentication(v, snapshot);
    c.requireValue(
      sameProcess(tuple) && c.canonical(boundPostmaster(v)) === c.canonical(tuple),
      'POSTMASTER_CHANGED_DURING_COLLECTION',
    );
    const rows = observation(v, read.stdout, tuple);
    assertLock(v, fd);
    assertTime();
    c.writeNew(
      path.join(stage, 'observation.json'),
      JSON.stringify(
        {
          status: 'OBSERVED_MANAGEMENT_ONLY',
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          approvalSha256: approved.approvalSha256,
          source: v.source,
          target: v.target,
          postmaster: tuple,
          authenticationSnapshotSha256: snapshot.sha256,
          rows,
          runtimeAccepted: false,
          launchAllowed: false,
        },
        null,
        2,
      ) + '\n',
    );
    c.journal(stage, { state: 'READ_ONLY_OBSERVED' });
  } catch (e) {
    failed = /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'PRIVATE_PREFLIGHT_OR_LIFECYCLE_ERROR';
    if (fs.existsSync(path.join(stage, 'journal.jsonl')))
      try {
        c.journal(stage, { state: 'OBSERVATION_FAILED', code: failed });
      } catch {}
  } finally {
    try {
      if (!startRequested) {
        if (g) await control(v, true);
        confirmed = true;
      } else {
        if (!tuple) {
          try {
            tuple = boundPostmaster(v);
            if (tuple && !fs.existsSync(path.join(stage, 'postmaster.json')))
              c.writeNew(path.join(stage, 'postmaster.json'), JSON.stringify(tuple) + '\n');
          } catch {}
        }
        if (tuple && sameProcess(tuple)) {
          c.requireValue(
            c.canonical(boundPostmaster(v)) === c.canonical(tuple),
            'STOP_TUPLE_DRIFT',
          );
          c.journal(stage, {
            state: 'STOP_REQUESTED',
            pid: tuple.pid,
            startTicks: tuple.startTicks,
          });
          const stop = await command(
            path.join(c.bin, 'pg_ctl'),
            ['stop', '-D', v.target.dataDirectory, '-m', 'fast', '-w', '-t', '30'],
            { timeout: 32000 },
          );
          stopAckUnknown = stop.code !== 0 || stop.timedOut;
          c.writeNew(path.join(stage, 'stop-tool.json'), JSON.stringify(stop) + '\n');
        }
        // Only an observed, exact attempt tuple can prove completion after a start call.
        c.requireValue(tuple && !sameProcess(tuple), 'POSTMASTER_STOP_UNKNOWN');
        await control(v, true);
        await tcpAbsent(v.target.port);
        c.requireValue(
          !fs.existsSync(path.join(stage, 'socket', '.s.PGSQL.' + v.target.port)),
          'SOCKET_STOP_UNKNOWN',
        );
        confirmed = true;
        c.journal(stage, { state: 'STOP_CONFIRMED', stopAckUnknown });
      }
      if (fd !== null && g) assertLock(v, fd);
      if (confirmed && g) {
        preflight.removeSnapshot(v, snapshot);
        c.journal(stage, { state: 'AUTHENTICATION_SNAPSHOT_CLEANED', sealed: !!snapshot });
        c.writeNew(
          path.join(stage, 'stop-proof.json'),
          JSON.stringify({
            formatVersion: 1,
            purpose: 'LOCAL_OBSERVER_STOP_FACT',
            evidenceOrigin: 'LOCAL',
            githubActions: false,
            ...custody.binding(custody.intent(stage)),
            pgState: startRequested ? 'STOP_CONFIRMED' : 'NOT_STARTED',
            postmaster: startRequested ? tuple : null,
            guardian: g.identity,
          }) + '\n',
        );
        const stop = custody.stopFact(stage),
          departed = await releaseGuardian(g, stage, stop);
        releaseAckUnknown = departed.ackUnknown;
        await control(v, true);
        assertLock(v, fd);
        c.journal(stage, {
          state: 'PARENT_RELEASE_AUTHORIZED',
          guardianAuthorizationSha256: departed.sha256,
        });
        c.writeNew(
          path.join(stage, 'parent-release-authorized.json'),
          JSON.stringify({
            formatVersion: 1,
            purpose: 'LOCAL_OBSERVER_PARENT_RELEASE_AUTHORIZATION',
            evidenceOrigin: 'LOCAL',
            githubActions: false,
            ...custody.binding(stop.v),
            stopProofSha256: stop.sha256,
            guardianAuthorizationSha256: departed.sha256,
          }) + '\n',
        );
      }
      if (confirmed && fd !== null) {
        fs.closeSync(fd);
        fd = null;
        releaseConfirmed = true;
      }
    } catch {
      failed = failed || 'LIFECYCLE_UNKNOWN';
      if (fd !== null) {
        if (g?.identity && custody.held(g.identity, v) && (!g.releaseRequested || g.holdConfirmed))
          retained(g);
        else {
          parentCustody = custody.resident(stage, fd);
          retained(g);
        }
      }
    }
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
  const result = {
    status:
      !releaseConfirmed && fd !== null
        ? 'LIFECYCLE_UNKNOWN'
        : failed
          ? startRequested
            ? 'FAILED_STOP_CONFIRMED'
            : 'REJECTED_BEFORE_START'
          : 'OBSERVED_STOP_CONFIRMED',
    code: failed,
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    attemptId: v.attemptId,
    approvalSha256: approved.approvalSha256,
    startRequested,
    stopConfirmed: startRequested && confirmed,
    pgState: startRequested ? (confirmed ? 'STOP_CONFIRMED' : 'UNKNOWN') : 'NOT_STARTED',
    releaseState: releaseConfirmed
      ? 'RELEASE_CONFIRMED'
      : parentCustody
        ? 'PARENT_CUSTODY_HELD'
        : fd !== null
          ? 'CUSTODY_HELD'
          : 'NOT_ACQUIRED',
    startAckUnknown,
    stopAckUnknown,
    releaseAckUnknown: releaseAckUnknown || !!(g?.releaseRequested && !g.peerAckObserved),
    lockRetained: !releaseConfirmed && fd !== null,
    lockRetainedByParent: !!parentCustody,
    parentCustody: parentCustody?.identity || null,
    lockRetainedByCustodian: (() => {
      if (releaseConfirmed || !g?.identity) return false;
      try {
        const s = fs.statSync('/proc/' + g.identity.pid + '/fd/3');
        return (
          ticks(g.identity.pid) === g.identity.startTicks &&
          fs.realpathSync('/proc/' + g.identity.pid + '/exe') === process.execPath &&
          s.dev === v.lock.device &&
          s.ino === v.lock.inode
        );
      } catch {
        return false;
      }
    })(),
    guardian: g?.identity || null,
    runtimeAccepted: false,
    launchAllowed: false,
  };
  if (fs.existsSync(path.join(stage, 'journal.jsonl'))) {
    try {
      c.writeNew(path.join(stage, 'result.json'), JSON.stringify(result, null, 2) + '\n');
      c.journal(stage, { state: 'RESULT', status: result.status });
    } catch {
      result.resultRecordUnknown = true;
      if (releaseConfirmed) result.status = 'RELEASED_RESULT_UNKNOWN';
    }
  }
  return { result, retainedFd: fd };
}
function inspect(stage) {
  c.directory(stage);
  const intent = JSON.parse(c.bytes(path.join(stage, 'intent.json'))),
    lines = c.bytes(path.join(stage, 'journal.jsonl')).toString().split('\n').filter(Boolean);
  let journal = [],
    malformed = false;
  try {
    journal = lines.map(JSON.parse);
  } catch {
    malformed = true;
  }
  return {
    status: 'INSPECTION_ONLY',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    attemptId: path.basename(stage).replace(/^observe-/, ''),
    approvalSha256: intent.approvalSha256,
    lastState: malformed ? 'UNKNOWN_CORRUPT_JOURNAL' : journal.at(-1)?.state || 'UNKNOWN',
    auditMalformed: malformed,
    hasResult: fs.existsSync(path.join(stage, 'result.json')),
    hasBoundPostmaster: fs.existsSync(path.join(stage, 'postmaster.json')),
    runtimeAccepted: false,
    launchAllowed: false,
    replayAllowed: false,
    lockReleaseAllowed: false,
  };
}
module.exports = {
  run,
  inspect,
  command,
  boundPostmaster,
  sameProcess,
  environment,
  argumentsFor: c.argumentsFor,
};
