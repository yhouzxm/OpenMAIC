// TEST ONLY guardian I/O faults. Production launcher never selects this entry point.
const fs = require('node:fs'),
  path = require('node:path');
const stage = process.argv[2],
  mode = process.argv[3];
if (!/^\/tmp\/zhiban-observer-pg16-[A-Za-z0-9_-]+\/c[0-9]+\/observe-fixture_[0-9]+$/.test(stage))
  throw Error('DISPOSABLE_GUARDIAN_ONLY');
const write = fs.writeSync,
  fsync = fs.fsyncSync;
let first = true,
  failSync = false;
fs.writeSync = (fd, data, offset, length, ...rest) => {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  if (text.includes('GUARDIAN_DEPARTURE_AUTHORIZED')) {
    if (mode === 'release-positive-short')
      return write(fd, data, offset, Math.min(7, length), ...rest);
    if (['release-zero', 'release-zero-held-ack-lost'].includes(mode)) return 0;
    if (mode === 'release-partial-enospc') {
      if (first) {
        first = false;
        return write(fd, data, offset, Math.min(7, length), ...rest);
      }
      const e = Error('TEST_ENOSPC');
      e.code = 'ENOSPC';
      throw e;
    }
    if (mode === 'release-fsync') failSync = true;
  }
  return write(fd, data, offset, length, ...rest);
};
fs.fsyncSync = (fd) => {
  if (failSync) {
    failSync = false;
    const e = Error('TEST_FSYNC');
    e.code = 'EIO';
    throw e;
  }
  return fsync(fd);
};
const c = require('./observer-contract.cjs'),
  journal = c.journal;
const newFile = c.writeNew;
c.writeNew = (file, ...args) => {
  const result = newFile(file, ...args);
  if (
    mode === 'release-paused-after-authorization' &&
    path.basename(file) === 'guardian-release-authorized.json'
  )
    process.kill(process.pid, 'SIGSTOP');
  return result;
};
c.journal = (dir, event) =>
  journal(
    dir,
    event.state === 'GUARDIAN_DEPARTURE_AUTHORIZED' ? { ...event, testUnicode: '本地审计' } : event,
  );
require('./observer-guardian.cjs');
