// Linux OFD flock shared by launcher and maintenance; flag survives process death.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function privateDirectory(dir) {
  if (!path.isAbsolute(dir) || fs.realpathSync(dir) !== dir)
    throw Error('Private real directory required');
  const s = fs.lstatSync(dir);
  if (!s.isDirectory() || s.uid !== process.getuid() || s.mode & 0o077)
    throw Error('Private directory rejected');
}
function syncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function writeExclusive(file, value) {
  privateDirectory(path.dirname(file));
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDir(path.dirname(file));
}
function acquire(dir, mode, recovery = false) {
  privateDirectory(dir);
  const file = path.join(dir, 'maintenance.lock'),
    flag = path.join(dir, 'maintenance.json');
  const fd = fs.openSync(
    file,
    fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW,
    0o600,
  );
  let held = false;
  try {
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.uid !== process.getuid() || s.mode & 0o077 || s.nlink !== 1)
      throw Error('Lock file rejected');
    execFileSync('/usr/bin/flock', ['-n', mode === 'launcher' ? '-s' : '-x', '3'], {
      stdio: ['ignore', 'ignore', 'ignore', fd],
    });
    held = true;
    if (fs.existsSync(flag) && (mode === 'launcher' || !recovery))
      throw Error('Maintenance flag already present');
    if (mode !== 'launcher' && !fs.existsSync(flag))
      writeExclusive(
        flag,
        JSON.stringify({ status: 'BLOCKED_UNTIL_CLOSED', pid: process.pid }) + '\n',
      );
    let live = true;
    return {
      fd, // Inherit in launched host so killing its parent cannot release its shared lock.
      assert() {
        if (
          !live ||
          fs.statSync(file).ino !== s.ino ||
          (mode !== 'launcher' && !fs.existsSync(flag))
        )
          throw Error('Maintenance lock lost');
      },
      // Caller may clear only after confirmed CLOSED; never in error/finally.
      clearAfterClosed() {
        this.assert();
        if (mode === 'launcher') throw Error('Launcher cannot clear flag');
        fs.unlinkSync(flag);
        syncDir(dir);
      },
      release() {
        if (live) {
          live = false;
          fs.closeSync(fd);
        }
      },
    };
  } catch (e) {
    fs.closeSync(fd);
    throw Error(
      held ? 'Maintenance flag rejects entry' : 'Maintenance/launcher lock busy or invalid',
    );
  }
}
module.exports = { acquire, privateDirectory, writeExclusive, syncDir };
