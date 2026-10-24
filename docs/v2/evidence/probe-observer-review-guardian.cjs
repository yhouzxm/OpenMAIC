// TEST ONLY actual guardian with a forced regular-file short write at release intent.
const fs = require('node:fs'),
  path = require('node:path');
const stage = process.argv[2];
if (!/^\/tmp\/zhiban-observer-pg16-[A-Za-z0-9_-]+\/c[0-9]+\/observe-fixture_[0-9]+$/.test(stage))
  throw Error('DISPOSABLE_REVIEW_ONLY');
const write = fs.writeSync;
fs.writeSync = (fd, data, ...args) =>
  typeof data === 'string' && data.includes('LOCK_RELEASE_INTENT_AFTER_CONFIRMED_STOP')
    ? write(fd, data.slice(0, 7))
    : write(fd, data, ...args);
require(path.resolve(__dirname, '../candidates/m5-readonly-startup/observer-guardian.cjs'));
