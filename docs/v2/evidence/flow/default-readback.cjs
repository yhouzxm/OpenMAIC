const {createRequire}=require('node:module');
const req=createRequire(process.cwd()+'/package.json');
const {chromium,expect}=req('@playwright/test');
const fs=require('node:fs/promises');
const https=require('node:https');
const {homedir}=require('node:os');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
(async()=>{
const m=JSON.parse(await fs.readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json','utf8'));
assert.equal(m.status,'RUNNING_LOCAL_PERSISTENT');assert.equal(m.flow.enabled,true);assert.equal(m.flow.nativeRuntimeEnabled,false);
assert.equal(m.scanner.mode,'TRUSTED_SCANNER');
const proof=JSON.parse(await fs.readFile('docs/v2/evidence/flow/default-entry.json','utf8'));
const bytes=await fs.readFile(m.accountsPath);assert.equal(createHash('sha256').update(bytes).digest('hex'),proof.accountsHash);
const accounts=JSON.parse(bytes).accounts;
const cr=JSON.parse(await fs.readFile(homedir()+'/.local/share/zhiban-m1/receipt.json','utf8'));
const ca=await fs.readFile(homedir()+'/.local/share/zhiban-m1/'+(cr.caCertificateHash?'development-ca.crt':'localhost.crt'));
if(cr.caCertificateHash)assert.equal(createHash('sha256').update(ca).digest('hex'),cr.caCertificateHash);
const login=async a=>new Promise((yes,no)=>{const r=https.request(m.origin+'/api/zhiban/identity/login',{ca,method:'POST',headers:{'content-type':'application/json',origin:m.origin,'x-zhiban-request':'identity-v1'}},res=>{res.resume();res.on('end',()=>{assert.equal(res.statusCode,200);yes(res.headers['set-cookie'][0].split(';')[0]);});});r.on('error',no);r.end(JSON.stringify({userId:a.userId,password:a.password}));});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const errors=[];
try{for(const [role,url] of Object.entries(proof.urls)){
 const a=accounts.find(x=>x.role===role.toUpperCase()),cookie=await login(a),ctx=await browser.newContext();
 await ctx.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:m.origin,httpOnly:true,secure:true,sameSite:'Strict'}]);
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await expect(page.getByRole('heading',{name:'教案、课堂环节与实验'})).toBeVisible();
 await expect(page.getByText('已发布教案版本 2，尚未启动。',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'按教案开始课堂',exact:true})).toHaveCount(role==='teacher'?1:0);
 await page.screenshot({path:'docs/v2/evidence/flow/default-'+role+'-restored.png',fullPage:true});
 await ctx.close();
}
assert.deepEqual(errors,[]);
const drift=[];for(const [p,h] of Object.entries(m.sourceHashes)){if(createHash('sha256').update(await fs.readFile(p)).digest('hex')!==h)drift.push(p);}
assert.deepEqual(drift,[]);
await fs.writeFile('docs/v2/evidence/flow/default-restored.json',JSON.stringify({evidenceOrigin:'LOCAL',githubActions:false,status:'PASS',at:new Date().toISOString(),scope:'RESTORED_EXISTING_ACCOUNTS_FIXED_PLAN_AND_ROLE_PAGES_ONLY',accountHashUnchanged:true,flowEnabled:true,nativeRuntimeEnabled:false,scannerMode:m.scanner.mode,sourceMatches:true,browserErrors:errors,started:false},null,2)+'\n');
console.log('PASS: restored original accounts, plan, both role pages, scanner readiness and current source hashes; no classroom start or repeat journey');
}finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
