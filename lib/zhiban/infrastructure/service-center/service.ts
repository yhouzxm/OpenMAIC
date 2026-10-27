import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Pool, PoolClient } from 'pg';
import type { AcademicContext, AcademicStore } from '@/lib/zhiban/application/academic/service';
import { academicAdmin, requireAcademic, AcademicError } from '@/lib/zhiban/domain/academic/model';
import { modelSettingsView, applyModelSettingsChange, keysClearedBy, type ModelSettingsChange, ModelSettingsError } from '@/lib/server/model-config/settings';
import { readWorkspaceModelConfig, saveWorkspaceModelConfig } from '@/lib/persistence/workspace-model-config';
import { sealSecret, openSecret, instanceKey } from '@/lib/server/secret-box';
import { readUsageRecords } from '@/lib/server/usage-storage';
import { aggregateUsage } from '@/lib/usage/aggregate';
import { withServiceTenant } from '@/lib/server/service-scope';
import { withServiceOperator } from '../authoring/host';
import { serviceOwner } from './config';
import { settingsInput, probeInput, auditSummary } from './policy';
import * as llm from '@/app/api/verify-model/route';
import * as image from '@/app/api/verify-image-provider/route';
import * as video from '@/app/api/verify-video-provider/route';
import * as document from '@/app/api/verify-pdf-provider/route';
import * as tts from '@/app/api/generate/tts/route';
import * as asr from '@/app/api/transcription/route';
import * as catalogue from '@/app/api/provider/probe-models/route';

/** Space admin operations use the original live Identity/Academic transaction guard. */
export class ServiceCenter {
  private probes = new Set<string>();
  constructor(private store:AcademicStore, private pool:Pool) {}
  guard<T>(x:AcademicContext, work:(expiresAt:number)=>Promise<T>) {
    return this.store.run(x,null,async actor=>{
      requireAcademic(academicAdmin(actor),'FORBIDDEN');
      return work(actor.expiresAt);
    });
  }
  private async stored(tenant:string) { return readWorkspaceModelConfig(this.pool,serviceOwner(tenant)); }
  view(x:AcademicContext) { return this.guard(x,async()=>modelSettingsView(await this.stored(x.tenantId))); }
  history(x:AcademicContext,cursor?:string) {
    requireAcademic(!cursor || /^[1-9][0-9]{0,17}$/.test(cursor));
    return this.guard(x,async()=>{
      const rows=(await this.pool.query(`SELECT event_id::text AS id,actor_id,event_kind,revision,summary,created_at
        FROM zhiban_service_events WHERE tenant_id=$1 AND ($2::bigint IS NULL OR event_id<$2)
        ORDER BY event_id DESC LIMIT 26`,[x.tenantId,cursor??null])).rows;
      return {items:rows.slice(0,25),next:rows.length>25?rows[24].id:null};
    });
  }
  usage(x:AcademicContext,month:string) {
    requireAcademic(/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(month));
    return this.guard(x,async()=>{
      const own=(await readUsageRecords({months:[month]})).filter(r=>r.tenantId===x.tenantId);
      return {...aggregateUsage(own),scope:'CURRENT_SPACE_ONLY',month,unattributedHistoricalRecords:'EXCLUDED',costs:'NOT_CALCULATED'};
    });
  }
  async change(x:AcademicContext,raw:unknown,command:string) {
    const parsed=settingsInput.safeParse(raw); requireAcademic(parsed.success);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(command));
    const input=parsed.data!, owner=serviceOwner(x.tenantId);
    return this.guard(x,async expires=>{
      const intent=createHmac('sha256',instanceKey().key).update(JSON.stringify(input)).digest('hex');
      const client=await this.pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(hashtext($1))',[owner]);
        const old=(await client.query('SELECT sealed_intent,revision FROM zhiban_service_events WHERE tenant_id=$1 AND command_id=$2',[x.tenantId,command])).rows[0];
        if(old){ requireAcademic(openSecret(old.sealed_intent,owner+':'+command)===intent,'CONFLICT');
          return modelSettingsView(await this.stored(x.tenantId)); }
        const current=await this.stored(x.tenantId);
        requireAcademic((current?.revision??null)===input.revision,'CONFLICT');
        const change=input.change as ModelSettingsChange;
        const next=await applyModelSettingsChange(current?.config??null,change).catch(error=>{
          // AcademicStore intentionally sanitizes foreign errors. Translate expected native refusals inside it.
          if(error instanceof ModelSettingsError) throw new AcademicError(error.code==='SLOT_LOCKED'?'CONFLICT':'INVALID_INPUT');
          throw error;
        });
        requireAcademic(Date.now()<expires,'FORBIDDEN');
        await saveWorkspaceModelConfig(this.pool,owner,next,input.revision,{
          clearKeys:keysClearedBy(change),
          afterWrite:async(tx,revision)=>{
            requireAcademic(Date.now()<expires,'FORBIDDEN');
            await tx.query(`INSERT INTO zhiban_service_events(tenant_id,actor_id,command_id,event_kind,revision,summary,sealed_intent)
              VALUES($1,$2,$3,'CONFIG_CHANGED',$4,$5::jsonb,$6::jsonb)`,[x.tenantId,x.actorMembershipId,command,revision,JSON.stringify(auditSummary(input.change)),JSON.stringify(sealSecret(intent,owner+':'+command))]);
          },
        });
        return modelSettingsView(await this.stored(x.tenantId));
      } finally { await client.query('SELECT pg_advisory_unlock(hashtext($1))',[owner]).catch(()=>{});client.release(); }
    });
  }
  async check(x:AcademicContext,raw:unknown,command:string,signal:AbortSignal) {
    const parsed=probeInput.safeParse(raw);requireAcademic(parsed.success);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(command));
    const input=parsed.data!, tenant=x.tenantId,owner=serviceOwner(tenant);
    requireAcademic(input.kind!=='llm'||!!input.model);
    // One live check per space, max two per process. Uncertain checks are never auto-replayed.
    requireAcademic(this.probes.size<2&&!this.probes.has(tenant),'UNAVAILABLE');
    this.probes.add(tenant);
    let lease:PoolClient|undefined, producer:Promise<Response>|undefined;
    const release=async()=>{if(lease){await lease.query('SELECT pg_advisory_unlock(hashtext($1))',[owner+':check']).catch(()=>{});lease.release();lease=undefined;}this.probes.delete(tenant);};
    try {
      lease=await this.guard(x,async()=>{
        const c=await this.pool.connect();
        try {const r=await c.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok',[owner+':check']);requireAcademic(r.rows[0].ok,'UNAVAILABLE');return c;}
        catch(e){c.release();throw e;}
      });
      const receipt=await this.guard(x,async()=>{
        const intent=createHmac('sha256',instanceKey().key).update(JSON.stringify(input)).digest('hex');
        const config=await this.stored(tenant);
        requireAcademic((config?.revision??null)===input.revision,'CONFLICT');
        requireAcademic(modelSettingsView(config).providers.some(p=>p.id===input.provider),'NOT_FOUND');
        const row=(await this.pool.query(`INSERT INTO zhiban_service_events(tenant_id,actor_id,command_id,event_kind,revision,summary,sealed_intent)
          VALUES($1,$2,$3,'CHECK_STARTED',$4,$5::jsonb,$6::jsonb) ON CONFLICT(tenant_id,command_id) DO NOTHING RETURNING event_id`,[tenant,x.actorMembershipId,command,input.revision,JSON.stringify({kind:input.kind,provider:input.provider,state:'RUNNING_OR_UNKNOWN',scope:'CONNECTION_ONLY_NOT_GENERATION_ACCEPTANCE'}),JSON.stringify(sealSecret(intent,owner+':'+command))])).rows[0];
        if(!row){const prior=(await this.pool.query('SELECT sealed_intent,summary FROM zhiban_service_events WHERE tenant_id=$1 AND command_id=$2',[tenant,command])).rows[0];
          requireAcademic(prior&&openSecret(prior.sealed_intent,owner+':'+command)===intent,'CONFLICT');return prior.summary;}
        return null;
      });
      if(receipt) return receipt;
      const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),45000);
      const cancelled=()=>abort.abort();signal.addEventListener('abort',cancelled,{once:true});
      let result:{state:string;kind:string;provider:string;scope:string;models?:{id:string}[]};
      try {
        const handler={llm:llm.POST,image:image.POST,video:video.POST,document:document.POST,tts:tts.POST,asr:asr.POST,catalogue:catalogue.POST}[input.kind];
        let request:NextRequest;
        if(input.kind==='asr'){
          // Fixed one-second silent PCM. No arbitrary browser file, transcript or target.
          const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(32036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
          const form=new FormData();form.set('audio',new File([wav],'connection-check.wav',{type:'audio/wav'}));form.set('previewProvider',input.provider);if(input.model)form.set('previewModel',input.model);
          request=new NextRequest('https://service-center.invalid/api/transcription',{method:'POST',body:form,signal:abort.signal});
        }else{
          const data=input.kind==='tts'?{text:'连接检查',audioId:'service-center-check',previewProvider:input.provider,...(input.model?{previewModel:input.model}:{})}:{provider:input.provider,...(input.model?{model:input.model}:{})};
          request=new NextRequest('https://service-center.invalid/api/verify-'+input.kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:abort.signal});
        }
        const pending=producer=withServiceTenant(tenant,()=>withServiceOperator(owner,()=>this.guard(x,async()=>{}),()=>handler(request)));
        const response=await Promise.race([pending,new Promise<never>((_,reject)=>{ if(abort.signal.aborted)reject(Error('cancelled'));else abort.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}); })]);
        const data=input.kind==='catalogue'&&response.ok?await response.json():null;
        await response.body?.cancel().catch(()=>{});
        result={state:response.ok?'PASS':'FAILED',kind:input.kind,provider:input.provider,scope:'CONNECTION_ONLY_NOT_GENERATION_ACCEPTANCE',...(data?{models:(Array.isArray(data.models)?data.models:[]).filter((m:{id?:unknown})=>typeof m.id==='string'&&m.id.length<=256).slice(0,200).map((m:{id:string})=>({id:m.id}))}:{})};
      } catch { result={state:abort.signal.aborted?'UNKNOWN':'FAILED',kind:input.kind,provider:input.provider,scope:'CONNECTION_ONLY_NOT_GENERATION_ACCEPTANCE'}; }
      finally{clearTimeout(timeout);signal.removeEventListener('abort',cancelled);}
      await this.guard(x,async()=>{
        requireAcademic((await this.stored(tenant))?.revision===input.revision || input.revision===null && !(await this.stored(tenant)),'CONFLICT');
        await this.pool.query(`UPDATE zhiban_service_events SET event_kind='CHECK_FINISHED',summary=$3::jsonb WHERE tenant_id=$1 AND command_id=$2`,[tenant,command,JSON.stringify(result)]);
      });
      return result;
    } finally {
      // A timeout ends the HTTP wait, not necessarily a provider call. Hold both limits until it settles.
      if(producer) void producer.then(release,release); else await release();
    }
  }
}
