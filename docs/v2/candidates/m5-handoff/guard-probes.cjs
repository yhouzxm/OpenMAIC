// Fault injection clone only. Never added to or signed as an ordinary release.
const fs = require('node:fs'),
  path = require('node:path');
const { spawn } = require('node:child_process');
const c = require('./release-contract.cjs');
async function run(parent, release) {
  const clone = path.join(parent, 'guard-probe-clone');
  fs.cpSync(release, clone, { recursive: true });
  fs.chmodSync(clone, 0o700);
  const m = JSON.parse(c.bytes(path.join(clone, 'closure-manifest.json')));
  const cases = {
      listen: "require('node:http').createServer().listen(0)",
      filesystemWrite:
        "require('node:fs').writeFileSync('/tmp/zhiban-forbidden-validation-write','forbidden')",
      ambientImport: "require('pg')",
      outsideConnection: "require('node:net').connect(1,'127.0.0.1')",
      childProcess: "require('node:child_process').execFileSync('/usr/bin/true')",
    },
    results = [];
  for (const [name, body] of Object.entries(cases)) {
    const rel = 'host/guard-probe-' + name + '.cjs',
      raw = Buffer.from(
        "const fs=require('node:fs');let denied=false;try{" +
          body +
          "}catch{denied=true;}fs.writeSync(3,JSON.stringify({denied})+'\\n');process.exit(denied?0:1);\n",
      );
    fs.writeFileSync(path.join(clone, rel), raw, { mode: 0o600 });
    m.files.push({ path: rel, sha256: c.sha(raw), kind: 'javascript' });
  }
  const mf = path.join(clone, 'closure-manifest.json');
  fs.chmodSync(mf, 0o600);
  fs.writeFileSync(mf, JSON.stringify(m));
  for (const name of Object.keys(cases)) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--permission',
          '--allow-addons',
          '--allow-fs-read=' + clone,
          '--require',
          path.join(clone, 'host/validation-guard.cjs'),
          path.join(clone, 'host/guard-probe-' + name + '.cjs'),
          '--validate-handoff',
          clone,
        ],
        {
          cwd: clone,
          env: { PATH: '/usr/bin:/bin', LANG: 'C' },
          stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
        },
      );
      let raw = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.stdio[3].on('data', (b) => {
        raw += b;
        if (raw.length > 4096) child.kill('SIGKILL');
      });
      child.on('error', () => {
        clearTimeout(timer);
        reject(Error('Guard probe spawn rejected'));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const r = JSON.parse(raw);
          if (code !== 0 || r.denied !== true) throw Error('Guard restriction did not deny');
          resolve({ name, status: 'PASS' });
        } catch (error) {
          reject(error);
        }
      });
    });
    results.push(result);
  }
  fs.rmSync(clone, { recursive: true, force: true });
  return results;
}
module.exports = { run };
