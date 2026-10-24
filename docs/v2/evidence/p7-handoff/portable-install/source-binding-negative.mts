/** Only the isolated checkout's bootstrap source is changed transiently; no SQL is applied. */
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import identifiers from '../../../../../scripts/zhiban-local/login-identifiers.ts';
const { loadLoginIdentifiers } = identifiers;
assert.ok(process.cwd().startsWith('/home/zxm/.local/share/zhiban-portable/workspace'));
const source='lib/zhiban/infrastructure/identity/postgres/bootstrap-bridge-roles.pg16.sql';
const original=await readFile(source);
const pool=new Pool({host:'/tmp/zhiban-trial-content-rU1zAL/socket',port:56517,user:'postgres',database:'zhiban_trial_content_disposable',max:1});
try{
 await writeFile(source,Buffer.concat([original,Buffer.from('\n-- LOCAL isolated source mismatch fault; never applied\n')]));
 await assert.rejects(loadLoginIdentifiers(pool),/dependency source rejected/);
 console.log('PASS loader rejects altered current-checkout dependency even though historical source checkout remains valid');
}finally{await writeFile(source,original);await pool.end()}
await writeFile('/home/zxm/openmaic/zhiban/docs/v2/evidence/p7-handoff/portable-install/source-binding-negative.json',JSON.stringify({evidenceOrigin:'LOCAL',githubActions:false,status:'PASS',at:new Date().toISOString(),check:'Current isolated bootstrap dependency mismatch rejected; no fallback to existing historical checkout; source restored in finally; no SQL applied'},null,2)+'\n');
