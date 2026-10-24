// Self-contained preload; parent verifies its bytes before execution.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  Module = require('node:module');
const root = process.argv[3];
if (
  process.argv[2] !== '--validate-handoff' ||
  !path.isAbsolute(root) ||
  fs.realpathSync(root) !== root
)
  throw Error('Validation mode/root rejected');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex'),
  manifest = JSON.parse(fs.readFileSync(path.join(root, 'closure-manifest.json'))),
  config = JSON.parse(fs.readFileSync(path.join(root, 'ordinary.json'))),
  known = new Map(manifest.files.map((f) => [path.join(root, f.path), f.sha256]));
const state = { loaded: [], native: [], connections: 0, listenAttempts: 0, writesDenied: 0 };
function leaf(p) {
  const real = fs.realpathSync(p),
    s = fs.lstatSync(p);
  if (
    real !== p ||
    !s.isFile() ||
    s.nlink !== 1 ||
    s.uid !== process.getuid() ||
    s.mode & 0o077 ||
    !known.has(real) ||
    sha(fs.readFileSync(real)) !== known.get(real)
  )
    throw Error('Validation runtime dependency drift');
  return real;
}
const load = Module._load,
  resolve = Module._resolveFilename;
Module._load = function (request, parent, isMain) {
  if (Module.isBuiltin(request)) {
    if (
      ['child_process', 'worker_threads', 'dgram', 'vm', 'inspector', 'wasi'].some(
        (n) => request === n || request === 'node:' + n,
      )
    )
      throw Error('Unsupported validation capability');
    return load.apply(this, arguments);
  }
  const resolved = leaf(resolve.call(Module, request, parent, isMain));
  state.loaded.push(path.relative(root, resolved));
  return load.apply(this, arguments);
};
const dlopen = process.dlopen;
process.dlopen = function (m, p, flags) {
  const real = leaf(p);
  if (
    !manifest.nativeAddons.some((x) => path.join(root, x.path) === real) ||
    process.versions.modules !== manifest.nodeAbi
  )
    throw Error('Unknown native ABI/path');
  state.native.push(path.relative(root, real));
  return flags === undefined ? dlopen.call(process, m, p) : dlopen.call(process, m, p, flags);
};
const net = require('node:net'),
  connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  let args = a;
  while (Array.isArray(args[0])) args = args[0];
  const o = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
  if (o.host !== '127.0.0.1' || Number(o.port) !== config.target.port || o.path)
    throw Error('Unapproved validation network endpoint');
  state.connections++;
  return connect.apply(this, a);
};
net.Server.prototype.listen = function () {
  state.listenAttempts++;
  throw Error('Validation child must not listen');
};
globalThis.fetch = () => {
  throw Error('Validation external fetch forbidden');
};
for (const name of [
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'mkdir',
  'mkdirSync',
  'rm',
  'rmSync',
  'unlink',
  'unlinkSync',
  'rename',
  'renameSync',
  'symlink',
  'symlinkSync',
  'link',
  'linkSync',
  'truncate',
  'truncateSync',
  'chmod',
  'chmodSync',
  'chown',
  'chownSync',
])
  if (typeof fs[name] === 'function')
    fs[name] = function () {
      state.writesDenied++;
      throw Error('Validation filesystem mutation forbidden');
    };
const promises = require('node:fs/promises');
for (const n of [
  'writeFile',
  'appendFile',
  'mkdir',
  'rm',
  'unlink',
  'rename',
  'symlink',
  'link',
  'truncate',
  'chmod',
  'chown',
])
  promises[n] = async () => {
    state.writesDenied++;
    throw Error('Validation filesystem mutation forbidden');
  };
Object.defineProperty(globalThis, '__zhibanValidation', {
  value: state,
  writable: false,
  configurable: false,
});
