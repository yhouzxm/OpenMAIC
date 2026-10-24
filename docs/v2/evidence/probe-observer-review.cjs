// Compile only the unchanged fixture setup/teardown, replace its test body with scoped probes.
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module');
const file = path.resolve(__dirname, '../candidates/m5-readonly-startup/verify-observer-pg16.cjs');
const text = fs.readFileSync(file, 'utf8'),
  start = text.indexOf("    await test('normal actual SCRAM"),
  end = text.indexOf('    // Test-only bootstrap read after all observers');
if (start < 0 || end < start) throw Error('FIXTURE_MARKER_DRIFT');
const body = `
    async function review(s,mode){
      const file=signed(s),child=spawn(process.execPath,[path.resolve(__dirname,'../../evidence/probe-observer-review-worker.cjs'),file,publicPath,pin,mode],{env:safeEnv,stdio:['ignore','pipe','pipe']});children.push(child);
      let output='',err='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>err+=b);
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('REVIEW_WORKER_TIMEOUT'));},45000);child.once('close',()=>{clearTimeout(timer);resolve();});});
      assert.equal(err,'');return JSON.parse(output.trim().split('\\n').at(-1));
    }
    await test('OR-01 REPRODUCED release ACK lost reports UNKNOWN but custody ends after parent exit',async()=>{
      const s=request(),r=await review(s,'release-ack-lost');
      assert.equal(r.status,'LIFECYCLE_UNKNOWN');assert.equal(r.lockRetained,true);assert.equal(r.lockRetainedByCustodian,false);
      assert.equal(pid(),null);assert.equal(lockBusy(s),false);assert.equal(c.sha(fs.readFileSync(path.join(s.control,'maintenance.json'))),s.v.hashes.guardSha256);unchanged();
      return {finding:'OR-01',reproduced:true,reportedLockRetained:true,actualLockHeldAfterParentExit:false,pgStopped:true,guardUnchanged:true};
    });
    await test('OR-02 REPRODUCED guardian short release audit write is accepted and leaves unparsable journal',async()=>{
      const s=request(),r=await review(s,'short-release-journal');assert.equal(r.status,'OBSERVED_STOP_CONFIRMED');assert.equal(pid(),null);assert.equal(lockBusy(s),false);
      let invalid=false;try{e.inspect(s.stage);}catch{invalid=true;}assert.equal(invalid,true);unchanged();
      return {finding:'OR-02',reproduced:true,acceptedDespiteIncompleteReleaseAudit:true,journalParseRejected:true,pgStopped:true};
    });
    await test('OR-03 REPRODUCED changed credential bytes after start are consumed under old signed digest',async()=>{
      const s=request(),r=await review(s,'pgpass-drift');assert.equal(r.status,'OBSERVED_STOP_CONFIRMED');assert.notEqual(c.sha(fs.readFileSync(s.passPath)),s.v.hashes.pgpassSha256);
      const observation=JSON.parse(fs.readFileSync(path.join(s.stage,'observation.json')));assert.equal(observation.status,'OBSERVED_MANAGEMENT_ONLY');assert.equal(pid(),null);assert.equal(lockBusy(s),false);unchanged();
      return {finding:'OR-03',reproduced:true,consumedCredentialBytesDifferFromSignedHash:true,pgStopped:true};
    });
    await test('OR-04 REPRODUCED quoted include with spaces falls through as generic setting and accepts incomplete closure',async()=>{
      const conf=path.join(data,'postgresql.conf'),original=fs.readFileSync(conf),extra=path.join(data,'unlisted config.conf');
      c.writeNew(extra,"work_mem = '8MB'\\n");fs.writeFileSync(conf,original.toString()+"\\ninclude = 'unlisted config.conf'\\n");
      try{
        const s=request(),r=await review(s,'plain');assert.equal(r.status,'OBSERVED_STOP_CONFIRMED');assert.equal(s.v.configurationClosure.length,2);assert(!s.v.configurationClosure.some(x=>x.path===extra));assert.equal(pid(),null);assert.equal(lockBusy(s),false);
        return {finding:'OR-04',reproduced:true,acceptedWithUnlistedInclude:true,baseConfigurationNotLoadedByObserver:true,pgStopped:true};
      }finally{fs.writeFileSync(conf,original);fs.unlinkSync(extra);unchanged();}
    });
`;
let code = text.slice(0, start) + body + text.slice(end);
code = code.replace(
  "status: 'PASS',\n      evidenceOrigin",
  "status: 'REVIEW_REPRODUCED',\n      evidenceOrigin",
);
code = code.replace(
  "faultToolAckAndStop: 'TEST_ADAPTER_ONLY',",
  "faultToolAckAndStop: 'TEST_ADAPTER_ONLY', reviewOnly: true, fixesImplemented: false,",
);
const mod = new Module(file, module);
mod.filename = file;
mod.paths = Module._nodeModulePaths(path.dirname(file));
mod._compile(code, file);
