#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Bootstrap and encryption need no installed dependencies. */
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  cp = require('node:child_process');
const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  createHash,
} = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const portable = require('../zhiban-portable.cjs');
const magic = Buffer.from('ZBPORT1\n'),
  limit = 2 * 1024 ** 3;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function newPath(p) {
  portable.absolute(p);
  portable.ancestors(p);
  check(!fs.lstatSync(p, { throwIfNoEntry: false }), 'Output already exists');
}
async function fileHash(p) {
  const h = createHash('sha256');
  for await (const b of fs.createReadStream(p)) h.update(b);
  return h.digest('hex');
}
async function seal(input, output, key) {
  check(Buffer.isBuffer(key) && key.length === 32, '256-bit key required');
  newPath(output);
  const temporary = output + '.pending-' + randomUUID(),
    iv = randomBytes(12),
    header = Buffer.concat([magic, iv]);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeSync(fd, header);
    await pipeline(
      fs.createReadStream(input),
      cipher,
      fs.createWriteStream(temporary, { fd, start: header.length }),
    );
    fs.appendFileSync(temporary, cipher.getAuthTag());
    fs.linkSync(temporary, output);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
async function unseal(input, output, key, pin) {
  portable.privatePath(input);
  check(/^[a-f0-9]{64}$/.test(pin) && (await fileHash(input)) === pin, 'Ciphertext hash rejected');
  check(Buffer.isBuffer(key) && key.length === 32, '256-bit key required');
  const size = fs.statSync(input).size;
  check(size > magic.length + 28 && size <= limit, 'Ciphertext size rejected');
  newPath(output);
  const temporary = output + '.unauthenticated-' + randomUUID();
  const fd = fs.openSync(input, 'r'),
    header = Buffer.alloc(magic.length + 12),
    tag = Buffer.alloc(16);
  fs.readSync(fd, header, 0, header.length, 0);
  fs.readSync(fd, tag, 0, 16, size - 16);
  fs.closeSync(fd);
  check(header.subarray(0, magic.length).equals(magic), 'Ciphertext format rejected');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(magic.length));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(input, { start: header.length, end: size - 17 }),
      decipher,
      fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    fs.linkSync(temporary, output);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
const extractPython = String.raw`
import tarfile,sys,pathlib,os,json,hashlib
os.umask(0o077)
out=pathlib.Path(sys.argv[2])
def require(ok,msg):
 if not ok: raise RuntimeError(msg)
with tarfile.open(sys.argv[1],'r:gz') as t:
 members=t.getmembers();require(len(members)<=20000,'entry count')
 seen=set();total=0
 for m in members:
  p=pathlib.PurePosixPath(m.name)
  require(m.isfile() and m.type in (tarfile.REGTYPE,tarfile.AREGTYPE) and not m.sparse,'regular files only')
  require(not p.is_absolute() and str(p)==m.name and '..' not in p.parts and '\\' not in m.name and len(m.name)<=512 and all(ord(c)>=32 for c in m.name),'path rejected')
  require(m.name.startswith(('install/','restore/')) or m.name in ('DELIVERY.json','baseline.json','LOCAL_CLOSEOUT.json'),'unexpected top level')
  require(m.name not in seen and 0<=m.size<=536870912,'duplicate/large entry');seen.add(m.name);total+=m.size
 require(total<=2147483648 and 'DELIVERY.json' in seen,'size/manifest')
 manifest=json.load(t.extractfile('DELIVERY.json'))
 require(manifest.get('kind')=='ZHIBAN_PORTABLE_CI_DELIVERY_V1' and manifest.get('evidenceOrigin')=='LOCAL' and manifest.get('githubActions') is False,'manifest kind')
 require(set(manifest['files'])|{'DELIVERY.json'}==seen,'file closure')
 for m in members:
  target=out/m.name;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  h=hashlib.sha256()
  with open(target,'xb') as f:
   stream=t.extractfile(m)
   while True:
    chunk=stream.read(1048576)
    if not chunk:break
    h.update(chunk);f.write(chunk)
  os.chmod(target,0o600)
  if m.name!='DELIVERY.json':require(h.hexdigest()==manifest['files'][m.name],'file hash')
`;
function extractDelivery(archive, destination) {
  newPath(destination);
  fs.mkdirSync(destination, { mode: 0o700 });
  try {
    cp.execFileSync('python3', ['-I', '-c', extractPython, archive, destination], {
      stdio: 'pipe',
      maxBuffer: 1024 ** 2,
    });
    return readJson(path.join(destination, 'DELIVERY.json'));
  } catch {
    fs.rmSync(destination, { recursive: true, force: true });
    throw Error('Delivery extraction rejected; no published plaintext directory');
  }
}
function validateDelivery(root) {
  portable.privatePath(root, true);
  const m = readJson(path.join(root, 'DELIVERY.json'));
  check(
    m.kind === 'ZHIBAN_PORTABLE_CI_DELIVERY_V1' &&
      m.evidenceOrigin === 'LOCAL' &&
      m.githubActions === false,
    'Delivery origin rejected',
  );
  const actual = portable.tree(root, '', true);
  delete actual['DELIVERY.json'];
  check(
    JSON.stringify(Object.entries(actual).sort()) ===
      JSON.stringify(Object.entries(m.files).sort()),
    'Delivery closure rejected',
  );
  const install = portable.verifyKit(path.join(root, 'install'), m.installManifestSha256);
  const restore = portable.envelope(
    path.join(root, 'restore'),
    'ZHIBAN_PRIVATE_RESTORE_V1',
    m.restoreManifestSha256,
  );
  portable.validateSnapshot(path.join(root, 'restore/snapshot'), restore.snapshotManifestSha256);
  check(
    install.sourceDigest === m.sourceDigest && restore.originalRoot === m.originalRoot,
    'Delivery binding rejected',
  );
  const baseline = readJson(path.join(root, 'baseline.json'));
  check(
    baseline.accountsHash ===
      sha(fs.readFileSync(path.join(root, 'restore/snapshot/root/accounts.json'))),
    'Baseline accounts rejected',
  );
  check(
    Object.keys(baseline.databases).sort().join(',') ===
      [
        'zhiban_trial_content_disposable',
        'zhiban_trial_content_native',
        'zhiban_trial_lesson_native',
      ]
        .sort()
        .join(','),
    'Baseline database set rejected',
  );
  return m;
}
let phase = 'CONTEXT';
function privateTree(root) {
  const stat = fs.lstatSync(root);
  check(
    stat.uid === process.getuid() &&
      !stat.isSymbolicLink() &&
      (stat.isFile() || stat.isDirectory()),
    'Private staging type/owner rejected',
  );
  fs.chmodSync(root, stat.isDirectory() ? 0o700 : 0o600);
  if (stat.isDirectory())
    for (const name of fs.readdirSync(root)) privateTree(path.join(root, name));
}
async function prepare(kit, restore, baseline, closeout, output, keyFile) {
  phase = 'INPUT_VALIDATION';
  for (const p of [kit, restore, baseline, closeout, output, keyFile]) portable.absolute(p);
  portable.privatePath(baseline);
  portable.privatePath(kit, true);
  portable.privatePath(restore, true);
  const c = readJson(closeout);
  check(
    c.kind === 'LOCAL_INDEPENDENT_INSTALL_RESTORE_CLOSEOUT_V1' &&
      c.status === 'PASS' &&
      c.githubActions === false,
    'Local acceptance required',
  );
  const install = portable.verifyKit(kit, c.release.manifestSha256);
  const r = portable.envelope(
    restore,
    'ZHIBAN_PRIVATE_RESTORE_V1',
    c.privateRestore.manifestSha256,
  );
  portable.validateSnapshot(path.join(restore, 'snapshot'), r.snapshotManifestSha256);
  check(install.sourceDigest === c.release.sourceDigest, 'Approved source digest mismatch');
  check(
    readJson(baseline).accountsHash === c.validation.accountsHash,
    'Approved baseline mismatch',
  );
  newPath(output);
  newPath(keyFile);
  portable.privatePath(path.dirname(output), true);
  portable.privatePath(path.dirname(keyFile), true);
  check(!keyFile.startsWith(output + '/'), 'Key must remain outside delivery directory');
  phase = 'PRIVATE_STAGING';
  fs.mkdirSync(output, { mode: 0o700 });
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-ci-seal-'));
  fs.chmodSync(stage, 0o700);
  const key = randomBytes(32);
  try {
    fs.cpSync(kit, path.join(stage, 'install'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    fs.cpSync(restore, path.join(stage, 'restore'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    fs.copyFileSync(baseline, path.join(stage, 'baseline.json'));
    fs.chmodSync(path.join(stage, 'baseline.json'), 0o600);
    fs.copyFileSync(closeout, path.join(stage, 'LOCAL_CLOSEOUT.json'));
    fs.chmodSync(path.join(stage, 'LOCAL_CLOSEOUT.json'), 0o600);
    privateTree(stage);
    phase = 'TRANSPORT_MANIFEST';
    const delivery = {
      kind: 'ZHIBAN_PORTABLE_CI_DELIVERY_V1',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      installManifestSha256: c.release.manifestSha256,
      restoreManifestSha256: c.privateRestore.manifestSha256,
      sourceDigest: install.sourceDigest,
      host: r.host,
      originalRoot: r.originalRoot,
      sourceMachineHash: sha(fs.readFileSync('/etc/machine-id')),
      sourceUid: process.getuid(),
      dataScope: 'EXISTING_SYNTHETIC_LOCAL_THREE_DATABASES_NOT_PRODUCTION',
      createdAt: new Date().toISOString(),
      files: portable.tree(stage, '', true),
    };
    fs.writeFileSync(path.join(stage, 'DELIVERY.json'), JSON.stringify(delivery), {
      mode: 0o600,
      flag: 'wx',
    });
    phase = 'STAGED_VALIDATION';
    validateDelivery(stage);
    phase = 'ARCHIVE_ENCRYPTION';
    const list = path.join(output, '.tar-list'),
      archive = path.join(output, '.plaintext.tar.gz');
    fs.writeFileSync(list, ['DELIVERY.json', ...Object.keys(delivery.files)].join('\0') + '\0', {
      mode: 0o600,
      flag: 'wx',
    });
    try {
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
          stage,
          '--null',
          '--no-recursion',
          '-T',
          list,
        ],
        { stdio: 'pipe' },
      );
      fs.chmodSync(archive, 0o600);
      fs.writeFileSync(keyFile, key.toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
      await seal(archive, path.join(output, 'portable-delivery.enc'), key);
    } finally {
      fs.rmSync(archive, { force: true });
      fs.rmSync(list, { force: true });
    }
    const review = {
      kind: 'PORTABLE_CI_DELIVERY_REVIEW_V1',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      status: 'PREPARED_NOT_UPLOADED_NOT_EXECUTED',
      ciphertext: path.join(output, 'portable-delivery.enc'),
      ciphertextSha256: await fileHash(path.join(output, 'portable-delivery.enc')),
      bytes: fs.statSync(path.join(output, 'portable-delivery.enc')).size,
      keyFile,
      sourceDigest: install.sourceDigest,
      installManifestSha256: delivery.installManifestSha256,
      restoreManifestSha256: delivery.restoreManifestSha256,
      includes: [
        'synthetic PG16 three-database data',
        'synthetic accounts and LOCAL membership approval private keys',
        'existing localhost TLS private key and public CA',
        'pinned dirty source and Git anchors',
        'private data fingerprints',
      ],
      excludes: [
        'CA signing private key',
        'model API keys',
        'external scanner authority',
        'old Native maintenance authority',
        'production credentials',
      ],
      transport:
        'AES-256-GCM random one-time key; ciphertext Release asset; key separate protected Environment secret',
      approved: false,
    };
    fs.writeFileSync(path.join(output, 'REVIEW.json'), JSON.stringify(review, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    return review;
  } finally {
    key.fill(0);
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
if (require.main === module) {
  void (async () => {
    const [action, ...args] = process.argv.slice(2);
    if (action === 'prepare' && args.length === 6)
      console.log(JSON.stringify(await prepare(...args), null, 2));
    else if (action === 'open' && args.length === 3) {
      const [cipher, destination, pin] = args;
      const secret = process.env.ZHIBAN_PORTABLE_TRANSPORT_KEY?.trim();
      delete process.env.ZHIBAN_PORTABLE_TRANSPORT_KEY;
      check(
        typeof secret === 'string' && /^[a-f0-9]{64}$/.test(secret),
        'One-time key unavailable',
      );
      const key = Buffer.from(secret, 'hex');
      const archive = destination + '.authenticated.tar.gz';
      let created = false;
      try {
        await unseal(cipher, archive, key, pin);
        extractDelivery(archive, destination);
        created = true;
        validateDelivery(destination);
        console.log(
          'Authenticated delivery verified; private plaintext remains local to this runner',
        );
      } catch (error) {
        if (created) fs.rmSync(destination, { recursive: true, force: true });
        throw error;
      } finally {
        key.fill(0);
        fs.rmSync(archive, { force: true });
      }
    } else
      throw Error(
        'Use prepare KIT RESTORE BASELINE LOCAL_CLOSEOUT OUTPUT KEY_FILE | open CIPHER DEST SHA256 (key via step-only environment)',
      );
  })().catch(() => {
    console.error(
      'Portable delivery preparation/open failed at ' + phase + '; no secret values emitted',
    );
    process.exitCode = 1;
  });
}
module.exports = {
  seal,
  unseal,
  fileHash,
  extractDelivery,
  validateDelivery,
  prepare,
  privateTree,
};
