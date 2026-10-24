#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CLI and tests run before installing workspace dependencies. */
'use strict';
/** Local source handoff only. Does not install, stop, migrate, fetch, or expose credentials. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { parseEnv } = require('node:util');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const git = (root, args) =>
  cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
function check(ok, message) {
  if (!ok) throw Error(message);
}
function eligible(name) {
  if (
    !name ||
    path.posix.isAbsolute(name) ||
    name.split('/').some((p) => p === '..' || p === '.') ||
    /[\x00-\x1f\x7f\\]/.test(name)
  )
    return false;
  const parts = name.split('/'),
    base = parts.at(-1);
  if (
    parts.some(
      (p) =>
        p === '.git' ||
        p === 'node_modules' ||
        p === '.next' ||
        p.startsWith('.zhiban-') ||
        p === 'coverage' ||
        p === 'logs' ||
        p === 'data' ||
        p.startsWith('.owner-bound-'),
    )
  )
    return false;
  if (name.startsWith('docs/v2/evidence/p7-handoff/')) return false;
  if (
    (base.startsWith('.env') && base !== '.env.example') ||
    base === 'openmaic.yml' ||
    /(?:accounts|member-control|member-inputs|content-installation)\.json$/.test(base)
  )
    return false;
  if (
    /\.(?:pem|key|p12|pfx|dump|tsbuildinfo|log)$/.test(base) ||
    /-demo-(?:close-)?local\.json$/.test(base)
  )
    return false;
  return true;
}
function secretLike(bytes, name) {
  if (
    bytes.includes(Buffer.from('-----BEGIN PRIVATE KEY-----')) ||
    bytes.includes(Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----'))
  ) {
    // Source code can mention the marker; a complete encoded key is never a handoff input.
    if (
      /-----BEGIN (?:OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{40,}-----END (?:OPENSSH )?PRIVATE KEY-----/.test(
        bytes.toString('utf8'),
      )
    )
      return true;
  }
  if (path.basename(name) === '.env.example') {
    const env = parseEnv(bytes.toString('utf8'));
    if (
      Object.entries(env).some(
        ([k, v]) =>
          /(?:API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)$/i.test(k) &&
          v &&
          !/^(?:your|example|placeholder|\$\{|<|sk-xxx)/i.test(v),
      )
    )
      return true;
  }
  if (name.endsWith('.json')) {
    const translationSource = /^lib\/i18n\/locales\/[^/]+\.json$/.test(name);
    let data;
    try {
      data = JSON.parse(bytes);
    } catch {
      return false;
    }
    const walk = (v) => {
      if (!v || typeof v !== 'object') return false;
      if (v.kty && typeof v.d === 'string') return true;
      return Object.entries(v).some(
        ([k, x]) =>
          (!translationSource &&
            /^(?:password|api[_-]?key|private[_-]?key|csrfToken|bearer|accessToken|refreshToken|sessionToken)$/i.test(
              k,
            ) &&
            typeof x === 'string' &&
            x.length > 0 &&
            !/^\$\{|^(?:example|placeholder|redacted|test|dummy|wrong|invalid|fake)/i.test(x)) ||
          walk(x),
      );
    };
    return walk(data);
  }
  return false;
}
function readStable(root, name) {
  const file = path.join(root, name);
  // Reject a symlink anywhere in the source path; no private target can be followed.
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    check(!fs.lstatSync(current).isSymbolicLink(), 'Symlink source rejected: ' + name);
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    check(before.isFile() && before.size <= 64 * 1024 * 1024, 'Source size/type rejected: ' + name);
    const bytes = fs.readFileSync(fd),
      after = fs.fstatSync(fd);
    check(
      before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs,
      'Source changed while reading: ' + name,
    );
    check(!secretLike(bytes, name), 'Credential-like source rejected: ' + name);
    return { bytes, mode: before.mode & 0o111 ? 0o755 : 0o644 };
  } finally {
    fs.closeSync(fd);
  }
}
function runtimeStatus(root) {
  const p = path.join(root, 'docs/v2/evidence/zhiban-trial-content-demo-local.json');
  if (!fs.existsSync(p)) return { status: 'NOT_STARTED', command: 'pnpm trial:zhiban' };
  // Reuse the exact existing PID/argv/root/owner/source checks; never signal any process.
  const result = cp.spawnSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/zhiban-local/trial-control.ts', 'info', '--unified-trial'],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  check(
    result.status === 0,
    'Existing trial status validation refused; run pnpm trial:zhiban:info for details',
  );
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { status: 'NOT_RUNNING', command: 'pnpm trial:zhiban', detail: result.stdout.trim() };
  }
}
function status(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))),
    mp = path.join(root, 'docs/v2/evidence/zhiban-trial-content-demo-local.json'),
    m = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp)) : {};
  let modelConfigured = false;
  const envPath = path.join(root, '.env.local');
  if (fs.existsSync(envPath)) {
    const e = parseEnv(fs.readFileSync(envPath, 'utf8'));
    modelConfigured = !!(e.GLM_API_KEY && e.GLM_BASE_URL && e.DEFAULT_MODEL);
  }
  return {
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    scope: 'UNIFIED_LOCAL_HANDOFF_NOT_PRODUCTION',
    version: pkg.version,
    officialPin: 'e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0',
    branch: git(root, ['branch', '--show-current']).trim(),
    baselineHead: git(root, ['rev-parse', 'HEAD']).trim(),
    dirtyEntries: git(root, ['status', '--porcelain=v1']).trim().split('\n').filter(Boolean).length,
    node: process.version,
    pnpm: cp.execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
    runtime: runtimeStatus(root),
    scanner: {
      mode: m.scanner?.mode ?? 'UNAVAILABLE',
      claim: 'Current metadata; historical scan receipts do not enable new uploads',
    },
    ai: {
      localConfigurationPresent: modelConfigured,
      realProviderRetested: false,
      standardStart: 'pnpm trial:zhiban',
      existingPrivateModelWrapper: 'Optional existing operator configuration; keys not exported',
    },
    dataLifetime: 'Default persistent startup preserves accounts and three databases through verified private snapshots; explicit disposable mode has a separate cleanup lifecycle',
    accountDelivery: 'Current private accounts.json only; never included in the source kit',
  };
}
const verifier = String.raw`
import tarfile,json,hashlib,sys,pathlib
archive=sys.argv[1]
with tarfile.open(archive,'r:gz') as tar:
 members=tar.getmembers();assert len(members)<=15000,'too many entries'
 seen=set();total=0
 for m in members:
  p=pathlib.PurePosixPath(m.name)
  assert m.isfile() and not p.is_absolute() and '..' not in p.parts and all(ord(c)>=32 for c in m.name) and '\\' not in m.name,'unsafe entry'
  assert m.name not in seen and m.size<=67108864,'duplicate/large entry';seen.add(m.name);total+=m.size
 assert total<=1073741824,'archive too large'
 assert 'HANDOFF.json' in seen,'missing manifest'
 manifest=json.load(tar.extractfile('HANDOFF.json'))
 assert manifest['evidenceOrigin']=='LOCAL' and manifest['githubActions']==False and manifest['format']=='ZHIBAN_SOURCE_HANDOFF_V1','wrong format'
 expected={'source/'+p for p in manifest['files']};assert seen==expected|{'HANDOFF.json'},'entry set mismatch'
 for name,facts in manifest['files'].items():
  m=tar.getmember('source/'+name);b=tar.extractfile(m).read()
  assert len(b)==facts['bytes'] and hashlib.sha256(b).hexdigest()==facts['sha256'],'content mismatch'
 actual=hashlib.sha256(json.dumps(manifest['files'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 assert actual==manifest['sourceDigest'],'manifest digest mismatch'
 print(json.dumps({'evidenceOrigin':'LOCAL','githubActions':False,'status':'PASS','scope':'ARCHIVE_ENTRY_SET_AND_FILE_HASHES_ONLY','versionId':manifest['versionId'],'sourceDigest':actual,'files':len(expected),'bytes':total,'credentialAudit':'NOT_ASSERTED_BY_HASH_VERIFICATION','dependenciesIncluded':False,'gitHistoryIncluded':False,'productionSignoff':False}))
`;
function verify(file) {
  return JSON.parse(
    cp.execFileSync('python3', ['-c', verifier, file], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }),
  );
}
function pack(root, outputParent = path.join(os.homedir(), '.local/share/zhiban-handoff')) {
  const head = git(root, ['rev-parse', 'HEAD']).trim(),
    branch = git(root, ['branch', '--show-current']).trim();
  const candidates = [
    ...new Set(
      git(root, ['ls-files', '-cz', '--cached', '--others', '--exclude-standard'])
        .split('\0')
        .filter(Boolean),
    ),
  ].sort();
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-source-kit-'));
  fs.chmodSync(staging, 0o700);
  const files = {},
    excluded = [];
  try {
    for (const name of candidates) {
      if (!eligible(name)) {
        excluded.push(name);
        continue;
      }
      if (!fs.existsSync(path.join(root, name))) {
        excluded.push(name);
        continue;
      }
      const { bytes, mode } = readStable(root, name);
      const target = path.join(staging, 'source', name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { mode });
      files[name] = { sha256: sha(bytes), bytes: bytes.length, mode };
    }
    check(Object.keys(files).length > 0, 'No source files');
    for (const [name, facts] of Object.entries(files))
      check(
        sha(readStable(root, name).bytes) === facts.sha256,
        'Workspace changed during snapshot: ' + name,
      );
    check(git(root, ['rev-parse', 'HEAD']).trim() === head, 'HEAD changed during snapshot');
    const sourceDigest = sha(Buffer.from(JSON.stringify(files))),
      day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })
        .format(new Date())
        .replaceAll('-', ''),
      versionId = 'zhiban-local-' + day + '-' + sourceDigest.slice(0, 12);
    const manifest = {
      format: 'ZHIBAN_SOURCE_HANDOFF_V1',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      versionId,
      sourceDigest,
      branch,
      baselineHead: head,
      sourceState: 'DIRTY_CANDIDATE_SNAPSHOT_NOT_HEAD_ALONE',
      officialVersion: '1.2.1',
      officialPin: 'e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0',
      scope: 'SOURCE_SNAPSHOT_FOR_EXISTING_SAME_PATH_CHECKOUT',
      restorePrerequisites: [
        'Existing trusted Git checkout and official pin objects',
        'Node22/pnpm10.28.0/UbuntuPG16',
        'Rebuilt dependencies/packages',
        'Local trusted CA/expected profiles',
        'Optional private model/scanner inputs supplied separately',
      ],
      notIncluded: [
        'Git history',
        'node_modules',
        'private accounts/passwords/keys/model config',
        'runtime PG data',
        'production approval',
      ],
      excluded,
      files,
    };
    fs.writeFileSync(path.join(staging, 'HANDOFF.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.mkdirSync(outputParent, { recursive: true, mode: 0o700 });
    const output = path.join(outputParent, versionId);
    check(
      !fs.existsSync(output),
      'Output already exists; verify the existing kit instead of overwriting it',
    );
    fs.mkdirSync(output, { mode: 0o700 });
    const archive = path.join(output, 'source.tar.gz');
    // Include only regular file names. No directory/symlink members are needed for verification.
    const list = path.join(staging, 'file-list');
    fs.writeFileSync(
      list,
      ['HANDOFF.json', ...Object.keys(files).map((n) => 'source/' + n)].join('\0') + '\0',
    );
    cp.execFileSync(
      'tar',
      [
        '--sort=name',
        '--mtime=@0',
        '--owner=0',
        '--group=0',
        '--numeric-owner',
        '--format=gnu',
        '-czf',
        archive,
        '-C',
        staging,
        '--null',
        '--no-recursion',
        '-T',
        list,
      ],
      { stdio: 'pipe' },
    );
    const checked = verify(archive),
      archiveHash = sha(fs.readFileSync(archive));
    fs.copyFileSync(path.join(staging, 'HANDOFF.json'), path.join(output, 'HANDOFF.json'));
    fs.writeFileSync(path.join(output, 'SHA256SUMS'), archiveHash + '  source.tar.gz\n');
    fs.writeFileSync(path.join(output, 'VERIFY.json'), JSON.stringify(checked, null, 2) + '\n');
    return {
      ...checked,
      output,
      archive,
      archiveSha256: archiveHash,
      privateInputExclusionEnforced: true,
      restoreExecuted: false,
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
if (require.main === module) {
  try {
    const [action, arg, ...extra] = process.argv.slice(2);
    check(
      !extra.length &&
        ['status', 'pack', 'verify'].includes(action) &&
        ((action === 'verify' && arg) || (action !== 'verify' && !arg)),
      'Use node scripts/zhiban-handoff.cjs status | pack | verify /absolute/source.tar.gz',
    );
    const root = process.cwd();
    console.log(
      JSON.stringify(
        action === 'status'
          ? status(root)
          : action === 'pack'
            ? pack(root)
            : verify(path.resolve(arg)),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { eligible, secretLike, readStable, verify, pack };
