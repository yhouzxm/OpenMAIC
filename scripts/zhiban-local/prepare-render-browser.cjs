/* eslint-disable @typescript-eslint/no-require-imports -- Dependency preparation before TS/runtime setup. */
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  cp = require('node:child_process'),
  crypto = require('node:crypto');
const version = '151.0.7922.138',
  pin = '2eb973561a10d11ba3296eeb798775db86c57731dd71a7b650763c4ed64a9646';
const base = path.join(os.homedir(), '.local/share/zhiban-render'),
  target = path.join(base, version),
  binary = path.join(target, 'chrome-headless-shell-linux64/chrome-headless-shell');
function privateRoot(p) {
  const s = fs.lstatSync(p);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || s.mode & 0o077)
    throw Error('Private owned render directory required');
}
async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw Error(
      'This pinned browser is Linux x64 only; provide an approved Chromium 151 headless shell on other hosts',
    );
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  privateRoot(base);
  if (!fs.existsSync(target)) {
    const stage = fs.mkdtempSync(path.join(base, '.browser-install-'));
    fs.chmodSync(stage, 0o700);
    const py = `import urllib.request,zipfile,pathlib,hashlib,os,json,sys
root=pathlib.Path(sys.argv[1]);version=sys.argv[2];pin=sys.argv[3]
url='https://storage.googleapis.com/chrome-for-testing-public/'+version+'/linux64/chrome-headless-shell-linux64.zip'
p=root/'browser.zip';h=hashlib.sha256();size=0
with urllib.request.urlopen(url,timeout=60) as r,open(p,'xb') as f:
 while True:
  b=r.read(1024*1024)
  if not b: break
  size+=len(b)
  if size>200*1024*1024: raise RuntimeError('Browser archive size rejected')
  h.update(b);f.write(b)
if h.hexdigest()!=pin: raise RuntimeError('Browser archive SHA256 rejected')
with zipfile.ZipFile(p) as z:
 infos=z.infolist()
 if len(infos)>2000 or sum(i.file_size for i in infos)>500*1024*1024: raise RuntimeError('Browser expansion rejected')
 for i in infos:
  n=pathlib.PurePosixPath(i.filename)
  if n.is_absolute() or '..' in n.parts or not n.parts or n.parts[0]!='chrome-headless-shell-linux64' or (i.external_attr>>16)&0o170000==0o120000: raise RuntimeError('Browser entry rejected')
 z.extractall(root)
 for i in infos: os.chmod(root/i.filename,0o700 if i.is_dir() or (i.external_attr>>16)&0o111 else 0o600)
binary=root/'chrome-headless-shell-linux64/chrome-headless-shell'
receipt={'evidenceOrigin':'LOCAL','scope':'DEPENDENCY_DOWNLOAD_NOT_PROVIDER_AUTHORITY','version':version,'url':url,'sha256':pin,'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest()}
(root/'receipt.json').write_text(json.dumps(receipt,indent=2));os.chmod(root/'receipt.json',0o600);p.unlink()
`;
    try {
      cp.execFileSync('python3', ['-c', py, stage, version, pin], {
        stdio: 'inherit',
        timeout: 240000,
      });
      fs.renameSync(stage, target);
    } catch (e) {
      fs.rmSync(stage, { recursive: true, force: true });
      throw e;
    }
  }
  privateRoot(target);
  const receipt = JSON.parse(fs.readFileSync(path.join(target, 'receipt.json'))),
    sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  if (
    receipt.sha256 !== pin ||
    sha(fs.readFileSync(binary)) !== receipt.binarySha256 ||
    !/Chrome.*\s151\./.test(cp.execFileSync(binary, ['--version'], { encoding: 'utf8' }))
  )
    throw Error('Prepared browser binding rejected');
  cp.execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: path.join(process.cwd(), 'render-service'),
    stdio: 'inherit',
    timeout: 240000,
  });
  console.log(
    'Prepared frozen render dependencies and pinned Chromium ' +
      version +
      '; no system package changes',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
