import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {JSDOM,VirtualConsole}=createRequire(resolve('node_modules/.pnpm/jsdom@29.1.1_@noble+hashes@1.8.0_canvas@3.2.3/node_modules/jsdom/package.json'))('jsdom');
const source=readFileSync('app/zhiban/local/course-page.js','utf8');
const id='01a1470c-a866-739a-9d03-707c84652c8f',space='01a1470c-92a0-7449-8481-145270bdde42',offering='01a1470c-a960-77c3-a540-928eb48f88e7';
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(failure=false){
 const log=[],channel=[];const vc=new VirtualConsole();
 const dom=new JSDOM('<body data-course-surface="content"><header class="topbar"><a class="brand"></a><span class="local"></span></header><main id="root"><textarea aria-label="试用文字">未保存的文字</textarea></main></body>',{url:`https://127.0.0.1:3461/zhiban/teacher/courses/${id}/resources?space=${space}&offering=${offering}`,runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window;w.AbortSignal=AbortSignal;
 w.confirm=()=>{throw Error('Native confirm must not handle course logout')};
 w.BroadcastChannel=class{postMessage(value){channel.push(value)}close(){}};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 w.fetch=async(url,options={})=>{log.push({url,options});if(url.startsWith('/api/zhiban/workspace'))return{ok:true,json:async()=>({mode:'MEMBER',rows:[{id:offering,course_id:id,mode:'TEACHER',course_name:'课',name:'班',term_name:'学期',status:'OPEN',course_version:1}]})};if(url.endsWith('/csrf'))return{ok:true,status:200,json:async()=>({csrfToken:'a'.repeat(43)})};return{ok:!failure,status:failure?503:200};};
 w.eval(source);await w.zhibanCoursePage.ready;
 const main=w.document.querySelector('main');w.zhibanCoursePage.setDirty('test',true,main);
 return{dom,w,log,channel,main,button:w.document.querySelector('button[data-course-logout]')};
}
{
 const f=await fixture();f.button.click();await tick();const d=f.w.document.querySelector('dialog');assert.ok(d?.open);d.querySelector('button').click();await tick();assert.equal(f.log.length,1);assert.equal(f.main.querySelector('textarea').value,'未保存的文字');assert.equal(f.button.disabled,false);assert.equal(f.w.document.querySelector('dialog'),null);f.dom.window.close();console.log('PASS cancel logout preserves input and sends no csrf/logout request');
}
{
 const f=await fixture();f.button.click();await tick();f.w.document.querySelector('dialog').querySelectorAll('button')[1].click();await tick();await tick();assert.equal(f.log.length,3);assert.equal(f.log[1].url,'/api/zhiban/identity/csrf');assert.equal(f.log[2].url,'/api/zhiban/identity/logout');assert.equal(f.log[2].options.method,'POST');assert.equal(f.log[2].options.headers['x-zhiban-csrf'],'a'.repeat(43));assert.equal(f.log[2].options.body,'{}');assert.equal(f.main.hidden,true);assert.deepEqual(f.channel,['session-changed']);f.dom.window.close();console.log('PASS confirmed logout uses csrf POST, hides business root and broadcasts session change');
}
{
 const f=await fixture(true);f.button.click();await tick();f.w.document.querySelector('dialog').querySelectorAll('button')[1].click();await tick();await tick();assert.equal(f.main.hidden,false);assert.equal(f.button.disabled,false);assert.match(f.w.document.querySelector('[role=status]').textContent,/退出未完成/);assert.equal(f.main.querySelector('textarea').value,'未保存的文字');assert.equal(f.channel.length,0);f.dom.window.close();console.log('PASS logout failure preserves input and restores retry without broadcasting success');
}
