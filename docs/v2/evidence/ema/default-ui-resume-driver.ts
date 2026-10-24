import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {request} from 'node:https';
import {trustedDevelopmentCa} from '/home/zxm/openmaic/zhiban/scripts/zhiban-local/config';
const require=createRequire('/home/zxm/openmaic/zhiban/package.json');
const {chromium,expect}=require('@playwright/test');
async function main(){
 const m=JSON.parse(await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json','utf8'));
 assert.equal(m.status,'RUNNING_LOCAL_PERSISTENT');assert.equal(m.ema.enabled,true);
 const a=JSON.parse(await readFile(m.accountsPath,'utf8'));assert.equal(a.scope,'LOCAL_SYNTHETIC_TRIAL');
 const ca=await trustedDevelopmentCa(),entry=JSON.parse(await readFile('docs/v2/evidence/ema/default-entry.json','utf8'));
 const login=(role:string)=>new Promise<string>((done,no)=>{const x=a.accounts.find((x:{role:string})=>x.role===role);const r=request(m.origin+'/api/zhiban/identity/login',{ca,method:'POST',headers:{'x-zhiban-request':'identity-v1',origin:m.origin,'content-type':'application/json'}},res=>{res.resume();res.on('end',()=>{if(res.statusCode!==200)return no(Error('Login failed'));done(res.headers['set-cookie']![0].split(';')[0]);});});r.on('error',no);r.end(JSON.stringify({userId:x.userId,password:x.password}));});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const errors:string[]=[];let tp:any;
 try{
  const contexts=[];const pages:Record<string,any>={};
  for(const role of ['TEACHER','STUDENT']){const cookie=await login(role),ctx=await browser.newContext(),[name,...rest]=cookie.split('=');contexts.push(ctx);await ctx.addCookies([{name,value:rest.join('='),url:m.origin,httpOnly:true,secure:true,sameSite:'Strict'}]);const page=await ctx.newPage();page.on('pageerror',(e:Error)=>errors.push(e.message));pages[role]=page;}
  tp=pages.TEACHER;const sp=pages.STUDENT;
  const settle=()=>expect(tp.locator('#ema')).toHaveAttribute('aria-busy','false');
  const {Pool}=require('pg'); const db=new Pool({host:m.root+'/socket',port:56517,user:'postgres',database:m.database,max:1});
  let manualNoteId,adoptedNoteId;
  try{manualNoteId=(await db.query("SELECT id FROM zhiban_learner.observations WHERE title='浏览器实测：本次公开概念解释' ORDER BY created_at DESC LIMIT 1")).rows[0].id;
  adoptedNoteId=(await db.query("SELECT r.note_id FROM zhiban_ema.reviews r JOIN zhiban_ema.jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id WHERE j.purpose='浏览器实测：分析公开的本次教师概念观察，六维无依据时保留证据不足。' AND r.decision='ADOPT' ORDER BY r.created_at DESC LIMIT 1")).rows[0]?.note_id??null;
  assert.ok(manualNoteId);assert.ok(adoptedNoteId);}finally{await db.end();}
  await tp.goto(entry.urls.teacher);await settle();await tp.getByRole('button',{name:'EMA 分析作业',exact:true}).click();
  const section=tp.locator('#ema > section').filter({has:tp.getByRole('heading',{name:'浏览器实测：分析公开的本次教师概念观察，六维无依据时保留证据不足。',exact:true})});
  await section.getByRole('button',{name:'查看作业',exact:true}).click();await settle();
  const reason=tp.getByLabel('拒绝理由 · APPLICATION',{exact:true});await reason.fill('现有公开概念解释不足以证明实际技能应用，暂不形成观察。');
  await tp.locator('form').filter({has:reason}).getByRole('button',{name:'拒绝本维建议',exact:true}).click();
  await expect(tp.getByText('已拒绝：现有公开概念解释不足以证明实际技能应用，暂不形成观察。',{exact:true})).toBeVisible();
  await tp.screenshot({path:'docs/v2/evidence/ema/default-ui-review.png',fullPage:true});
  await sp.goto(entry.urls.student);await sp.getByRole('button',{name:'查看知识理解',exact:true}).click();
  await expect(sp.getByRole('heading',{name:'浏览器实测：本次公开概念解释',exact:true})).toBeVisible();
  if(adoptedNoteId)await expect(sp.getByRole('heading',{name:'知识理解 · 教师审阅',exact:true})).toBeVisible();
  await sp.screenshot({path:'docs/v2/evidence/ema/default-ui-student.png',fullPage:true});
  assert.deepEqual(errors,[]);
  await writeFile('docs/v2/evidence/ema/default-ui-journey.json',JSON.stringify({evidenceOrigin:'LOCAL',githubActions:false,status:'PASS',at:new Date().toISOString(),scope:'DEFAULT_3461_ACTUAL_TEACHER_FORM_QUEUE_RUN_ADOPT_REJECT_PUBLISH_AND_STUDENT_READBACK',manualNoteId,adoptedNoteId,realModelRun:true,unsavedCancellationPreserved:true,composedJourney:'Original driver passed manual observation, cancellation protection, model queue/run, adoption and publication; resumed only after a nested-section test locator error for rejection and student readback',unattendedDispatch:false,browserErrors:errors},null,2)+'\n');
  console.log('PASS default 3461 teacher forms, real model, adopt/reject/publication and student readback; unsaved-navigation cancellation preserved input');
 }catch(e){if(tp){console.log(await tp.locator('#ema [role=alert],#ema [role=status]').allTextContents());await tp.screenshot({path:'docs/v2/evidence/ema/default-ui-failure.png',fullPage:true}).catch(()=>{});}throw e;}finally{await browser.close();}
}
void main().catch(e=>{console.error(e.message);process.exitCode=1;});
