// Independent OFD custodian. Departure authorization is not proof that the child has exited.
const fs = require('node:fs'),
  path = require('node:path'),
  c = require('./observer-contract.cjs'),
  custody = require('./observer-custody.cjs');
const stage = process.argv[2];
c.directory(stage);
const v = custody.intent(stage);
custody.guardAndLock(v, 3);
const alive = setInterval(() => {}, 1000);
let released = false,
  departureAttempted = false;
const identity = { pid: process.pid, startTicks: custody.ticks(process.pid) };
c.writeNew(path.join(stage, 'guardian.json'), JSON.stringify(identity) + '\n');
c.journal(stage, { state: 'LOCK_CUSTODIAN_READY', ...identity });
process.send({ type: 'ready', ...identity });
function record(event) {
  try {
    c.journal(stage, event);
    return true;
  } catch {
    return false;
  }
}
process.on('message', (m) => {
  if (released || departureAttempted || m?.type !== 'release-after-confirmed-stop') return;
  departureAttempted = true;
  try {
    const stop = custody.stopFact(stage);
    c.requireValue(
      m.stopProofSha256 === stop.sha256 && c.canonical(stop.p.guardian) === c.canonical(identity),
      'GUARDIAN_STOP_BINDING',
    );
    custody.guardAndLock(stop.v, 3);
    c.journal(stage, { state: 'GUARDIAN_DEPARTURE_AUTHORIZED', stopProofSha256: stop.sha256 });
    c.writeNew(
      path.join(stage, 'guardian-release-authorized.json'),
      JSON.stringify(custody.authorization(stage, stop)) + '\n',
    );
    // Parent still owns the shared OFD. It proves actual exit separately, even with lost IPC.
    fs.closeSync(3);
    released = true;
    const finish = () => {
      clearInterval(alive);
      if (process.connected) process.disconnect();
    };
    if (process.connected) {
      try {
        process.send({ type: 'released' }, finish);
      } catch {
        finish();
      }
    } else finish();
  } catch (e) {
    record({
      state: 'GUARDIAN_DEPARTURE_REJECTED',
      code: /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'PRIVATE_CUSTODY_ERROR',
    });
    if (!released && process.connected)
      process.send(
        { type: 'custody-held', ...identity, stopProofSha256: m.stopProofSha256 },
        () => {},
      );
  }
});
process.on('disconnect', () => {
  if (!released) record({ state: 'SUPERVISOR_LOST_LOCK_RETAINED', ...identity });
});
process.on('SIGTERM', () => {
  record({
    state: released ? 'GUARDIAN_DEPARTURE_NOTIFIED' : 'CUSTODIAN_TERMINATION_REFUSED',
    ...identity,
  });
});
process.on('error', () => {
  record({
    state: released ? 'DEPARTURE_NOTIFICATION_UNKNOWN' : 'CUSTODIAN_IPC_ERROR_LOCK_RETAINED',
    ...identity,
  });
});
