// Review-only observation fault. Actual launcher/helper/Node child/pg sockets/flock;
// auth/profile/TLS stubbed by the existing bounded-shutdown harness. No real PG or HTTPS.
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../../..'),
  DIR = path.join(ROOT, 'docs/v2/candidates/m5-handoff'),
  h = require(path.join(DIR, 'handoff-contracts.cjs')),
  c = require(path.join(DIR, 'release-contract.cjs'));
const source = h.sources(),
  file = path.join(DIR, 'verify-completion-exit-local.cjs');
let code = fs.readFileSync(file, 'utf8');
code = code.slice(0, code.indexOf('(async () => {'));
const original = "      : name === './physical-closure.cjs'";
assert.ok(code.includes(original));
code = code.replace(
  original,
  "      : name === './ordinary-shutdown.cjs' ? {close:async(_child,clients)=>({...await req(name).close(null,clients),childExitConfirmed:false})}" +
    original,
);
const anchor = "    assert.equal(result.status, 'STOPPED');";
assert.ok(code.includes(anchor));
code = code.replace(
  anchor,
  `
    assert.equal(result.status,'SHUTDOWN_INCOMPLETE');assert.equal(result.childExitConfirmed,false);assert.equal(result.localPgClosed,true);assert.equal(result.sharedLockHeld,true);
    process.kill(host.childPid,0);assert.throws(()=>m.acquire(dir,'handoff',true));
    const exit=new Promise(r=>actualChild.once('exit',r));actualChild.kill('SIGKILL');await exit;
    assert.throws(()=>m.acquire(dir,'handoff',true)); // Unknown result did not silently become a known release.
    const retainedFds=[];for(const name of fs.readdirSync('/proc/self/fd')){try{if(fs.readlinkSync('/proc/self/fd/'+name)===path.join(dir,'maintenance.lock'))retainedFds.push(Number(name));}catch{}}
    assert.equal(retainedFds.length,1);fs.closeSync(retainedFds[0]); // Test-only cleanup after actual child death, not a recovery API.
    const unlocked=m.acquire(dir,'handoff',true);unlocked.release();
    checks.push({name:'unconfirmed child observation retains actual supervisor fd and reports incomplete',status:'PASS',actualChildAliveAtIncomplete:true,localPgClosed:true,lockRetainedAfterChildActuallyExited:true,testCleanupOnly:true});return;
`,
);
code += '\nmodule.exports={shutdownCase,checks};';
const unit = new Module(file, module);
unit.filename = file;
unit.paths = module.paths;
unit._compile(code, file);
(async () => {
  const before = Object.fromEntries(
    ['SIGTERM', 'SIGINT', 'exit'].map((s) => [s, new Set(process.listeners(s))]),
  );
  const base = fs.mkdtempSync('/tmp/zhiban-r6-review-');
  fs.chmodSync(base, 0o700);
  try {
    await unit.exports.shutdownCase(base, 'UNCONFIRMED_EXIT');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    for (const signal of Object.keys(before))
      for (const handler of process.listeners(signal))
        if (!before[signal].has(handler)) process.off(signal, handler);
  }
  assert.equal(h.sources().inventorySha256, source.inventorySha256);
  const result = {
    status: 'PASS',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    candidateInventorySha256: source.inventorySha256,
    candidateMigrationSha256: source.inv.migration.aggregateSha256,
    codeSha256: Object.fromEntries(
      ['ordinary-launcher.cjs', 'ordinary-shutdown.cjs'].map((n) => [
        n,
        c.sha(fs.readFileSync(path.join(DIR, n))),
      ]),
    ),
    checks: unit.exports.checks,
    authorizationProfileTls: 'STUBBED_NOT_SIGNED_OFF',
    existingDatabaseConnections: false,
    realCredentialsRead: false,
    realHttpsStarted: false,
    runtimeAccepted: false,
  };
  const i = process.argv.indexOf('--output');
  if (i >= 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
