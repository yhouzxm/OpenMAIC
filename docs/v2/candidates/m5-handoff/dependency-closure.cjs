// Offline STRUCTURAL closure check only. Does not resolve/download/copy/run packages.
const { keys, sha, canonical } = require('../m5-terminal/terminal-installation.cjs');
const digest = /^[a-f0-9]{64}$/;
function relative(p) {
  if (
    typeof p !== 'string' ||
    !p.length ||
    p.startsWith('/') ||
    p.includes('\\') ||
    p.includes('\0') ||
    p.split('/').some((s) => !s || s === '.' || s === '..')
  )
    throw Error('Closed release path rejected');
}
function verify(m) {
  keys(m, [
    'formatVersion',
    'status',
    'nodeAbi',
    'platform',
    'arch',
    'libc',
    'nodeExecutableSha256',
    'files',
    'edges',
    'nativeAddons',
    'systemLibraries',
    'dynamicImports',
    'unresolved',
    'evidenceOrigin',
  ]);
  if (
    m.formatVersion !== 1 ||
    m.status !== 'CLOSURE_DECLARED' ||
    m.evidenceOrigin !== 'LOCAL' ||
    !digest.test(m.nodeExecutableSha256) ||
    m.platform !== 'linux' ||
    m.arch !== 'x64' ||
    m.libc !== 'glibc' ||
    typeof m.nodeAbi !== 'string' ||
    !m.nodeAbi ||
    !Array.isArray(m.unresolved) ||
    m.unresolved.length
  )
    throw Error('Dependency policy/unknown edge rejected');
  for (const field of ['files', 'edges', 'nativeAddons', 'systemLibraries', 'dynamicImports'])
    if (!Array.isArray(m[field])) throw Error('Closure arrays required');
  const files = new Map();
  for (const f of m.files) {
    keys(f, ['path', 'sha256', 'kind']);
    relative(f.path);
    if (
      files.has(f.path) ||
      !digest.test(f.sha256) ||
      !['javascript', 'json', 'native', 'asset'].includes(f.kind)
    )
      throw Error('Closed file rejected');
    files.set(f.path, f);
  }
  if (!files.size) throw Error('Empty closure rejected');
  for (const e of m.edges) {
    keys(e, ['from', 'specifier', 'resolvedPath', 'resolutionKind']);
    relative(e.from);
    if (!files.has(e.from) || typeof e.specifier !== 'string' || !e.specifier)
      throw Error('Unknown import origin');
    if (e.resolutionKind === 'builtin') {
      if (!/^node:[a-z_]+(?:\/[a-z_]+)*$/.test(e.resolvedPath))
        throw Error('Builtin spelling required');
    } else if (e.resolutionKind === 'release') {
      relative(e.resolvedPath);
      if (!files.has(e.resolvedPath)) throw Error('Undeclared resolved file');
    } else throw Error('Ambient resolution forbidden');
  }
  for (const d of m.dynamicImports) {
    keys(d, ['from', 'specifier', 'resolvedPath', 'reviewRef']);
    relative(d.from);
    relative(d.resolvedPath);
    if (
      !d.reviewRef ||
      !m.edges.some(
        (e) =>
          e.from === d.from &&
          e.specifier === d.specifier &&
          e.resolvedPath === d.resolvedPath &&
          e.resolutionKind === 'release',
      )
    )
      throw Error('Dynamic edge unresolved/unreviewed');
  }
  const libraries = new Map();
  for (const l of m.systemLibraries) {
    keys(l, ['path', 'sha256', 'reviewRef']);
    if (
      !l.path.startsWith('/') ||
      l.path.includes('..') ||
      !digest.test(l.sha256) ||
      !l.reviewRef ||
      libraries.has(l.path)
    )
      throw Error('Exact reviewed OS library required');
    libraries.set(l.path, l);
  }
  const native = new Set();
  for (const n of m.nativeAddons) {
    keys(n, [
      'path',
      'sha256',
      'nodeAbi',
      'platform',
      'arch',
      'libc',
      'requiredLibraries',
      'reviewRef',
    ]);
    relative(n.path);
    if (
      files.get(n.path)?.kind !== 'native' ||
      files.get(n.path).sha256 !== n.sha256 ||
      n.nodeAbi !== m.nodeAbi ||
      n.platform !== m.platform ||
      n.arch !== m.arch ||
      n.libc !== m.libc ||
      !n.reviewRef ||
      native.has(n.path) ||
      !Array.isArray(n.requiredLibraries) ||
      n.requiredLibraries.some((p) => !libraries.has(p))
    )
      throw Error('Native ABI/library closure rejected');
    native.add(n.path);
  }
  if (
    [...files.values()].some(
      (f) => (f.path.endsWith('.node') || f.kind === 'native') && !native.has(f.path),
    )
  )
    throw Error('Undeclared native addon');
  return {
    status: 'STRUCTURAL_CLOSURE_ACCEPTED',
    manifestSha256: sha(canonical(m)),
    runtimeAccepted: false,
    physicalFilesVerified: false,
    loaderInstrumentationVerified: false,
    evidenceOrigin: 'LOCAL',
  };
}
module.exports = { verify, relative };
