/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CLI and tests run before installing workspace dependencies. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { eligible, secretLike, readStable, verify } = require('../../../scripts/zhiban-handoff.cjs');
test('exports source and examples while omitting credentials, live data and transient builds', () => {
  for (const p of [
    'app/zhiban/local/imports.js',
    'docs/v2/evidence/zhiban-imports-profile-reference-local.json',
    '.env.example',
  ])
    assert.equal(eligible(p), true);
  for (const p of [
    '../outside',
    '.env.local',
    'openmaic.yml',
    'node_modules/a',
    'x/private.pem',
    'accounts.json',
    '.zhiban-catalog-run-a/verify.mjs',
    'docs/v2/evidence/p7-handoff/source.json',
    'docs/v2/evidence/zhiban-trial-content-demo-local.json',
  ])
    assert.equal(eligible(p), false, p);
});
test('credential-like JSON, filled examples and private key material fail before export', () => {
  assert.equal(
    secretLike(Buffer.from('{"apiKey":"live-value-must-not-copy"}'), 'config.json'),
    true,
  );
  assert.equal(
    secretLike(Buffer.from('GLM_API_KEY=actual-key-not-exported'), 'dir/.env.example'),
    true,
  );
  assert.equal(
    secretLike(
      Buffer.from('GLM_API_KEY=\nGLM_BASE_URL=https://example.invalid'),
      'dir/.env.example',
    ),
    false,
  );
  assert.equal(
    secretLike(Buffer.from('{"passwordChanged":true,"credentialHash":"123"}'), 'evidence.json'),
    false,
  );
});
test('source reader refuses symlinks and detects credential data without following targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-source-test-'));
  try {
    fs.writeFileSync(path.join(root, 'normal'), 'source');
    fs.symlinkSync(path.join(root, 'normal'), path.join(root, 'alias'));
    assert.throws(() => readStable(root, 'alias'), /Symlink/);
    fs.writeFileSync(path.join(root, 'config.json'), '{"password":"private-real-value"}');
    assert.throws(() => readStable(root, 'config.json'), /Credential-like/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('archive hashes verify without extraction; tampering, paths and links refuse', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-archive-test-'));
  try {
    const creator = String.raw`
import io,tarfile,json,hashlib,sys
root=sys.argv[1]
f={'hello.txt':{'sha256':hashlib.sha256(b'hello').hexdigest(),'bytes':5,'mode':420}}
m={'format':'ZHIBAN_SOURCE_HANDOFF_V1','evidenceOrigin':'LOCAL','githubActions':False,'versionId':'fixture','sourceDigest':hashlib.sha256(json.dumps(f,separators=(',',':')).encode()).hexdigest(),'files':f}
for kind in ['valid','tamper','path','link']:
 with tarfile.open(root+'/'+kind+'.tar.gz','w:gz') as t:
  for name,data in [('HANDOFF.json',json.dumps(m).encode()),('source/hello.txt',b'other' if kind=='tamper' else b'hello')]:
   i=tarfile.TarInfo(name);i.size=len(data);t.addfile(i,io.BytesIO(data))
  if kind in ['path','link']:
   i=tarfile.TarInfo('../outside' if kind=='path' else 'source/link')
   if kind=='link':i.type=tarfile.SYMTYPE;i.linkname='/etc/passwd'
   else:i.size=1
   t.addfile(i,None if kind=='link' else io.BytesIO(b'x'))
`;
    cp.execFileSync('python3', ['-c', creator, root]);
    assert.equal(verify(path.join(root, 'valid.tar.gz')).status, 'PASS');
    for (const kind of ['tamper', 'path', 'link'])
      assert.throws(() => verify(path.join(root, kind + '.tar.gz')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
