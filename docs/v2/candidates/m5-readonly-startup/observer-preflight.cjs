// Runs only after scoped signature verification; all selected inputs remain private.
const fs = require('node:fs'),
  path = require('node:path'),
  c = require('./observer-contract.cjs');
function configuration(v) {
  const files = new Map();
  for (const item of v.configurationClosure) {
    c.requireValue(!files.has(item.path), 'DUPLICATE_CONFIG');
    const raw = c.bytes(item.path);
    c.requireValue(c.sha(raw) === item.sha256, 'CONFIG_DRIFT');
    files.set(item.path, raw.toString('utf8'));
  }
  const visited = new Set(),
    active = new Set();
  function walk(file, auto = false) {
    c.requireValue(files.has(file) && !active.has(file), 'CONFIG_CLOSURE_INCOMPLETE');
    active.add(file);
    visited.add(file);
    for (const line of files.get(file).split('\n')) {
      if (/^\s*(#.*)?$/.test(line)) continue;
      c.requireValue(!/^\s*include_(?:dir|if_exists)\b/.test(line), 'UNSUPPORTED_CONFIG_INCLUDE');
      // No include_dir / optional files / escape-dependent paths. Conservative fail closed.
      const include = line.match(/^\s*include\s*(?:=\s*)?'([A-Za-z0-9_./-]+)'\s*(?:#.*)?$/);
      if (include && !auto) {
        walk(path.resolve(path.dirname(file), include[1]));
        continue;
      }
      c.requireValue(
        !/^\s*include\b/i.test(line),
        auto ? 'AUTO_CONFIGURATION_NOT_EMPTY' : 'UNSUPPORTED_CONFIG_INCLUDE_SYNTAX',
      );
      c.requireValue(
        !auto &&
          /^\s*[a-z][a-z0-9_]*\s*=\s*(?:'[^'\\\n]*'|[A-Za-z0-9_.+-]+)\s*(?:#.*)?$/.test(line),
        auto ? 'AUTO_CONFIGURATION_NOT_EMPTY' : 'UNREVIEWABLE_CONFIG_SYNTAX',
      );
    }
    active.delete(file);
  }
  walk(path.join(v.target.dataDirectory, 'postgresql.conf'));
  walk(path.join(v.target.dataDirectory, 'postgresql.auto.conf'), true);
  c.requireValue(visited.size === files.size, 'CONFIG_CLOSURE_EXTRA_FILE');
}
function guard(v) {
  const dir = v.paths.controlDirectory,
    raw = c.bytes(path.join(dir, 'maintenance.json'));
  c.requireValue(
    c.sha(raw) === v.hashes.guardSha256 &&
      ['BLOCKED', 'BLOCKED_UNTIL_CLOSED'].includes(JSON.parse(raw).status),
    'GUARD_DRIFT_OR_NOT_BLOCKED',
  );
}
function password(v) {
  const raw = c.bytes(v.paths.pgpassFilePath);
  c.requireValue(c.sha(raw) === v.hashes.pgpassSha256, 'PGPASS_DRIFT');
  // Only a single explicit entry; no wildcard or fallback credentials.
  const lines = raw
    .toString('utf8')
    .split('\n')
    .filter((x) => x && !x.startsWith('#'));
  c.requireValue(lines.length === 1, 'PGPASS_EXACT_ENTRY');
  const fields = [''];
  let escaped = false;
  for (const ch of lines[0]) {
    if (escaped) {
      fields[fields.length - 1] += ch;
      escaped = false;
    } else if (ch === '\\') escaped = true;
    else if (ch === ':') fields.push('');
    else fields[fields.length - 1] += ch;
  }
  c.requireValue(
    !escaped &&
      fields.length === 5 &&
      fields[0] === path.join(v.paths.stageDirectory, 'socket') &&
      fields[1] === String(v.target.port) &&
      fields[2] === 'postgres' &&
      fields[3] === 'postgres' &&
      fields[4].length > 0,
    'PGPASS_EXACT_ENTRY',
  );
  return raw;
}
function sealPassword(v, stage) {
  const raw = password(v),
    dir = v.paths.authenticationStageDirectory;
  c.directory(path.dirname(dir));
  fs.mkdirSync(dir, { mode: 0o700 });
  c.syncDir(path.dirname(dir));
  const file = path.join(dir, 'pgpass');
  c.writeNew(file, raw, 0o400);
  const s = fs.statSync(file),
    d = fs.statSync(dir);
  const snapshot = {
    path: file,
    sha256: c.sha(raw),
    device: s.dev,
    inode: s.ino,
    directoryDevice: d.dev,
    directoryInode: d.ino,
  };
  c.writeNew(path.join(stage, 'auth-snapshot.json'), JSON.stringify(snapshot) + '\n');
  return snapshot;
}
function snapshot(v, s) {
  c.directory(v.paths.authenticationStageDirectory);
  const d = fs.statSync(v.paths.authenticationStageDirectory),
    a = fs.lstatSync(s.path);
  c.requireValue(
    d.dev === s.directoryDevice &&
      d.ino === s.directoryInode &&
      a.dev === s.device &&
      a.ino === s.inode &&
      (a.mode & 0o777) === 0o400 &&
      c.sha(c.bytes(s.path)) === v.hashes.pgpassSha256 &&
      s.sha256 === v.hashes.pgpassSha256,
    'AUTHENTICATION_SNAPSHOT_DRIFT',
  );
}
function authentication(v, s) {
  password(v);
  snapshot(v, s);
}
function removeSnapshot(v, s) {
  if (!s) return;
  snapshot(v, s);
  fs.unlinkSync(s.path);
  c.syncDir(v.paths.authenticationStageDirectory);
  fs.rmdirSync(v.paths.authenticationStageDirectory);
  c.syncDir(path.dirname(v.paths.authenticationStageDirectory));
}
function binaries(v) {
  for (const n of ['postgres', 'pg_ctl', 'psql', 'pg_controldata']) {
    const file = path.join(c.bin, n);
    c.requireValue(
      c.sha(fs.readFileSync(file)) === v.binarySha256[n] && fs.realpathSync(file) === file,
      'BINARY_DRIFT',
    );
  }
  c.requireValue(
    c.sha(fs.readFileSync(process.execPath)) === v.binarySha256.node &&
      fs.realpathSync(process.execPath) === process.execPath,
    'NODE_BINARY_DRIFT',
  );
}
function inputs(v) {
  c.directory(v.target.dataDirectory);
  c.requireValue(
    c.bytes(path.join(v.target.dataDirectory, 'PG_VERSION')).toString().trim() === '16',
    'PG16_REQUIRED',
  );
  for (const n of ['standby.signal', 'recovery.signal', 'postmaster.pid'])
    c.requireValue(
      !fs.existsSync(path.join(v.target.dataDirectory, n)),
      'TARGET_NOT_CLEAN_STOPPED',
    );
  c.requireValue(path.join(v.paths.stageDirectory, 'socket').length < 90, 'SOCKET_PATH_TOO_LONG');
  guard(v);
  password(v);
  binaries(v);
  configuration(v);
  c.requireValue(
    c.sha(Buffer.from(c.canonical(c.argumentsFor(v)))) === v.expectedStartArgumentsSha256,
    'START_ARGUMENTS_DRIFT',
  );
}
module.exports = {
  inputs,
  guard,
  configuration,
  password,
  sealPassword,
  authentication,
  removeSnapshot,
};
