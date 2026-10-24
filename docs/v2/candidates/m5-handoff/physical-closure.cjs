const fs = require('node:fs'),
  path = require('node:path');
const c = require('./release-contract.cjs');
function verify(root, m) {
  c.directory(root);
  c.keys(m, [
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
  c.insist(
    m.formatVersion === 1 &&
      m.status === 'CLOSURE_DECLARED' &&
      m.evidenceOrigin === 'LOCAL' &&
      m.nodeAbi === process.versions.modules &&
      m.platform === process.platform &&
      m.arch === process.arch &&
      m.libc === 'glibc' &&
      process.report.getReport().header.glibcVersionRuntime &&
      c.sha(c.bytes(fs.realpathSync(process.execPath), false)) === m.nodeExecutableSha256,
    'Physical platform/Node binding rejected',
  );
  c.insist(
    Array.isArray(m.files) &&
      m.files.length > 0 &&
      Array.isArray(m.unresolved) &&
      !m.unresolved.length &&
      Array.isArray(m.dynamicImports) &&
      !m.dynamicImports.length,
    'Unresolved/dynamic dependency rejected',
  );
  const known = new Map();
  for (const f of m.files) {
    c.keys(f, ['path', 'sha256', 'kind']);
    c.relative(f.path);
    c.insist(
      !known.has(f.path) &&
        c.HASH.test(f.sha256) &&
        ['javascript', 'json', 'native', 'asset'].includes(f.kind),
      'Physical file declaration rejected',
    );
    c.insist(c.sha(c.bytes(path.join(root, f.path))) === f.sha256, 'Physical release byte drift');
    known.set(f.path, f);
  }
  for (const e of m.edges) {
    c.keys(e, ['from', 'specifier', 'resolvedPath', 'resolutionKind']);
    c.insist(
      known.has(e.from) && typeof e.specifier === 'string' && e.specifier.length,
      'Unknown dependency origin',
    );
    if (e.resolutionKind === 'release')
      c.insist(known.has(e.resolvedPath), 'Unbound dependency leaf');
    else
      c.insist(
        e.resolutionKind === 'builtin' && require('node:module').isBuiltin(e.resolvedPath),
        'Ambient dependency rejected',
      );
  }
  const libraries = new Map();
  for (const l of m.systemLibraries) {
    c.keys(l, ['path', 'sha256', 'reviewRef']);
    c.insist(
      path.isAbsolute(l.path) &&
        fs.realpathSync(l.path) === l.path &&
        c.HASH.test(l.sha256) &&
        l.reviewRef === 'CANDIDATE_ELF_CLOSURE_REQUIRES_APPROVAL' &&
        !libraries.has(l.path) &&
        c.sha(c.bytes(l.path, false)) === l.sha256,
      'Physical OS library drift',
    );
    libraries.set(l.path, l);
  }
  c.insist(libraries.size > 0 && m.nativeAddons.length === 1, 'Exact native/ELF closure required');
  for (const n of m.nativeAddons) {
    c.keys(n, [
      'path',
      'sha256',
      'nodeAbi',
      'platform',
      'arch',
      'libc',
      'requiredLibraries',
      'reviewRef',
    ]);
    c.insist(
      known.get(n.path)?.kind === 'native' &&
        known.get(n.path).sha256 === n.sha256 &&
        n.nodeAbi === m.nodeAbi &&
        n.platform === m.platform &&
        n.arch === m.arch &&
        n.libc === m.libc &&
        n.reviewRef === 'CANDIDATE_PINNED_ARGON2_2_2_1' &&
        Array.isArray(n.requiredLibraries) &&
        n.requiredLibraries.every((x) => libraries.has(x)),
      'Native ABI declaration rejected',
    );
  }
  const allowed = new Set([
    ...known.keys(),
    'closure-manifest.json',
    'build-manifest.json',
    'artifact-manifest.json',
    'handoff-receipt.json',
    'host-validation-ack.json',
  ]);
  function walk(dir, prefix = '') {
    c.directory(dir);
    for (const name of fs.readdirSync(dir)) {
      const rel = prefix + name,
        p = path.join(dir, name),
        s = fs.lstatSync(p);
      if (s.isDirectory()) {
        c.insist(
          [...allowed].some((x) => x.startsWith(rel + '/')),
          'Unknown closure directory',
        );
        walk(p, rel + '/');
      } else {
        c.bytes(p);
        c.insist(allowed.has(rel), 'Unbound closure leaf');
      }
    }
  }
  walk(root);
  return {
    physicalFilesVerified: true,
    nativeAbiLibrariesVerified: true,
    runtimeAccepted: false,
    launchAllowed: false,
  };
}
function loadedLibraries(m, aliases) {
  const aliasMap = new Map(aliases.map((x) => [x.alias, x.canonical]));
  const allowed = new Map(m.systemLibraries.map((x) => [x.path, x.sha256]));
  const native = new Set(m.nativeAddons.map((x) => x.path));
  const observed = [];
  for (const p of process.report.getReport().sharedObjects) {
    if (!path.isAbsolute(p)) continue;
    const real = p.endsWith('.node') ? fs.realpathSync(p) : allowed.has(p) ? p : aliasMap.get(p);
    c.insist(real, 'Unbound loaded ELF alias');
    if (real.endsWith('.node')) {
      c.insist(
        [...native].some((x) => real.endsWith('/' + x)),
        'Unknown loaded native module',
      );
      continue;
    }
    c.insist(
      allowed.has(real) && c.sha(c.bytes(real, false)) === allowed.get(real),
      'Undeclared loaded OS library',
    );
    observed.push({ path: real, sha256: allowed.get(real) });
  }
  return observed;
}
function codeDigest(m) {
  return c.sha(
    c.canonical({
      nodeAbi: m.nodeAbi,
      nodeExecutableSha256: m.nodeExecutableSha256,
      platform: m.platform,
      arch: m.arch,
      libc: m.libc,
      files: m.files.filter((x) => x.path !== 'ordinary.json' && !x.path.startsWith('tls/')),
      edges: m.edges,
      nativeAddons: m.nativeAddons,
      systemLibraries: m.systemLibraries,
    }),
  );
}
module.exports = { verify, loadedLibraries, codeDigest };
