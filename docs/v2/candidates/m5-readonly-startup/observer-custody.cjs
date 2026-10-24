// Local closure facts only. No signer, unlock API, or runtime/clear capability.
const fs = require('node:fs'),
  path = require('node:path'),
  c = require('./observer-contract.cjs');
function ticks(pid) {
  const s = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
  return s.slice(s.lastIndexOf(') ') + 2).split(' ')[19];
}
function binding(intent) {
  return {
    attemptId: intent.attemptId,
    approvalSha256: intent.approvalSha256,
    source: intent.source,
    target: intent.target,
    guardSha256: intent.guardSha256,
    lock: intent.lock,
  };
}
function intent(stage) {
  const v = JSON.parse(c.bytes(path.join(stage, 'intent.json')));
  c.requireValue(
    v.status === 'OBSERVATION_INTENT' && v.paths.stageDirectory === stage,
    'CUSTODY_INTENT',
  );
  return v;
}
function guardAndLock(v, fd) {
  c.directory(v.paths.controlDirectory);
  const guard = c.bytes(path.join(v.paths.controlDirectory, 'maintenance.json'));
  c.requireValue(
    c.sha(guard) === v.guardSha256 &&
      ['BLOCKED', 'BLOCKED_UNTIL_CLOSED'].includes(JSON.parse(guard).status),
    'CUSTODY_GUARD_DRIFT',
  );
  const a = fs.fstatSync(fd),
    b = fs.lstatSync(path.join(v.paths.controlDirectory, 'maintenance.lock'));
  c.requireValue(
    a.isFile() &&
      b.isFile() &&
      a.dev === v.lock.device &&
      a.ino === v.lock.inode &&
      b.dev === a.dev &&
      b.ino === a.ino &&
      b.uid === process.getuid() &&
      b.nlink === 1 &&
      !(b.mode & 0o077),
    'CUSTODY_LOCK_DRIFT',
  );
}
function held(identity, v) {
  try {
    const s = fs.statSync('/proc/' + identity.pid + '/fd/3');
    return (
      ticks(identity.pid) === identity.startTicks &&
      fs.realpathSync('/proc/' + identity.pid + '/exe') === process.execPath &&
      s.dev === v.lock.device &&
      s.ino === v.lock.inode
    );
  } catch {
    return false;
  }
}
function stopFact(stage) {
  const v = intent(stage),
    raw = c.bytes(path.join(stage, 'stop-proof.json')),
    p = JSON.parse(raw);
  c.keys(p, [
    'formatVersion',
    'purpose',
    'evidenceOrigin',
    'githubActions',
    ...Object.keys(binding(v)),
    'pgState',
    'postmaster',
    'guardian',
  ]);
  c.requireValue(
    p.formatVersion === 1 &&
      p.purpose === 'LOCAL_OBSERVER_STOP_FACT' &&
      p.evidenceOrigin === 'LOCAL' &&
      p.githubActions === false &&
      c.canonical(binding(p)) === c.canonical(binding(v)),
    'STOP_FACT_BINDING',
  );
  c.requireValue(
    c.canonical(p.guardian) === c.canonical(JSON.parse(c.bytes(path.join(stage, 'guardian.json')))),
    'STOP_FACT_GUARDIAN',
  );
  c.requireValue(['STOP_CONFIRMED', 'NOT_STARTED'].includes(p.pgState), 'STOP_FACT_STATE');
  if (p.pgState === 'STOP_CONFIRMED') {
    c.requireValue(
      p.postmaster &&
        p.postmaster.dataDirectory === v.target.dataDirectory &&
        p.postmaster.port === v.target.port &&
        p.postmaster.socket === path.join(stage, 'socket') &&
        p.postmaster.executable === path.join(c.bin, 'postgres'),
      'STOP_FACT_POSTMASTER',
    );
    let live = false;
    try {
      live = ticks(p.postmaster.pid) === p.postmaster.startTicks;
    } catch (e) {
      c.requireValue(['ENOENT', 'ESRCH'].includes(e.code), 'STOP_FACT_PROCESS_UNKNOWN');
    }
    c.requireValue(!live, 'STOP_FACT_PROCESS_LIVE');
  } else c.requireValue(p.postmaster === null, 'NOT_STARTED_FACT');
  c.requireValue(
    !fs.existsSync(path.join(v.target.dataDirectory, 'postmaster.pid')) &&
      !fs.existsSync(path.join(stage, 'socket', '.s.PGSQL.' + v.target.port)),
    'STOP_FACT_ENDPOINT_PRESENT',
  );
  return { v, p, sha256: c.sha(raw) };
}
function authorization(stage, stop) {
  return {
    formatVersion: 1,
    purpose: 'LOCAL_OBSERVER_GUARDIAN_DEPARTURE_AUTHORIZATION',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    ...binding(stop.v),
    guardian: stop.p.guardian,
    stopProofSha256: stop.sha256,
  };
}
function departure(stage, stop) {
  const raw = c.bytes(path.join(stage, 'guardian-release-authorized.json')),
    p = JSON.parse(raw);
  c.keys(p, Object.keys(authorization(stage, stop)));
  c.requireValue(
    c.canonical(p) === c.canonical(authorization(stage, stop)),
    'GUARDIAN_AUTHORIZATION_BINDING',
  );
  return c.sha(raw);
}
function resident(stage, fd) {
  const identity = { pid: process.pid, startTicks: ticks(process.pid) },
    timer = setInterval(() => {}, 1000);
  const refuse = () => {
    try {
      c.journal(stage, { state: 'PARENT_CUSTODY_TERMINATION_REFUSED', ...identity });
    } catch {}
  };
  process.on('SIGTERM', refuse);
  process.on('SIGINT', refuse);
  try {
    c.journal(stage, { state: 'PARENT_CUSTODY_HELD', ...identity });
  } catch {}
  // No release method: explicit reviewed recovery is required. fd is intentionally retained.
  return { identity, timer, fd };
}
module.exports = {
  ticks,
  binding,
  intent,
  guardAndLock,
  held,
  stopFact,
  authorization,
  departure,
  resident,
};
