/* LOCAL addon: the final compiled host, real teacher chapter flow and student readback. */
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {createHash}=require('node:crypto');
const requireProject=createRequire('/home/zxm/openmaic/zhiban/package.json');
const {chromium,expect}=requireProject('@playwright/test');
async function main(){
 const m=JSON.parse(await fs.readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json','utf8'));
 assert.equal(m.evidenceOrigin,'LOCAL');assert.equal(m.githubActions,false);assert.equal(m.origin,'https://127.0.0.1:3461');assert.equal(m.validation.status,'PASS');assert.equal(m.validation.checks.length,30);
 const accounts=JSON.parse(await fs.readFile(m.accountsPath,'utf8')).accounts;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});let teacherUrl,studentUrl;const errors=[];
 try{
  const teacher=await browser.newContext(),student=await browser.newContext();const tp=await teacher.newPage(),sp=await student.newPage();
  for(const p of [tp,sp])p.on('pageerror',e=>errors.push(e.message));
  async function login(page,role){const a=accounts.find(x=>x.role===role);assert.ok(a);await page.goto(m.origin+'/zhiban');await page.getByRole('textbox',{name:'账号 ID',exact:true}).fill(a.userId);await page.getByRole('textbox',{name:'密码',exact:true}).fill(a.password);await page.getByRole('button',{name:'登录并进入',exact:true}).click();await page.getByRole('button',{name:'智伴本地试用 trial',exact:true}).click();await page.locator('a[href*="offering='+m.trial.offeringId+'"]').filter({hasText:'进入课程工作区'}).click();}
  await login(tp,'TEACHER');
  const chapter=tp.locator('section.outline-chapter').filter({has:tp.getByRole('heading',{name:/资源课堂/})});await chapter.getByRole('link',{name:'本章上传资源',exact:true}).click();
  const title='章节接续：设备维护要点',text='章节上传：隔离、验电、仪表自检，三步逐项核对。';
  await tp.getByLabel('上传资源标题',{exact:true}).fill(title);await tp.getByLabel('选择教学资源文件',{exact:true}).setInputFiles({name:'chapter.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
  const unexpected=[];const dismiss=d=>{unexpected.push(d.message());void d.dismiss();};tp.on('dialog',dismiss);
  await tp.getByRole('button',{name:'扫描并解析为资源草稿',exact:true}).click();await expect(tp.getByRole('button',{name:'发布资源 '+title,exact:true})).toBeVisible({timeout:75000});tp.off('dialog',dismiss);assert.deepEqual(unexpected,[],'Upload must not be intercepted by the dirty-page leave guard');
  tp.once('dialog',d=>void d.accept());await tp.getByRole('button',{name:'发布资源 '+title,exact:true}).click();await expect(tp.getByRole('button',{name:'查看已发布资源 '+title,exact:true})).toBeVisible();
  await tp.getByRole('link',{name:'返回原章节并加入资源',exact:true}).click();await expect(tp.getByText('已加入原章节的目录草稿，请保存目录；对学生发布仍需内容及目录各自发布。',{exact:true})).toBeVisible();
  const waitSave=tp.waitForResponse(r=>r.url().endsWith('/outline')&&r.request().method()==='POST'&&r.request().postDataJSON().type==='SAVE_OUTLINE');await tp.getByRole('button',{name:'保存目录草稿',exact:true}).click();assert.equal((await waitSave).status(),200);
  await expect(tp.getByRole('button',{name:'发布已保存目录',exact:true})).toBeEnabled();const waitPublish=tp.waitForResponse(r=>r.url().endsWith('/outline')&&r.request().method()==='POST'&&r.request().postDataJSON().type==='PUBLISH_OUTLINE');await tp.getByRole('button',{name:'发布已保存目录',exact:true}).click();assert.equal((await waitPublish).status(),200);teacherUrl=tp.url();
  await login(sp,'STUDENT');await sp.getByRole('link',{name:'学习中心',exact:true}).click();await sp.getByRole('link',{name:new RegExp(title)}).click();await expect(sp.getByRole('region',{name:'已发布教学资源'})).toContainText(text);studentUrl=sp.url();
  const promised=sp.waitForEvent('download');await sp.getByRole('link',{name:'下载该发布版本原文件',exact:true}).click();const file=await promised;const stream=await file.createReadStream();const chunks=[];for await(const part of stream)chunks.push(Buffer.from(part));assert.equal(Buffer.concat(chunks).toString(),text);
  await tp.screenshot({path:'docs/v2/evidence/zhiban-material-chapter-teacher-local.png',fullPage:true});await sp.screenshot({path:'docs/v2/evidence/zhiban-material-chapter-student-local.png',fullPage:true});assert.deepEqual(errors,[]);
  await fs.writeFile('docs/v2/evidence/zhiban-material-chapter-flow-local.json',JSON.stringify({evidenceOrigin:'LOCAL',githubActions:false,status:'PASS',scope:'FINAL_HOST_CHAPTER_UPLOAD_RETURN_OUTLINE_PUBLICATION_STUDENT_ORIGINAL_DOWNLOAD',teacherUrl,studentUrl,scriptSha256:createHash('sha256').update(await fs.readFile(__filename)).digest('hex'),checks:['Real teacher and student UI logins','Chapter upload link -> native parse -> explicit resource publication','No erroneous dirty-page confirmation on local upload','Return attaches MATERIAL to original chapter; explicit outline save and publish','Student exact unit text and real original download match'],at:new Date().toISOString()},null,2)+'\n');
  console.log('PASS LOCAL chapter upload/return/publication/student original-download flow');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
