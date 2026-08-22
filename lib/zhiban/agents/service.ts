import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { buildCourseAgentConfigs, type AgentFeatureSettings } from './templates';
import type {
  CourseAgentRuntime,
  InterventionBrief,
  InterventionTarget,
  ZhibanAgentRole,
} from './types';
import { assessMonitorRisk, type MonitorPolicy } from '@/lib/zhiban/monitor';

const forbidden = ['心理诊断', '医疗建议', '代写作业', '最终成绩承诺', '泄露其他学习者信息'];

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function decideIntervention(
  dimensions: Record<string, unknown>,
  settings: AgentFeatureSettings,
  warning: Record<string, unknown>,
): { target: InterventionTarget; objective: string; tone: string } | null {
  if (!settings.monitorEnabled) return null;
  const assessment=assessMonitorRisk(dimensions,{enabled:true,mode:'active',tutorThreshold:numeric(warning.scoreThreshold)||60,peerThreshold:30,teacherThreshold:75,cooldownMinutes:30,dailyLimit:3,followupHours:24,policyVersion:'monitor-v2'});
  if (!assessment.target) return null;
  if (assessment.target === 'tutor' && !settings.tutorEnabled) return null;
  if (assessment.target === 'peer' && !settings.peerEnabled) return null;
  return { target: assessment.target, objective: assessment.objective, tone: assessment.tone };
}

export async function evaluateMonitorIntervention(
  pool: ZhibanDatabasePool,
  tenantId: string,
  input: { learnerId: string; courseId: string; eventId: string },
) {
  return withZhibanTenant(pool, tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT p.dimensions,p.evidence_summary,
        COALESCE(s.agent_settings,'{"tutorEnabled":true,"peerEnabled":false,"monitorEnabled":false,"strategyEnabled":false}'::jsonb) agent_settings,
        COALESCE(s.warning_policy,'{"scoreThreshold":60}'::jsonb) warning_policy,
        COALESCE(s.prompt_strategy,'{"version":"v1"}'::jsonb) prompt_strategy,
        COALESCE(peer.proactive_enabled,false) peer_proactive_enabled,
        COALESCE(peer.cooldown_minutes,30) peer_cooldown_minutes,
        COALESCE(peer.enabled,false) peer_config_enabled,COALESCE(peer.status,'draft') peer_status,
        monitor.id monitor_config_id,COALESCE(monitor.enabled,false) monitor_config_enabled,
        COALESCE(monitor.mode,'shadow') monitor_mode,COALESCE(monitor.tutor_threshold,60) tutor_threshold,
        COALESCE(monitor.peer_threshold,35) peer_threshold,COALESCE(monitor.teacher_threshold,75) teacher_threshold,
        COALESCE(monitor.cooldown_minutes,30) monitor_cooldown_minutes,COALESCE(monitor.daily_limit,3) daily_limit,
        COALESCE(monitor.followup_hours,24) followup_hours,COALESCE(monitor.policy_version,'monitor-v2') monitor_policy_version
       FROM zhiban.courses c LEFT JOIN zhiban.course_settings s ON s.course_id=c.id
       LEFT JOIN zhiban.course_peer_configs peer ON peer.course_id=c.id
       LEFT JOIN zhiban.course_monitor_configs monitor ON monitor.course_id=c.id
       LEFT JOIN zhiban.learner_profiles p ON p.course_id=c.id AND p.learner_id=$2
       WHERE c.id=$1`,
      [input.courseId, input.learnerId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Course not found for monitor evaluation');
    const settings = { ...(row.agent_settings as AgentFeatureSettings) };
    settings.peerEnabled =
      settings.peerEnabled &&
      Boolean(row.peer_config_enabled) &&
      row.peer_status === 'published' &&
      Boolean(row.peer_proactive_enabled);
    const policy:MonitorPolicy={enabled:row.monitor_config_id?Boolean(row.monitor_config_enabled):settings.monitorEnabled,mode:(row.monitor_config_id?String(row.monitor_mode):(settings.monitorEnabled?'active':'paused')) as MonitorPolicy['mode'],tutorThreshold:Number(row.tutor_threshold),peerThreshold:Number(row.peer_threshold),teacherThreshold:Number(row.teacher_threshold),cooldownMinutes:Number(row.monitor_cooldown_minutes),dailyLimit:Number(row.daily_limit),followupHours:Number(row.followup_hours),policyVersion:String(row.monitor_policy_version)};
    const dimensions=(row.dimensions as Record<string,unknown>|null)??{};
    const assessment=assessMonitorRisk(dimensions,policy);
    if(input.eventId.startsWith('monitor-followup:')){
      const briefId=input.eventId.slice('monitor-followup:'.length);
      const before=await client.query<{risk_score:string}>(`SELECT risk_score::text FROM zhiban.monitor_decisions WHERE brief_id=$1 ORDER BY created_at DESC LIMIT 1`,[briefId]);
      const beforeScore=before.rows[0]?Number(before.rows[0].risk_score):null;
      await client.query(`INSERT INTO zhiban.intervention_effectiveness(id,tenant_id,brief_id,course_id,learner_id,before_score,after_score,effective,measured_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'monitor') ON CONFLICT(tenant_id,brief_id,measured_by) DO UPDATE SET after_score=excluded.after_score,effective=excluded.effective,measured_at=now()`,[randomUUID(),tenantId,briefId,input.courseId,input.learnerId,beforeScore,assessment.riskScore,beforeScore==null?null:assessment.riskScore<beforeScore]);
      return {created:false,followup:true,briefId,beforeScore,afterScore:assessment.riskScore};
    }
    if (assessment.target==='peer' && !settings.peerEnabled) assessment.target=null;
    if (assessment.target==='tutor' && !settings.tutorEnabled) assessment.target=null;
    const decisionId=randomUUID();
    const recordDecision=async(disposition:string,briefId?:string)=>client.query(
      `INSERT INTO zhiban.monitor_decisions(id,tenant_id,course_id,learner_id,source_event_id,risk_score,risk_level,signal_type,target_role,disposition,reason,evidence,policy_version,brief_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) ON CONFLICT(tenant_id,course_id,learner_id,source_event_id) DO NOTHING`,
      [decisionId,tenantId,input.courseId,input.learnerId,input.eventId,assessment.riskScore,assessment.riskLevel,assessment.signalType,assessment.target,disposition,assessment.reason,JSON.stringify({dimensions,evidence:row.evidence_summary??{}}),policy.policyVersion,briefId??null]);
    if(!policy.enabled||policy.mode==='paused'||!assessment.target){await recordDecision('no_action');return {created:false,decisionId};}
    if(policy.mode==='shadow'){await recordDecision('shadow');return {created:false,shadow:true,decisionId};}
    const decision={target:assessment.target,objective:assessment.objective,tone:assessment.tone};
    const cooldownMinutes =
      decision.target === 'peer' ? Math.max(policy.cooldownMinutes,Number(row.peer_cooldown_minutes ?? 30)) : policy.cooldownMinutes;
    const recent = await client.query(
      `SELECT 1 FROM zhiban.intervention_briefs
       WHERE learner_id=$1 AND course_id=$2 AND target_role=$3
         AND status IN('pending','accepted','running','delivered')
         AND created_at > now()-($4::int*interval '1 minute') LIMIT 1`,
      [input.learnerId, input.courseId, decision.target, cooldownMinutes],
    );
    if (recent.rows[0]) {await recordDecision('suppressed');return { created: false, suppressed: 'cooldown' as const,decisionId };}
    const daily=await client.query(`SELECT count(*)::int count FROM zhiban.intervention_briefs WHERE learner_id=$1 AND course_id=$2 AND created_at>=date_trunc('day',now())`,[input.learnerId,input.courseId]);
    if(Number(daily.rows[0]?.count??0)>=policy.dailyLimit){await recordDecision('suppressed');return {created:false,suppressed:'daily_limit' as const,decisionId};}
    const commandId = `monitor:${input.learnerId}:${input.courseId}:${input.eventId}:${decision.target}`;
    const id = randomUUID();
    const promptVersion = String((row.prompt_strategy as Record<string, unknown>)?.version ?? 'v1');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO zhiban.intervention_briefs(id,tenant_id,learner_id,course_id,source_event_id,target_role,level,objective,tone,evidence_summary,prohibited_content,max_turns,policy_version,prompt_version,command_id)
       VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9::jsonb,$10::jsonb,4,$13,$11,$12)
       ON CONFLICT(tenant_id,command_id) DO NOTHING RETURNING id`,
      [
        id,
        tenantId,
        input.learnerId,
        input.courseId,
        input.eventId,
        decision.target,
        decision.objective,
        decision.tone,
        JSON.stringify({ dimensions: row.dimensions ?? {}, evidence: row.evidence_summary ?? {} }),
        JSON.stringify(forbidden),
        promptVersion,
        commandId,
        policy.policyVersion,
      ],
    );
    if (!inserted.rows[0]) {await recordDecision('suppressed');return { created: false,decisionId };}
    await recordDecision(decision.target==='teacher'?'escalated':'dispatched',id);
    await client.query(
      `INSERT INTO zhiban.intervention_transitions(id,tenant_id,brief_id,actor_type,to_status,metadata) VALUES($1,$2,$3,'monitor','pending',$4::jsonb)`,
      [
        randomUUID(),
        tenantId,
        id,
        JSON.stringify({ sourceEventId: input.eventId, policyVersion: policy.policyVersion,decisionId,riskScore:assessment.riskScore }),
      ],
    );
    if(decision.target==='teacher'){
      const recipient=await client.query<{id:string}>(`SELECT COALESCE(c.owner_teacher_id,(SELECT ta.teacher_id FROM zhiban.course_offerings o JOIN zhiban.teaching_assignments ta ON ta.offering_id=o.id AND ta.ended_at IS NULL WHERE o.course_id=c.id ORDER BY ta.assigned_at LIMIT 1)) id FROM zhiban.courses c WHERE c.id=$1`,[input.courseId]);
      await client.query(`INSERT INTO zhiban.risk_notifications(id,tenant_id,course_id,case_id,recipient_id,notification_type,title,message) VALUES($1,$2,$3,NULL,$4,'monitor_escalation','Monitor 学习支持升级',$5)`,[randomUUID(),tenantId,input.courseId,recipient.rows[0]?.id??null,assessment.reason]);
    }
    return { created: true, id,decisionId,target:decision.target,riskScore:assessment.riskScore };
  });
}

export async function getCourseAgentRuntime(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
): Promise<CourseAgentRuntime> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const enrolled = await client.query(
      `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id
       WHERE e.student_id=$1 AND o.course_id=$2 AND e.status='enrolled' LIMIT 1`,
      [principal.id, courseId],
    );
    if (!enrolled.rows[0]) throw new Error('Learner is not enrolled in this course');
    const result = await client.query<Record<string, unknown>>(
      `SELECT COALESCE(agent_settings,'{"tutorEnabled":true,"peerEnabled":false,"monitorEnabled":false,"strategyEnabled":false}'::jsonb) agent_settings,
        COALESCE(prompt_strategy,'{"version":"v1"}'::jsonb) prompt_strategy FROM zhiban.course_settings WHERE course_id=$1`,
      [courseId],
    );
    const settings = (result.rows[0]?.agent_settings ?? {
      tutorEnabled: true,
      peerEnabled: false,
      monitorEnabled: false,
      strategyEnabled: false,
    }) as AgentFeatureSettings;
    const promptVersion = String(
      (result.rows[0]?.prompt_strategy as Record<string, unknown> | undefined)?.version ?? 'v1',
    );
    const templates = await client.query<{
      role_type: 'tutor' | 'peer';
      name: string;
      persona: string;
      version: string;
    }>(
      `SELECT DISTINCT ON(role_type) role_type,name,persona,version FROM zhiban.agent_role_templates
       WHERE (course_id=$1 OR course_id IS NULL) AND status='active' AND role_type IN('tutor','peer')
       ORDER BY role_type,(course_id=$1) DESC,updated_at DESC`,
      [courseId],
    );
    const overrides = new Map(templates.rows.map((item) => [item.role_type, item]));
    const agents = buildCourseAgentConfigs(courseId, settings, promptVersion).map((agent) => {
      const role = agent.id.includes('-tutor-') ? 'tutor' : 'peer';
      const template = overrides.get(role);
      return template
        ? {
            ...agent,
            name: template.name,
            persona: `${template.persona}\n提示词模板版本：${template.version}`,
          }
        : agent;
    });
    return { courseId, promptVersion, agents };
  });
}

function mapBrief(row: Record<string, unknown>): InterventionBrief {
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    targetRole: row.target_role as InterventionTarget,
    level: row.level as InterventionTarget,
    objective: String(row.objective),
    tone: String(row.tone),
    evidenceSummary: row.evidence_summary as Record<string, unknown>,
    prohibitedContent: row.prohibited_content as string[],
    maxTurns: Number(row.max_turns),
    policyVersion: String(row.policy_version),
    promptVersion: String(row.prompt_version),
    status: row.status as InterventionBrief['status'],
    createdAt: new Date(row.created_at as string).toISOString(),
    expiresAt: new Date(row.expires_at as string).toISOString(),
  };
}

export async function listPendingInterventions(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await client.query(
      `UPDATE zhiban.intervention_briefs SET status='expired' WHERE learner_id=$1 AND course_id=$2 AND status='pending' AND expires_at<=now()`,
      [principal.id, courseId],
    );
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM zhiban.intervention_briefs WHERE learner_id=$1 AND course_id=$2 AND status='pending' ORDER BY created_at DESC LIMIT 3`,
      [principal.id, courseId],
    );
    return result.rows.map(mapBrief);
  });
}

export async function respondToIntervention(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  briefId: string,
  courseId: string,
  action: 'accept' | 'dismiss',
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const current = await client.query<Record<string, unknown>>(
      `SELECT * FROM zhiban.intervention_briefs WHERE id=$1 AND learner_id=$2 AND course_id=$3 FOR UPDATE`,
      [briefId, principal.id, courseId],
    );
    if (!current.rows[0]) throw new Error('Intervention not found');
    if (current.rows[0].status !== 'pending') throw new Error('Intervention is no longer pending');
    const status = action === 'accept' ? 'accepted' : 'dismissed';
    await client.query(
      `UPDATE zhiban.intervention_briefs SET status=$2,responded_at=now() WHERE id=$1`,
      [briefId, status],
    );
    await client.query(
      `INSERT INTO zhiban.intervention_transitions(id,tenant_id,brief_id,actor_type,actor_id,from_status,to_status,metadata) VALUES($1,$2,$3,'student',$4,'pending',$5,$6::jsonb)`,
      [randomUUID(), principal.tenantId, briefId, principal.id, status, JSON.stringify({ action })],
    );
    return { brief: mapBrief({ ...current.rows[0], status }), action };
  });
}

function canManageCourse(principal: AuthorizedPrincipal, courseId: string) {
  return principal.grants.some(
    (grant) =>
      grant.permission === 'course:manage' &&
      (grant.scopeType === 'tenant' ||
        grant.scopeType === 'system' ||
        (grant.scopeType === 'course' && grant.scopeId === courseId)),
  );
}

export async function recordInterventionOutcome(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: {
    briefId: string;
    courseId: string;
    outcome: 'start' | 'deliver' | 'fail';
    latencyMs?: number;
    error?: string;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const found = await client.query<Record<string, unknown>>(
      `SELECT * FROM zhiban.intervention_briefs WHERE id=$1 AND learner_id=$2 AND course_id=$3 FOR UPDATE`,
      [input.briefId, principal.id, input.courseId],
    );
    const row = found.rows[0];
    if (!row) throw new Error('Intervention not found');
    const from = String(row.status);
    const status =
      input.outcome === 'start' ? 'running' : input.outcome === 'deliver' ? 'delivered' : 'failed';
    await client.query(
      `UPDATE zhiban.intervention_briefs SET status=$2,
       attempt_count=attempt_count+CASE WHEN $2='running' THEN 1 ELSE 0 END,
       started_at=CASE WHEN $2='running' THEN now() ELSE started_at END,
       delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END,
       last_error=CASE WHEN $2='failed' THEN $3 ELSE last_error END WHERE id=$1`,
      [input.briefId, status, input.error ?? null],
    );
    await client.query(
      `INSERT INTO zhiban.intervention_transitions(id,tenant_id,brief_id,actor_type,actor_id,from_status,to_status,metadata)
       VALUES($1,$2,$3,'system',$4,$5,$6,$7::jsonb)`,
      [
        randomUUID(),
        principal.tenantId,
        input.briefId,
        principal.id,
        from,
        status,
        JSON.stringify({ latencyMs: input.latencyMs, error: input.error }),
      ],
    );
    await client.query(
      `INSERT INTO zhiban.agent_invocation_metrics(id,tenant_id,brief_id,course_id,learner_id,role_type,outcome,latency_ms,error_code)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        principal.tenantId,
        input.briefId,
        input.courseId,
        principal.id,
        row.target_role,
        input.outcome === 'start'
          ? 'started'
          : input.outcome === 'deliver'
            ? 'succeeded'
            : 'failed',
        input.latencyMs ?? null,
        input.error ? 'runtime_error' : null,
      ],
    );
    if (input.outcome !== 'start') {
      const eventId = randomUUID();
      const sourceId = `agent:${input.briefId}:${input.outcome}`;
      await client.query(
        `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,payload,occurred_at)
         VALUES($1,$2,$3,$4,'system',$5,$6,$7::jsonb,now()) ON CONFLICT DO NOTHING`,
        [
          eventId,
          principal.tenantId,
          principal.id,
          input.courseId,
          sourceId,
          `agent_intervention_${status}`,
          JSON.stringify({
            briefId: input.briefId,
            role: row.target_role,
            latencyMs: input.latencyMs,
            error: input.error,
          }),
        ],
      );
      if(input.outcome==='deliver'){
        const monitorConfig=await client.query<{followup_hours:number}>(`SELECT followup_hours FROM zhiban.course_monitor_configs WHERE course_id=$1 AND enabled`,[input.courseId]);
        if(monitorConfig.rows[0]) await client.query(
          `INSERT INTO zhiban.analysis_jobs(id,tenant_id,job_type,idempotency_key,payload,run_after) VALUES($1,$2,'monitor_evaluate',$3,$4::jsonb,now()+($5::int*interval '1 hour')) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
          [randomUUID(),principal.tenantId,`monitor_followup:${input.briefId}`,JSON.stringify({learnerId:principal.id,courseId:input.courseId,eventId:`monitor-followup:${input.briefId}`}),monitorConfig.rows[0].followup_hours],
        );
      }
      await client.query(
        `INSERT INTO zhiban.analysis_jobs(id,tenant_id,job_type,idempotency_key,payload)
         VALUES($1,$2,'profile_rebuild',$3,$4::jsonb) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        [
          randomUUID(),
          principal.tenantId,
          `profile_rebuild:${principal.id}:${input.courseId}:${sourceId}`,
          JSON.stringify({
            learnerId: principal.id,
            courseId: input.courseId,
            sourceEventId: sourceId,
          }),
        ],
      );
    }
    return { status };
  });
}

export async function listTeacherInterventions(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  if (!canManageCourse(principal, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT b.*,a.display_name learner_name,a.login_name learner_username,
       COALESCE((SELECT jsonb_build_object('calls',count(*),'failures',count(*) FILTER(WHERE outcome IN('failed','timeout')),'avgLatencyMs',round(avg(latency_ms))) FROM zhiban.agent_invocation_metrics m WHERE m.brief_id=b.id),'{}'::jsonb) metrics
       FROM zhiban.intervention_briefs b JOIN zhiban.accounts a ON a.id=b.learner_id
       WHERE b.course_id=$1 ORDER BY b.created_at DESC LIMIT 200`,
      [courseId],
    );
    return result.rows;
  });
}

export async function manageTeacherIntervention(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: {
    courseId: string;
    briefId: string;
    action: 'escalate' | 'resolve' | 'retry' | 'assign';
    note?: string;
    assignedTo?: string;
    effective?: boolean;
    outcomeScore?: number;
  },
) {
  if (!canManageCourse(principal, input.courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const found = await client.query<{ status: string }>(
      `SELECT status FROM zhiban.intervention_briefs WHERE id=$1 AND course_id=$2 FOR UPDATE`,
      [input.briefId, input.courseId],
    );
    if (!found.rows[0]) throw new Error('Intervention not found');
    const status =
      input.action === 'resolve'
        ? 'resolved'
        : input.action === 'retry'
          ? 'pending'
          : input.action === 'escalate'
            ? 'escalated'
            : found.rows[0].status;
    await client.query(
      `UPDATE zhiban.intervention_briefs SET status=$2,assigned_to=CASE WHEN $3='assign' THEN $4::uuid ELSE assigned_to END,
       resolution_note=CASE WHEN $3='resolve' THEN $5 ELSE resolution_note END,resolved_at=CASE WHEN $3='resolve' THEN now() ELSE resolved_at END,
       expires_at=CASE WHEN $3='retry' THEN now()+interval '7 days' ELSE expires_at END WHERE id=$1`,
      [input.briefId, status, input.action, input.assignedTo ?? principal.id, input.note ?? null],
    );
    if(input.action==='resolve') await client.query(
      `INSERT INTO zhiban.intervention_effectiveness(id,tenant_id,brief_id,course_id,learner_id,effective,after_score,teacher_note,measured_by)
       SELECT $1,$2,b.id,b.course_id,b.learner_id,$3,$4,$5,'teacher' FROM zhiban.intervention_briefs b WHERE b.id=$6
       ON CONFLICT(tenant_id,brief_id,measured_by) DO UPDATE SET effective=excluded.effective,after_score=excluded.after_score,teacher_note=excluded.teacher_note,measured_at=now()`,
      [randomUUID(),principal.tenantId,input.effective??null,input.outcomeScore??null,input.note??null,input.briefId],
    );
    await client.query(
      `INSERT INTO zhiban.intervention_transitions(id,tenant_id,brief_id,actor_type,actor_id,from_status,to_status,metadata) VALUES($1,$2,$3,'teacher',$4,$5,$6,$7::jsonb)`,
      [
        randomUUID(),
        principal.tenantId,
        input.briefId,
        principal.id,
        found.rows[0].status,
        status,
        JSON.stringify({ action: input.action, note: input.note }),
      ],
    );
    return { status };
  });
}

export async function listAgentTemplates(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  if (!canManageCourse(principal, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(
    pool,
    principal.tenantId,
    async (client) =>
      (
        await client.query(
          `SELECT id,role_type,version,name,persona,policy,status,created_at,updated_at FROM zhiban.agent_role_templates WHERE course_id=$1 ORDER BY role_type,created_at DESC`,
          [courseId],
        )
      ).rows,
  );
}

export async function createAgentTemplate(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: {
    courseId: string;
    roleType: ZhibanAgentRole;
    version: string;
    name: string;
    persona: string;
    policy?: Record<string, unknown>;
    publish?: boolean;
  },
) {
  if (!canManageCourse(principal, input.courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    if (input.publish)
      await client.query(
        `UPDATE zhiban.agent_role_templates SET status='archived',updated_at=now() WHERE course_id=$1 AND role_type=$2 AND status='active'`,
        [input.courseId, input.roleType],
      );
    const result = await client.query(
      `INSERT INTO zhiban.agent_role_templates(id,tenant_id,course_id,role_type,version,name,persona,policy,status,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) RETURNING *`,
      [
        randomUUID(),
        principal.tenantId,
        input.courseId,
        input.roleType,
        input.version,
        input.name,
        input.persona,
        JSON.stringify(input.policy ?? {}),
        input.publish ? 'active' : 'draft',
        principal.id,
      ],
    );
    return result.rows[0];
  });
}

export async function publishAgentTemplate(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  templateId: string,
) {
  if (!canManageCourse(principal, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const found = await client.query<{ role_type: string }>(
      `SELECT role_type FROM zhiban.agent_role_templates WHERE id=$1 AND course_id=$2 FOR UPDATE`,
      [templateId, courseId],
    );
    if (!found.rows[0]) throw new Error('Template not found');
    await client.query(
      `UPDATE zhiban.agent_role_templates SET status='archived',updated_at=now() WHERE course_id=$1 AND role_type=$2 AND status='active'`,
      [courseId, found.rows[0].role_type],
    );
    await client.query(
      `UPDATE zhiban.agent_role_templates SET status='active',updated_at=now() WHERE id=$1`,
      [templateId],
    );
    return { status: 'active' };
  });
}
