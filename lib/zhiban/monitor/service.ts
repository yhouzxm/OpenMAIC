import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { MonitorPolicy } from './types';

function canManage(p:AuthorizedPrincipal,courseId:string){return p.grants.some(g=>g.permission==='course:manage'&&(g.scopeType==='tenant'||g.scopeType==='system'||(g.scopeType==='course'&&g.scopeId===courseId)));}
const policy=(row:Record<string,unknown>|undefined):MonitorPolicy=>({enabled:Boolean(row?.enabled),mode:String(row?.mode??'shadow') as MonitorPolicy['mode'],tutorThreshold:Number(row?.tutor_threshold??60),peerThreshold:Number(row?.peer_threshold??35),teacherThreshold:Number(row?.teacher_threshold??75),cooldownMinutes:Number(row?.cooldown_minutes??30),dailyLimit:Number(row?.daily_limit??3),followupHours:Number(row?.followup_hours??24),policyVersion:String(row?.policy_version??'monitor-v2')});
export async function getMonitorDashboard(pool:ZhibanDatabasePool,p:AuthorizedPrincipal,courseId:string){if(!canManage(p,courseId))throw new Error('Permission denied');return withZhibanTenant(pool,p.tenantId,async client=>{
  const [config,decisions,effectiveness]=await Promise.all([
    client.query<Record<string,unknown>>(`SELECT COALESCE(m.enabled,(s.agent_settings->>'monitorEnabled')::boolean,false) enabled,COALESCE(m.mode,CASE WHEN COALESCE((s.agent_settings->>'monitorEnabled')::boolean,false) THEN 'active' ELSE 'shadow' END) mode,m.tutor_threshold,m.peer_threshold,m.teacher_threshold,m.cooldown_minutes,m.daily_limit,m.followup_hours,m.policy_version FROM zhiban.courses c LEFT JOIN zhiban.course_settings s ON s.course_id=c.id LEFT JOIN zhiban.course_monitor_configs m ON m.course_id=c.id WHERE c.id=$1`,[courseId]),
    client.query<Record<string,unknown>>(`SELECT d.*,a.display_name learner_name FROM zhiban.monitor_decisions d JOIN zhiban.accounts a ON a.id=d.learner_id WHERE d.course_id=$1 ORDER BY d.created_at DESC LIMIT 200`,[courseId]),
    client.query<Record<string,unknown>>(`SELECT count(*)::int measured,count(*)FILTER(WHERE effective)::int effective_count,round(avg(before_score-after_score),2)::text average_reduction FROM zhiban.intervention_effectiveness WHERE course_id=$1 AND measured_by='monitor'`,[courseId]),
  ]);return {policy:policy(config.rows[0]),decisions:decisions.rows,effectiveness:effectiveness.rows[0]??{}};
});}
export async function saveMonitorPolicy(pool:ZhibanDatabasePool,p:AuthorizedPrincipal,courseId:string,input:MonitorPolicy){if(!canManage(p,courseId))throw new Error('Permission denied');return withZhibanTenant(pool,p.tenantId,async client=>{
  await client.query(`INSERT INTO zhiban.course_monitor_configs(id,tenant_id,course_id,enabled,mode,tutor_threshold,peer_threshold,teacher_threshold,cooldown_minutes,daily_limit,followup_hours,policy_version,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(tenant_id,course_id) DO UPDATE SET enabled=excluded.enabled,mode=excluded.mode,tutor_threshold=excluded.tutor_threshold,peer_threshold=excluded.peer_threshold,teacher_threshold=excluded.teacher_threshold,cooldown_minutes=excluded.cooldown_minutes,daily_limit=excluded.daily_limit,followup_hours=excluded.followup_hours,policy_version=excluded.policy_version,updated_by=excluded.updated_by,version=course_monitor_configs.version+1,updated_at=now()`,[randomUUID(),p.tenantId,courseId,input.enabled,input.mode,input.tutorThreshold,input.peerThreshold,input.teacherThreshold,input.cooldownMinutes,input.dailyLimit,input.followupHours,input.policyVersion,p.id]);
  await client.query(`UPDATE zhiban.course_settings SET agent_settings=jsonb_set(COALESCE(agent_settings,'{}'::jsonb),'{monitorEnabled}',to_jsonb($2::boolean),true),updated_by=$3,updated_at=now() WHERE course_id=$1`,[courseId,input.enabled&&input.mode!=='paused',p.id]);
  return {saved:true};
});}
