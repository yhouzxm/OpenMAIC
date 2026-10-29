#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Bootstrap runs before dependency installation. */
'use strict';
/** Owner-only LOCAL installation and physical PG16 transfer. Never a production installer. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const bin = '/usr/lib/postgresql/16/bin';
const official = 'c0f296aa36096ec3d1e1e2b94a7a48e20075e0a1';
const tlsNames = ['localhost.crt', 'localhost.key', 'development-ca.crt', 'receipt.json'];
function check(v, message) {
  if (!v) throw Error(message);
}
function run(cmd, args, options = {}) {
  return cp.execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}
function json(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function write(p, v) {
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
function absolute(p) {
  check(
    typeof p === 'string' && path.resolve(p) === p && p !== '/',
    'Canonical absolute path required',
  );
  return p;
}
function ancestors(p) {
  absolute(p);
  let current = '/';
  for (const part of p.split('/').filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      check(!fs.lstatSync(current, { throwIfNoEntry: false }), 'Dangling path rejected');
      break;
    }
    check(!fs.lstatSync(current).isSymbolicLink(), 'Symlink ancestor rejected');
  }
}
function privatePath(p, directory = false) {
  ancestors(p);
  const s = fs.lstatSync(p);
  check(
    s.uid === process.getuid() && !(s.mode & 0o077) && (directory ? s.isDirectory() : s.isFile()),
    'Private owned file/directory required',
  );
}
function absent(p) {
  ancestors(p);
  check(!fs.lstatSync(p, { throwIfNoEntry: false }), 'Target exists; refusing overwrite');
  check(fs.statSync(path.dirname(p)).isDirectory(), 'Target parent must exist');
}
function tree(root, base = '', privateFiles = false) {
  const out = {};
  for (const e of fs
    .readdirSync(path.join(root, base), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.join(base, e.name),
      full = path.join(root, rel);
    check(e.isDirectory() || e.isFile(), 'Links/devices rejected');
    if (privateFiles) privatePath(full, e.isDirectory());
    check(fs.lstatSync(full).uid === process.getuid(), 'Foreign-owned tree entry rejected');
    if (e.isDirectory()) Object.assign(out, tree(root, rel, privateFiles));
    else out[rel] = hash(fs.readFileSync(full));
  }
  return out;
}
const canonical = (v) => JSON.stringify(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
function host() {
  check(
    process.platform === 'linux' && process.arch === 'x64' && os.endianness() === 'LE',
    'Linux x64 LE required for this physical restore profile',
  );
  check(
    /^v22\./.test(process.version) && Number(process.versions.node.split('.')[1]) >= 19,
    'Node >=22.19 within major 22 required',
  );
  check(run('pnpm', ['--version']).trim() === '10.28.0', 'pnpm 10.28.0 required');
  const pg = run(path.join(bin, 'postgres'), ['--version']).trim();
  check(/PostgreSQL\) 16\./.test(pg), 'PostgreSQL 16 required');
  for (const [cmd, args] of [
    ['git', ['--version']],
    ['python3', ['--version']],
    ['tar', ['--version']],
    ['rg', ['--version']],
  ])
    run(cmd, args);
  return {
    platform: process.platform,
    arch: process.arch,
    endian: os.endianness(),
    pg,
    nodeMajor: 22,
    pnpm: '10.28.0',
  };
}
function envelope(p, kind, pin) {
  privatePath(p, true);
  privatePath(path.join(p, 'MANIFEST.json'));
  const bytes = fs.readFileSync(path.join(p, 'MANIFEST.json'));
  check(/^[a-f0-9]{64}$/.test(pin) && hash(bytes) === pin, 'Manifest pin mismatch');
  const m = JSON.parse(bytes);
  check(
    m.kind === kind && m.evidenceOrigin === 'LOCAL' && m.githubActions === false,
    'Package kind rejected',
  );
  const actual = tree(p, '', true);
  delete actual['MANIFEST.json'];
  check(canonical(actual) === canonical(m.files), 'Package file/hash closure mismatch');
  return m;
}
function finish(p, fields) {
  const m = {
    ...fields,
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    createdAt: new Date().toISOString(),
    files: tree(p, '', true),
  };
  write(path.join(p, 'MANIFEST.json'), m);
  return {
    path: p,
    manifestSha256: hash(fs.readFileSync(path.join(p, 'MANIFEST.json'))),
    evidenceOrigin: 'LOCAL',
    githubActions: false,
  };
}
function pack(root, output) {
  host();
  absent(output);
  fs.mkdirSync(output, { mode: 0o700 });
  const handoff = require(path.join(root, 'scripts/zhiban-handoff.cjs'));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-portable-source-'));
  try {
    const result = handoff.pack(root, temporary);
    fs.copyFileSync(result.archive, path.join(output, 'source.tar.gz'));
    fs.chmodSync(path.join(output, 'source.tar.gz'), 0o600);
    const m = json(path.join(result.output, 'HANDOFF.json'));
    check(
      m.officialPin === official && /^[a-f0-9]{40}$/.test(m.baselineHead),
      'Source anchors rejected',
    );
    const objects =
      run('git', ['rev-list', '--objects', '--no-walk', m.baselineHead, official], { cwd: root })
        .trim()
        .split('\n')
        .map((x) => x.split(' ')[0])
        .join('\n') + '\n';
    const fd = fs.openSync(path.join(output, 'anchors.pack'), 'wx', 0o600);
    try {
      run('git', ['pack-objects', '--stdout'], {
        cwd: root,
        input: objects,
        stdio: ['pipe', fd, 'pipe'],
      });
    } finally {
      fs.closeSync(fd);
    }
    fs.copyFileSync(__filename, path.join(output, 'install.cjs'));
    fs.chmodSync(path.join(output, 'install.cjs'), 0o600);
    // Bootstrap's source verifier is delivered independently; target needs no checkout/dependencies.
    fs.copyFileSync(
      path.join(root, 'scripts/zhiban-handoff.cjs'),
      path.join(output, 'zhiban-handoff.cjs'),
    );
    fs.chmodSync(path.join(output, 'zhiban-handoff.cjs'), 0o600);
    return finish(output, {
      kind: 'ZHIBAN_INDEPENDENT_INSTALL_V1',
      host: host(),
      baselineHead: m.baselineHead,
      branch: m.branch,
      officialPin: official,
      sourceDigest: m.sourceDigest,
      scope: 'DIRTY_SOURCE_AND_TWO_SHALLOW_GIT_ANCHORS_NO_PRIVATE_DATA',
      dependencies: 'FROZEN_INSTALL_REQUIRED_NOT_BUNDLED',
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
function verifyKit(kit, pin) {
  const m = envelope(kit, 'ZHIBAN_INDEPENDENT_INSTALL_V1', pin);
  check(
    m.officialPin === official && /^[a-f0-9]{40}$/.test(m.baselineHead),
    'Git anchors rejected',
  );
  check(
    canonical(m.files).length &&
      Object.keys(m.files).sort().join(',') ===
        'anchors.pack,install.cjs,source.tar.gz,zhiban-handoff.cjs',
    'Unexpected installation files',
  );
  const checked = require(path.join(kit, 'zhiban-handoff.cjs')).verify(
    path.join(kit, 'source.tar.gz'),
  );
  check(checked.sourceDigest === m.sourceDigest, 'Source digest mismatch');
  return m;
}
const extract = String.raw`
import tarfile,sys,pathlib,os,json
with tarfile.open(sys.argv[1],'r:gz') as t:
 m=json.load(t.extractfile('HANDOFF.json'))
 for name,facts in m['files'].items():
  p=pathlib.PurePosixPath(name)
  assert not p.is_absolute() and '..' not in p.parts and '.' not in p.parts
  target=pathlib.Path(sys.argv[2])/name;target.parent.mkdir(parents=True,exist_ok=True)
  with open(target,'xb') as f:f.write(t.extractfile('source/'+name).read())
  os.chmod(target,facts['mode'])
`;
function install(kit, target, pin, offline) {
  const machine = host(),
    m = verifyKit(kit, pin);
  check(
    machine.platform === m.host.platform && machine.arch === m.host.arch,
    'Installation platform mismatch',
  );
  absent(target);
  fs.mkdirSync(target, { mode: 0o700 });
  // A failed install is retained and never receives INSTALLATION.json; retry uses a fresh target.
  write(path.join(target, '.INSTALLING.json'), {
    kind: 'LOCAL_INCOMPLETE_INSTALL',
    manifestSha256: pin,
  });
  run('python3', ['-c', extract, path.join(kit, 'source.tar.gz'), target]);
  run('git', ['init', '--quiet'], { cwd: target });
  const packFd = fs.openSync(path.join(kit, 'anchors.pack'), 'r');
  try {
    run('git', ['index-pack', '--stdin'], { cwd: target, stdio: [packFd, 'pipe', 'pipe'] });
  } finally {
    fs.closeSync(packFd);
  }
  fs.writeFileSync(
    path.join(target, '.git/shallow'),
    [...new Set([m.baselineHead, official])].join('\n') + '\n',
  );
  run('git', ['check-ref-format', 'refs/heads/' + m.branch], { cwd: target });
  run('git', ['symbolic-ref', 'HEAD', 'refs/heads/' + m.branch], { cwd: target });
  run('git', ['update-ref', 'refs/heads/' + m.branch, m.baselineHead], { cwd: target });
  run('git', ['read-tree', 'HEAD'], { cwd: target });
  run('git', ['cat-file', '-e', official + ':packages/@openmaic/dsl/src'], { cwd: target });
  run('pnpm', ['install', '--frozen-lockfile', ...(offline ? ['--offline'] : [])], {
    cwd: target,
    stdio: 'inherit',
  });
  write(path.join(target, 'INSTALLATION.json'), {
    kind: 'LOCAL_INDEPENDENT_INSTALLATION_V1',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    kitManifestSha256: pin,
    sourceDigest: m.sourceDigest,
    baselineHead: m.baselineHead,
    officialPin: official,
    workspace: target,
    host: machine,
    dependencies: 'FROZEN_LOCAL_INSTALL',
    scope: 'NOT_PRODUCTION',
    installedAt: new Date().toISOString(),
  });
  fs.unlinkSync(path.join(target, '.INSTALLING.json'));
  return { status: 'INSTALLED', workspace: target, sourceDigest: m.sourceDigest };
}
function inspectSnapshot(snapshot, pin) {
  privatePath(snapshot, true);
  privatePath(path.join(snapshot, 'manifest.json'));
  const bytes = fs.readFileSync(path.join(snapshot, 'manifest.json'));
  check(/^[a-f0-9]{64}$/.test(pin) && hash(bytes) === pin, 'Snapshot manifest pin mismatch');
  const m = JSON.parse(bytes);
  check(
    m.kind === 'LOCAL_PG16_PERSISTENT_SNAPSHOT_V1' &&
      m.evidenceOrigin === 'LOCAL' &&
      m.githubActions === false &&
      /^\/tmp\/zhiban-trial-content-[a-zA-Z0-9]+$/.test(m.originalRoot),
    'Snapshot binding rejected',
  );
  privatePath(path.join(snapshot, 'root'), true);
  return m;
}
function validateSnapshot(snapshot, pin) {
  const m = inspectSnapshot(snapshot, pin);
  check(
    canonical(tree(path.join(snapshot, 'root'))) === canonical(m.files),
    'Snapshot file/hash closure mismatch',
  );
  check(
    fs.readdirSync(snapshot).sort().join(',') === 'manifest.json,root',
    'Unexpected snapshot files',
  );
  check(
    fs.readFileSync(path.join(snapshot, 'root/data/PG_VERSION'), 'utf8').trim() === '16',
    'PG16 snapshot required',
  );
  return m;
}
function copyPrivate(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
  // Private delivery removes group/world access, including generated JS assets.
  function restrict(p) {
    const stat = fs.lstatSync(p);
    check(
      !stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()),
      'Private copy type rejected',
    );
    fs.chmodSync(p, stat.mode & 0o700);
    if (stat.isDirectory()) for (const n of fs.readdirSync(p)) restrict(path.join(p, n));
  }
  restrict(target);
  privatePath(target, fs.statSync(target).isDirectory());
}
function exportPrivate(snapshot, tls, output, pin) {
  const machine = host(),
    m = validateSnapshot(snapshot, pin);
  privatePath(tls, true);
  for (const n of tlsNames) privatePath(path.join(tls, n));
  const receipt = json(path.join(tls, 'receipt.json'));
  check(
    hash(fs.readFileSync(path.join(tls, 'localhost.crt'))) === receipt.certificateHash &&
      hash(fs.readFileSync(path.join(tls, 'development-ca.crt'))) === receipt.caCertificateHash,
    'TLS pins rejected',
  );
  absent(output);
  fs.mkdirSync(output, { mode: 0o700 });
  copyPrivate(snapshot, path.join(output, 'snapshot'));
  fs.mkdirSync(path.join(output, 'tls'), { mode: 0o700 });
  for (const n of tlsNames) copyPrivate(path.join(tls, n), path.join(output, 'tls', n));
  validateSnapshot(path.join(output, 'snapshot'), pin);
  return finish(output, {
    kind: 'ZHIBAN_PRIVATE_RESTORE_V1',
    host: machine,
    snapshotManifestSha256: pin,
    originalRoot: m.originalRoot,
    origin: 'https://127.0.0.1:3461',
    scope: 'SENSITIVE_SYNTHETIC_LOCAL_DATA_SAME_PHYSICAL_ROOT_NO_NEW_AUTHORITY',
    sensitiveContents: [
      'database rows and synthetic accounts/authorization material',
      'saved encrypted workspace provider credentials, if present',
      'native instance-secret key; keep private together with the database',
      'localhost development TLS private key',
    ],
    excluded: [
      'host model configuration files (.env.local/openmaic.yml)',
      'external scanner authority',
      'Native maintenance authorization',
      'production approval',
    ],
  });
}
function importPrivate(bundle, state, pin) {
  const machine = host(),
    m = envelope(bundle, 'ZHIBAN_PRIVATE_RESTORE_V1', pin);
  check(canonical(machine) === canonical(m.host), 'Physical PG host profile mismatch');
  const s = validateSnapshot(path.join(bundle, 'snapshot'), m.snapshotManifestSha256);
  check(
    m.originalRoot === s.originalRoot && m.origin === 'https://127.0.0.1:3461',
    'Restore target binding rejected',
  );
  // Restored signatures/DSNs keep the original internal root. Refuse coexistence/overwrite.
  absent(s.originalRoot);
  absent(state);
  fs.mkdirSync(state, { mode: 0o700 });
  try {
    fs.mkdirSync(path.join(state, 'snapshots'), { mode: 0o700 });
    const destination = path.join(state, 'snapshots', 'imported');
    copyPrivate(path.join(bundle, 'snapshot'), destination);
    copyPrivate(path.join(bundle, 'tls'), path.join(state, 'tls'));
    validateSnapshot(destination, m.snapshotManifestSha256);
    write(path.join(state, 'snapshots/latest.json'), {
      path: destination,
      manifestHash: m.snapshotManifestSha256,
    });
    // Receipt is written last. Partial imports have no usable launcher config.
    write(path.join(state, 'INSTANCE.json'), {
      kind: 'LOCAL_PORTABLE_INSTANCE_V1',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      privateManifestSha256: pin,
      originalRoot: s.originalRoot,
      origin: m.origin,
      host: machine,
    });
    return {
      status: 'IMPORTED_NOT_STARTED',
      state,
      origin: m.origin,
      optionalServices: 'NOT_DELIVERED',
    };
  } catch (e) {
    fs.rmSync(state, { recursive: true, force: true });
    throw e;
  }
}
function instanceEnv(workspace, state) {
  privatePath(workspace, true);
  privatePath(path.join(workspace, 'INSTALLATION.json'));
  const install = json(path.join(workspace, 'INSTALLATION.json'));
  check(
    install.kind === 'LOCAL_INDEPENDENT_INSTALLATION_V1' && install.workspace === workspace,
    'Installation receipt rejected',
  );
  privatePath(state, true);
  privatePath(path.join(state, 'INSTANCE.json'));
  const i = json(path.join(state, 'INSTANCE.json'));
  check(
    i.kind === 'LOCAL_PORTABLE_INSTANCE_V1' &&
      i.evidenceOrigin === 'LOCAL' &&
      i.githubActions === false,
    'Instance receipt rejected',
  );
  const env = {
    ...process.env,
    ZHIBAN_LOCAL_STATE: state,
    ZHIBAN_LOCAL_TLS_DIRECTORY: path.join(state, 'tls'),
  };
  // Do not inherit the source host's optional authority/provider by accident.
  for (const key of Object.keys(env))
    if (/^(?:ZHIBAN_SCANNER_|ZHIBAN_MATERIAL_|GLM_|OPENAI_)/.test(key) || key === 'DEFAULT_MODEL')
      delete env[key];
  const services = path.join(state, 'services.env');
  if (fs.existsSync(services)) {
    privatePath(services);
    const config = require('node:util').parseEnv(fs.readFileSync(services, 'utf8'));
    const allowed = [
      'ZHIBAN_SCANNER_PROFILE',
      'ZHIBAN_SCANNER_PROFILE_SHA256',
      'ZHIBAN_MATERIAL_PARSER_CONFIG',
      'ZHIBAN_MATERIAL_PARSER_SHA256',
    ];
    check(
      Object.keys(config).every((k) => allowed.includes(k)),
      'Unsupported service configuration',
    );
    for (const key of allowed) if (config[key]) env[key] = config[key];
  }
  return env;
}
function operate(action, workspace, state) {
  const env = instanceEnv(workspace, state);
  const actions = {
    start: ['scripts/zhiban-local/start-persistent.ts'],
    'start-rebind': ['scripts/zhiban-local/start-persistent.ts', '--upgrade-local'],
    info: ['scripts/zhiban-local/trial-control.ts', 'info', '--unified-trial'],
    stop: ['scripts/zhiban-local/trial-control.ts', 'stop', '--unified-trial'],
    backup: ['scripts/zhiban-local/persistent-snapshot.ts', 'backup'],
  };
  check(actions[action], 'Unsupported instance operation');
  run('pnpm', ['exec', 'tsx', ...actions[action]], { cwd: workspace, env, stdio: 'inherit' });
}
if (require.main === module) {
  try {
    const [action, ...args] = process.argv.slice(2);
    if (action === 'doctor' && args.length === 0)
      console.log(
        JSON.stringify(
          { status: 'PASS', evidenceOrigin: 'LOCAL', githubActions: false, host: host() },
          null,
          2,
        ),
      );
    else if (action === 'pack' && args.length === 1)
      console.log(JSON.stringify(pack(process.cwd(), absolute(args[0])), null, 2));
    else if (action === 'verify' && args.length === 2) {
      verifyKit(absolute(args[0]), args[1]);
      console.log('PASS LOCAL installation package hashes');
    } else if (
      action === 'install' &&
      (args.length === 3 || (args.length === 4 && args[3] === '--offline'))
    )
      console.log(
        JSON.stringify(
          install(absolute(args[0]), absolute(args[1]), args[2], args[3] === '--offline'),
        ),
      );
    else if (action === 'export-private' && args.length === 4)
      console.log(
        JSON.stringify(
          exportPrivate(absolute(args[0]), absolute(args[1]), absolute(args[2]), args[3]),
          null,
          2,
        ),
      );
    else if (action === 'import-private' && args.length === 3)
      console.log(
        JSON.stringify(importPrivate(absolute(args[0]), absolute(args[1]), args[2]), null, 2),
      );
    else if (
      ['start', 'start-rebind', 'info', 'stop', 'backup'].includes(action) &&
      args.length === 2
    )
      operate(action, absolute(args[0]), absolute(args[1]));
    else
      throw Error(
        'Use doctor | pack OUT | verify KIT PIN | install KIT TARGET PIN [--offline] | export-private SNAPSHOT TLS OUT SNAPSHOT_PIN | import-private BUNDLE STATE PIN | start-rebind/start/info/stop/backup WORKSPACE STATE (absolute paths)',
      );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = {
  absolute,
  ancestors,
  privatePath,
  tree,
  envelope,
  validateSnapshot,
  importPrivate,
  instanceEnv,
  verifyKit,
};
