// Offline actual M1-M5 build. Never reads the live private root or opens PostgreSQL.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { createRequire, isBuiltin } = require('node:module'),
  { execFileSync } = require('node:child_process');
const c = require('./release-contract.cjs'),
  h = require('./handoff-contracts.cjs');
const ROOT = path.resolve(__dirname, '../../../..');
function write(file, raw) {
  c.directory(path.dirname(file));
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, raw);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(file, 0o400);
}
function sync(dir) {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function libs(file) {
  const out = execFileSync('/usr/bin/ldd', [file], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LANG: 'C' },
  });
  c.insist(!out.includes('not found'), 'Unresolved ELF library');
  return [
    ...new Set([...out.matchAll(/(?:=>\s+)?(\/[^\s]+)\s+\(/g)].map((x) => fs.realpathSync(x[1]))),
  ].sort();
}
function libraryAliases(file) {
  const out = execFileSync('/usr/bin/ldd', [file], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LANG: 'C' },
  });
  return [...new Set([...out.matchAll(/(?:=>\s+)?(\/[^\s]+)\s+\(/g)].map((x) => x[1]))].sort();
}
function scan(raw, from, acorn) {
  const edges = [],
    ast = acorn.parse(raw, { ecmaVersion: 'latest', sourceType: 'script' });
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'ImportExpression') throw Error('Runtime dynamic import forbidden');
    if (
      n.type === 'CallExpression' &&
      n.callee.type === 'Identifier' &&
      ['require', '__require', 'eval'].includes(n.callee.name)
    ) {
      c.insist(
        n.callee.name !== 'eval' &&
          n.arguments.length === 1 &&
          n.arguments[0].type === 'Literal' &&
          typeof n.arguments[0].value === 'string',
        'Nonliteral runtime loader rejected',
      );
      const spec = n.arguments[0].value;
      if (isBuiltin(spec))
        edges.push({
          from,
          specifier: spec,
          resolvedPath: spec.startsWith('node:') ? spec : 'node:' + spec,
          resolutionKind: 'builtin',
        });
      else {
        const rel = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
        c.relative(rel);
        c.insist(
          spec.startsWith('.') &&
            (rel === 'dependencies/argon2.node' ||
              (['host/validation-child.cjs', 'host/ordinary-host.cjs'].includes(from) &&
                rel === 'host/product.cjs')),
          'External package fallback forbidden',
        );
        edges.push({ from, specifier: spec, resolvedPath: rel, resolutionKind: 'release' });
      }
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  }
  walk(ast);
  return edges;
}
async function build(options) {
  c.keys(options, [
    'parentDirectory',
    'releaseId',
    'credentialGenerationId',
    'configurationPath',
    ...(Object.hasOwn(options, 'tlsPaths') ? ['tlsPaths'] : []),
  ]);
  c.directory(options.parentDirectory);
  c.insist(
    c.UUID.test(options.releaseId) && c.UUID.test(options.credentialGenerationId),
    'New release identifiers required',
  );
  c.insist(
    [
      'NODE_OPTIONS',
      'NODE_PATH',
      'ESBUILD_BINARY_PATH',
      'NAPI_RS_NATIVE_LIBRARY_PATH',
      'NAPI_RS_FORCE_WASI',
      'NODE_PG_FORCE_NATIVE',
      'LD_PRELOAD',
      'LD_LIBRARY_PATH',
    ].every((k) => !process.env[k]),
    'Ambient build override rejected',
  );
  const source = h.sources(),
    configRaw = c.bytes(options.configurationPath);
  c.config(JSON.parse(configRaw), options.releaseId, options.credentialGenerationId);
  c.insist(
    !options.configurationPath.startsWith('/home/zxm/.local/share/zhiban-m1/'),
    'Live configuration requires separate delivery; use reviewed staging input',
  );
  const baselineStart = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  c.insist(baselineStart === source.inv.baselineSha, 'Approved build baseline required');
  const out = path.join(options.parentDirectory, options.releaseId);
  fs.mkdirSync(out, { mode: 0o700 });
  for (const n of ['host', 'assets', 'metadata', 'dependencies'])
    fs.mkdirSync(path.join(out, n), { mode: 0o700 });
  const input = new Map();
  function capture(p) {
    const real = fs.realpathSync(p),
      raw = fs.readFileSync(real),
      hash = c.sha(raw);
    if (input.has(real)) c.insist(input.get(real) === hash, 'Source changed during build');
    input.set(real, hash);
    return raw;
  }
  function tree(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) tree(p);
      else if (/\.(ts|tsx|mts|js|mjs|cjs|json|sql|css|html)$/.test(ent.name)) capture(p);
    }
  }
  for (const p of [
    'lib/zhiban',
    'app/zhiban/local',
    ...['dsl', 'storage', 'renderer', 'editor'].flatMap((x) =>
      ['src', 'dist'].map((n) => 'packages/@openmaic/' + x + '/' + n),
    ),
  ])
    tree(path.join(ROOT, p));
  for (const n of [
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'scripts/zhiban-local/release-product.ts',
    ...['dsl', 'storage', 'renderer', 'editor'].map(
      (n) => 'packages/@openmaic/' + n + '/package.json',
    ),
  ])
    capture(path.join(ROOT, n));
  const dep = createRequire(require.resolve('tsx')),
    esbuildPath = dep.resolve('esbuild'),
    esbuild = dep('esbuild'),
    acornPath = path.join(ROOT, 'node_modules/.pnpm/acorn@8.16.0/node_modules/acorn/dist/acorn.js'),
    acorn = require(acornPath);
  capture(esbuildPath);
  const esbuildBinary = fs.realpathSync(
    createRequire(esbuildPath).resolve('@esbuild/linux-x64/bin/esbuild'),
  );
  capture(esbuildBinary);
  capture(acornPath);
  const nativePath = fs.realpathSync(
    createRequire(require.resolve('@node-rs/argon2')).resolve('@node-rs/argon2-linux-x64-gnu'),
  );
  const nativePackage = JSON.parse(capture(path.join(path.dirname(nativePath), 'package.json')));
  c.insist(
    nativePackage.version === '2.2.1' &&
      process.platform === 'linux' &&
      process.arch === 'x64' &&
      process.versions.node.startsWith('22.') &&
      process.report.getReport().header.glibcVersionRuntime,
    'Reviewed Linux Node22 native platform required',
  );
  const files = [];
  function leaf(name, raw, kind) {
    write(path.join(out, name), raw);
    files.push({ path: name, sha256: c.sha(raw), kind });
  }
  leaf('dependencies/argon2.node', capture(nativePath), 'native');
  leaf('ordinary.json', configRaw, 'json');
  if (options.tlsPaths) {
    c.keys(options.tlsPaths, ['certificatePath', 'privateKeyPath', 'caPath']);
    const raw = Object.fromEntries(
      Object.entries(options.tlsPaths).map(([k, p]) => {
        c.insist(
          !p.startsWith('/home/zxm/.local/share/zhiban-m1/'),
          'TLS requires reviewed staging',
        );
        return [k, c.bytes(p)];
      }),
    );
    require('./release-tls.cjs').inspect(raw.certificatePath, raw.privateKeyPath, raw.caPath);
    fs.mkdirSync(path.join(out, 'tls'), { mode: 0o700 });
    for (const [k, n] of [
      ['certificatePath', 'certificate.pem'],
      ['privateKeyPath', 'private-key.pem'],
      ['caPath', 'ca.pem'],
    ]) {
      c.insist(
        c.sha(capture(options.tlsPaths[k])) === c.sha(raw[k]),
        'TLS staging changed during build',
      );
      leaf('tls/' + n, raw[k], 'asset');
    }
    sync(path.join(out, 'tls'));
  }
  const plugin = {
    name: 'pinned-local-release',
    setup(b) {
      b.onResolve({ filter: /^\.\/product\.cjs$/ }, () => ({
        path: './product.cjs',
        external: true,
      }));
      b.onResolve({ filter: /^@node-rs\/argon2$/ }, () => ({
        path: '../dependencies/argon2.node',
        external: true,
      }));
      b.onResolve({ filter: /^(pg-native|pg-cloudflare)$/ }, (args) => ({
        path: args.path,
        namespace: 'node-only-disabled',
      }));
      b.onLoad({ filter: /.*/, namespace: 'node-only-disabled' }, (args) => ({
        contents: `module.exports = new Proxy({}, { get() { throw Object.assign(new Error('Unsupported ordinary transport'),{code:'MODULE_NOT_FOUND'}) } });`,
        loader: 'js',
      }));
      b.onLoad({ filter: /\.(cjs|mjs|js|ts|tsx|jsx|json|css)$/ }, (args) => ({
        contents: capture(args.path),
        loader:
          { ts: 'ts', tsx: 'tsx', jsx: 'jsx', json: 'json', css: 'css' }[
            path.extname(args.path).slice(1)
          ] || 'js',
        resolveDir: path.dirname(args.path),
      }));
    },
  };
  const builds = [];
  for (const [entry, name] of [
    ['scripts/zhiban-local/release-product.ts', 'host/product.cjs'],
    ['docs/v2/candidates/m5-handoff/validation-child.cjs', 'host/validation-child.cjs'],
    ['scripts/zhiban-local/release-https.ts', 'host/ordinary-host.cjs'],
  ]) {
    const r = await esbuild.build({
      absWorkingDir: ROOT,
      entryPoints: [entry],
      outfile: path.join(out, name),
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      metafile: true,
      logLevel: 'silent',
      plugins: [plugin],
    });
    leaf(name, r.outputFiles[0].contents, 'javascript');
    builds.push({ entry, name, metafile: r.metafile });
  }
  const browser = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: ['app/zhiban/local/content-client.tsx'],
    outfile: path.join(out, 'assets/content-client.js'),
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    minify: true,
    metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [plugin],
    logLevel: 'silent',
  });
  c.insist(
    browser.outputFiles.length === 1 && browser.outputFiles[0].path.endsWith('content-client.js'),
    'Unexpected browser output requires explicit asset binding',
  );
  leaf('assets/content-client.js', browser.outputFiles[0].contents, 'javascript');
  builds.push({
    entry: 'app/zhiban/local/content-client.tsx',
    name: 'assets/content-client.js',
    metafile: browser.metafile,
  });
  for (const name of [
    'content.html',
    'content.css',
    'index.html',
    'client.js',
    'style.css',
    'academic.js',
    'assessment.js',
    'learning.js',
  ])
    leaf(
      'assets/' + name,
      capture(path.join(ROOT, 'app/zhiban/local', name)),
      name.endsWith('.js') ? 'javascript' : 'asset',
    );
  leaf(
    'assets/content-csp.json',
    capture(path.join(ROOT, 'docs/v2/evidence/m5-content-csp-profile.json')),
    'json',
  );
  for (const name of [
    '04-complete-catalog.sql',
    '05-business-terminal-catalog.sql',
    '06-native-terminal-catalog.sql',
  ])
    leaf('metadata/' + name, capture(path.join(__dirname, name)), 'asset');
  leaf(
    'host/validation-guard.cjs',
    capture(path.join(__dirname, 'validation-guard.cjs')),
    'javascript',
  );
  leaf(
    'host/ordinary-guard.cjs',
    capture(path.join(__dirname, 'ordinary-guard.cjs')),
    'javascript',
  );
  const edges = [];
  for (const f of files.filter((x) => x.kind === 'javascript'))
    edges.push(...scan(c.bytes(path.join(out, f.path)).toString(), f.path, acorn));
  const libraryPaths = [
      ...new Set([...libs(fs.realpathSync(process.execPath)), ...libs(nativePath)]),
    ].sort(),
    systemLibraries = libraryPaths.map((p) => ({
      path: p,
      sha256: c.sha(capture(p)),
      reviewRef: 'CANDIDATE_ELF_CLOSURE_REQUIRES_APPROVAL',
    }));
  const node = fs.realpathSync(process.execPath);
  capture(node);
  const closure = {
    formatVersion: 1,
    status: 'CLOSURE_DECLARED',
    nodeAbi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    libc: 'glibc',
    nodeExecutableSha256: c.sha(fs.readFileSync(node)),
    files,
    edges,
    nativeAddons: [
      {
        path: 'dependencies/argon2.node',
        sha256: files[0].sha256,
        nodeAbi: process.versions.modules,
        platform: process.platform,
        arch: process.arch,
        libc: 'glibc',
        requiredLibraries: libs(nativePath),
        reviewRef: 'CANDIDATE_PINNED_ARGON2_2_2_1',
      },
    ],
    systemLibraries,
    dynamicImports: [],
    unresolved: [],
    evidenceOrigin: 'LOCAL',
  };
  for (const [p, hash] of input)
    c.insist(c.sha(fs.readFileSync(p)) === hash, 'Build input drift at final check');
  c.insist(
    h.sources().inventorySha256 === source.inventorySha256 &&
      c.sha(c.bytes(options.configurationPath)) === c.sha(configRaw),
    'Candidate/config changed during build',
  );
  c.insist(
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() ===
      baselineStart,
    'Build baseline changed',
  );
  const json = (v) => Buffer.from(JSON.stringify(v, null, 2) + '\n');
  write(path.join(out, 'closure-manifest.json'), json(closure));
  const manifest = {
    formatVersion: 1,
    status: 'BUILT_UNACTIVATED',
    releaseId: options.releaseId,
    credentialGenerationId: options.credentialGenerationId,
    sourceBindingsSha256: source.inventorySha256,
    ledgerBindings: h.ordinaryLedgers(source),
    workspacePackages: Object.fromEntries(
      ['storage', 'dsl', 'renderer', 'editor'].map((n) => {
        const file = path.join(ROOT, 'packages/@openmaic', n, 'package.json');
        const pkg = JSON.parse(capture(file));
        return [n, { version: pkg.version, packageSha256: input.get(fs.realpathSync(file)) }];
      }),
    ),
    baselineSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    configurationSha256: c.sha(configRaw),
    closureManifestSha256: c.sha(json(closure)),
    libraryAliases: [...new Set([...libraryAliases(node), ...libraryAliases(nativePath)])]
      .sort()
      .map((alias) => ({ alias, canonical: fs.realpathSync(alias) })),
    node: {
      version: process.versions.node,
      abi: process.versions.modules,
      path: node,
      sha256: closure.nodeExecutableSha256,
    },
    pnpmVersion: execFileSync('pnpm', ['--version'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    esbuild: {
      version: esbuild.version,
      path: esbuildPath,
      sha256: input.get(fs.realpathSync(esbuildPath)),
      binary: { path: esbuildBinary, sha256: input.get(esbuildBinary) },
    },
    compile: {
      bundle: true,
      packages: 'bundled',
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      nativeSelection: 'fixed Linux x64 glibc argon2 2.2.1; no WASI/env/fallback',
      disabledTransports: ['pg-native', 'pg-cloudflare'],
    },
    inputs: Object.fromEntries([...input].sort(([a], [b]) => a.localeCompare(b))),
    metafiles: builds,
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    launchAllowed: false,
    runtimeAccepted: false,
  };
  write(path.join(out, 'build-manifest.json'), json(manifest));
  const artifact = {
    formatVersion: 1,
    releaseId: options.releaseId,
    credentialGenerationId: options.credentialGenerationId,
    files: [
      ...files.map(({ path, sha256 }) => ({ path, sha256 })),
      ...['closure-manifest.json', 'build-manifest.json'].map((name) => ({
        path: name,
        sha256: c.sha(c.bytes(path.join(out, name))),
      })),
    ],
  };
  require('./physical-closure.cjs').verify(out, closure);
  for (const dir of ['host', 'assets', 'metadata', 'dependencies']) sync(path.join(out, dir));
  write(path.join(out, 'artifact-manifest.json'), json(artifact));
  sync(out);
  sync(options.parentDirectory);
  return {
    status: 'BUILT_UNACTIVATED',
    directory: out,
    releaseId: options.releaseId,
    artifactManifestSha256: c.sha(json(artifact)),
    buildManifestSha256: c.sha(json(manifest)),
    closureManifestSha256: c.sha(json(closure)),
    configurationSha256: c.sha(configRaw),
    files: artifact.files.length,
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    launchAllowed: false,
    runtimeAccepted: false,
  };
}
module.exports = { build, libs, scan };
