import { createHash, randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
export type RiskSignals = {
  achievement: number;
  engagement: number;
  completion: number;
  inactivityDays: number;
  missedAssignments: number;
  scoreThreshold: number;
  inactivityThreshold: number;
  missedThreshold: number;
  emaConfidence?: number;
  emaDifficulty?: number;
  emaEmotion?: number;
};
export function calculateRisk(s: RiskSignals) {
  let score = 0;
  const evidence: Record<string, unknown> = {};
  const sources: string[] = [];
  if (s.achievement > 0 && s.achievement < s.scoreThreshold) {
    score += Math.min(30, (s.scoreThreshold - s.achievement) / 2 + 15);
    evidence.achievement = s.achievement;
    sources.push('achievement');
  }
  if (s.engagement < 35) {
    score += 20;
    evidence.engagement = s.engagement;
    sources.push('engagement');
  }
  if (s.completion < 50) {
    score += 20;
    evidence.completion = s.completion;
    sources.push('completion');
  }
  if (s.inactivityDays >= s.inactivityThreshold) {
    score += 25;
    evidence.inactivityDays = s.inactivityDays;
    sources.push('activity');
  }
  if (s.missedAssignments >= s.missedThreshold) {
    score += 20;
    evidence.missedAssignments = s.missedAssignments;
    sources.push('assignments');
  }
  if ((s.emaConfidence ?? 5) <= 2 || (s.emaDifficulty ?? 1) >= 4 || (s.emaEmotion ?? 5) <= 2) {
    score += 15;
    evidence.ema = {
      confidence: s.emaConfidence,
      difficulty: s.emaDifficulty,
      emotion: s.emaEmotion,
    };
    sources.push('ema');
  }
  score = Math.min(100, Math.round(score));
  let level = score >= 70 ? 3 : score >= 45 ? 2 : score >= 20 ? 1 : 0;
  if (level === 3 && sources.length < 2) level = 2;
  const confidence = Math.min(0.95, 0.35 + sources.length * 0.15);
  const riskType =
    s.inactivityDays >= s.inactivityThreshold
      ? 'inactivity'
      : s.achievement > 0 && s.achievement < s.scoreThreshold
        ? 'achievement'
        : s.engagement < 35
          ? 'engagement'
          : s.completion < 50
            ? 'completion'
            : 'dropout';
  return { score, level, confidence, evidence, sources, riskType };
}
export async function evaluateLearnerRisk(
  pool: ZhibanDatabasePool,
  tenantId: string,
  input: { learnerId: string; courseId: string; eventId: string },
) {
  return withZhibanTenant(pool, tenantId, async (client) => {
    const row = (
      await client.query<Record<string, unknown>>(
        `SELECT p.dimensions,COALESCE(s.warning_policy,'{"scoreThreshold":60,"inactivityDays":7,"missedAssignments":2}'::jsonb) policy,(SELECT max(occurred_at) FROM zhiban.learning_events WHERE learner_id=$1 AND course_id=$2) last_activity,(SELECT count(*) FROM zhiban.course_grade_records WHERE student_id=$1 AND course_id=$2 AND status='absent') missed,(SELECT r.answers FROM zhiban.ema_responses r JOIN zhiban.ema_instances i ON i.id=r.instance_id WHERE r.learner_id=$1 AND i.course_id=$2 AND NOT r.skipped ORDER BY r.submitted_at DESC LIMIT 1) ema,COALESCE((SELECT jsonb_build_object('mode',mode,'automatic',automatic_intervention_enabled,'stop',emergency_stop) FROM zhiban.risk_course_controls WHERE course_id=$2),'{"mode":"active","automatic":true,"stop":false}'::jsonb) control FROM zhiban.courses c LEFT JOIN zhiban.course_settings s ON s.course_id=c.id LEFT JOIN zhiban.learner_profiles p ON p.course_id=c.id AND p.learner_id=$1 WHERE c.id=$2`,
        [input.learnerId, input.courseId],
      )
    ).rows[0];
    if (!row) throw new Error('Course not found');
    const d = (row.dimensions ?? {}) as Record<string, unknown>,
      p = row.policy as Record<string, unknown>;
    const ema = (row.ema ?? {}) as Record<string, unknown>,
      control = row.control as Record<string, unknown>;
    await client.query(
      `INSERT INTO zhiban.risk_rules(id,tenant_id,course_id,code,name,risk_type,configuration,version,status) VALUES($1,$2,$3,'course-warning','课程学习支持预警规则','dropout',$4::jsonb,1,'active') ON CONFLICT(tenant_id,course_id,code,version) DO UPDATE SET configuration=excluded.configuration,updated_at=now()`,
      [randomUUID(), tenantId, input.courseId, JSON.stringify(p)],
    );
    const last = row.last_activity ? new Date(row.last_activity as string) : null;
    const result = calculateRisk({
      achievement: Number(d.achievement ?? 0),
      engagement: Number(d.engagement ?? 0),
      completion: Number(d.completion ?? 0),
      inactivityDays: last ? Math.floor((Date.now() - last.getTime()) / 86400000) : 999,
      missedAssignments: Number(row.missed ?? 0),
      scoreThreshold: Number(p.scoreThreshold ?? 60),
      inactivityThreshold: Number(p.inactivityDays ?? 7),
      missedThreshold: Number(p.missedAssignments ?? 2),
      emaConfidence: ema.confidence === undefined ? undefined : Number(ema.confidence),
      emaDifficulty: ema.difficulty === undefined ? undefined : Number(ema.difficulty),
      emaEmotion: ema.emotion === undefined ? undefined : Number(ema.emotion),
    });
    const id = randomUUID();
    await client.query(
      `UPDATE zhiban.risk_snapshots SET status='superseded' WHERE learner_id=$1 AND course_id=$2 AND risk_type=$3 AND status='active'`,
      [input.learnerId, input.courseId, result.riskType],
    );
    const inserted = await client.query(
      `INSERT INTO zhiban.risk_snapshots(id,tenant_id,learner_id,course_id,risk_type,score,confidence,level,evidence,sources,rule_version,algorithm_version,source_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,'course-warning-v1','zhiban-risk-v1',$11) ON CONFLICT(tenant_id,learner_id,course_id,risk_type,source_event_id) DO NOTHING RETURNING id`,
      [
        id,
        tenantId,
        input.learnerId,
        input.courseId,
        result.riskType,
        result.score,
        result.confidence,
        result.level,
        JSON.stringify(result.evidence),
        JSON.stringify(result.sources),
        input.eventId,
      ],
    );
    if (
      !inserted.rows[0] ||
      result.level === 0 ||
      control.mode === 'shadow' ||
      control.mode === 'off'
    )
      return { created: false, shadow: control.mode === 'shadow', ...result };
    const caseId = randomUUID(),
      sla = result.level === 3 ? '4 hours' : result.level === 2 ? '24 hours' : '72 hours';
    await client.query(
      `INSERT INTO zhiban.risk_cases(id,tenant_id,snapshot_id,learner_id,course_id,severity,sla_due_at) VALUES($1,$2,$3,$4,$5,$6,now()+$7::interval)`,
      [caseId, tenantId, id, input.learnerId, input.courseId, result.level, sla],
    );
    await client.query(
      `INSERT INTO zhiban.risk_case_transitions(id,tenant_id,case_id,actor_type,to_status,action,metadata) VALUES($1,$2,$3,'system','new','risk.detected',$4::jsonb)`,
      [
        randomUUID(),
        tenantId,
        caseId,
        JSON.stringify({
          score: result.score,
          confidence: result.confidence,
          sources: result.sources,
        }),
      ],
    );
    if (result.level < 3 && control.automatic === true && control.stop !== true) {
      const pref = await client.query<{
        proactive_support_enabled: boolean;
        paused_until: string | null;
      }>(
        `SELECT proactive_support_enabled,paused_until FROM zhiban.risk_support_preferences WHERE learner_id=$1 AND course_id=$2`,
        [input.learnerId, input.courseId],
      );
      const enabled =
        !pref.rows[0] ||
        (pref.rows[0].proactive_support_enabled &&
          (pref.rows[0].paused_until === null || new Date(pref.rows[0].paused_until) < new Date()));
      if (enabled) {
        const target = result.level === 1 ? 'peer' : 'tutor';
        const briefId = randomUUID();
        await client.query(
          `INSERT INTO zhiban.intervention_briefs(id,tenant_id,learner_id,course_id,source_event_id,target_role,level,objective,tone,evidence_summary,prohibited_content,max_turns,policy_version,prompt_version,command_id) VALUES($1,$2,$3,$4,$5,$6,$6,$7,'支持、非评判',$8::jsonb,'["心理诊断","成绩承诺"]'::jsonb,4,'risk-v1','v1',$9) ON CONFLICT(tenant_id,command_id) DO NOTHING`,
          [
            briefId,
            tenantId,
            input.learnerId,
            input.courseId,
            input.eventId,
            target,
            result.level === 1 ? '帮助学习者明确下一步小行动' : '针对当前学习卡点提供分步支架',
            JSON.stringify({
              riskType: result.riskType,
              score: result.score,
              evidence: result.evidence,
            }),
            `risk:${caseId}`,
          ],
        );
        await client.query(`UPDATE zhiban.risk_cases SET intervention_brief_id=$2 WHERE id=$1`, [
          caseId,
          briefId,
        ]);
      }
    }
    if (result.level === 3)
      await client.query(
        `INSERT INTO zhiban.risk_notifications(id,tenant_id,course_id,case_id,notification_type,title,message) VALUES($1,$2,$3,$4,'level3','三级学习支持预警','请授权教师在SLA内确认并处置')`,
        [randomUUID(), tenantId, input.courseId, caseId],
      );
    return { created: true, caseId, ...result };
  });
}
function can(
  principal: AuthorizedPrincipal,
  permission: 'risk:read' | 'risk:handle',
  courseId: string,
) {
  return principal.grants.some(
    (g) =>
      g.permission === permission &&
      (g.scopeType === 'tenant' ||
        g.scopeType === 'system' ||
        g.scopeType === 'class' ||
        (g.scopeType === 'course' && g.scopeId === courseId)),
  );
}
export async function listRiskDashboard(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
) {
  if (!can(p, 'risk:read', courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    const overdue = await client.query<{ id: string; status: string }>(
      `SELECT id,status FROM zhiban.risk_cases WHERE course_id=$1 AND status IN('new','acknowledged','in_progress') AND sla_due_at<now() FOR UPDATE`,
      [courseId],
    );
    for (const item of overdue.rows)
      await client.query(
        `INSERT INTO zhiban.risk_case_transitions(id,tenant_id,case_id,actor_type,from_status,to_status,action,note) VALUES($1,$2,$3,'system',$4,'escalated','sla.escalated','SLA超时自动升级')`,
        [randomUUID(), p.tenantId, item.id, item.status],
      );
    await client.query(
      `UPDATE zhiban.risk_cases SET status='escalated',updated_at=now() WHERE course_id=$1 AND status IN('new','acknowledged','in_progress') AND sla_due_at<now()`,
      [courseId],
    );
    const cases = await client.query(
      `SELECT c.*,s.risk_type,s.score,s.confidence,s.evidence,s.sources,s.created_at snapshot_at,a.display_name,a.login_name FROM zhiban.risk_cases c JOIN zhiban.risk_snapshots s ON s.id=c.snapshot_id JOIN zhiban.accounts a ON a.id=c.learner_id WHERE c.course_id=$1 ORDER BY CASE c.status WHEN 'escalated' THEN 0 WHEN 'new' THEN 1 ELSE 2 END,c.severity DESC,c.created_at DESC`,
      [courseId],
    );
    const heatmap = await client.query(
      `SELECT learner_id,risk_type,date_trunc('day',created_at) AS snapshot_day,max(score) AS score,max(level) AS level FROM zhiban.risk_snapshots WHERE course_id=$1 AND created_at>now()-interval '30 days' GROUP BY learner_id,risk_type,date_trunc('day',created_at) ORDER BY snapshot_day`,
      [courseId],
    );
    const controls = await client.query(
      `SELECT * FROM zhiban.risk_course_controls WHERE course_id=$1`,
      [courseId],
    );
    const requests = await client.query(
      `SELECT r.*,a.display_name,a.login_name FROM zhiban.risk_learner_requests r JOIN zhiban.accounts a ON a.id=r.learner_id WHERE r.course_id=$1 ORDER BY r.created_at DESC`,
      [courseId],
    );
    const metrics = await client.query(
      `SELECT count(*)::int total,count(*) FILTER(WHERE status='dismissed')::int false_positives,count(*) FILTER(WHERE status='resolved')::int resolved,round(avg(extract(epoch FROM(resolved_at-created_at))/3600) FILTER(WHERE resolved_at IS NOT NULL),2) avg_resolution_hours,count(*) FILTER(WHERE status='escalated')::int escalated FROM zhiban.risk_cases WHERE course_id=$1`,
      [courseId],
    );
    const notifications = await client.query(
      `SELECT * FROM zhiban.risk_notifications WHERE course_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [courseId],
    );
    return {
      cases: cases.rows,
      heatmap: heatmap.rows,
      control: controls.rows[0] ?? {
        mode: 'active',
        automatic_intervention_enabled: true,
        emergency_stop: false,
      },
      requests: requests.rows,
      metrics: metrics.rows[0],
      notifications: notifications.rows,
    };
  });
}
export async function actOnRiskCase(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
  input: {
    caseId: string;
    action: 'acknowledge' | 'assign' | 'takeover' | 'escalate' | 'resolve' | 'dismiss';
    note?: string;
    assignedTo?: string;
  },
) {
  if (!can(p, 'risk:handle', courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    const found = await client.query<{ status: string; snapshot_id: string }>(
      `SELECT status,snapshot_id FROM zhiban.risk_cases WHERE id=$1 AND course_id=$2 FOR UPDATE`,
      [input.caseId, courseId],
    );
    if (!found.rows[0]) throw new Error('Risk case not found');
    const status =
      input.action === 'acknowledge' || input.action === 'assign'
        ? 'acknowledged'
        : input.action === 'takeover'
          ? 'in_progress'
          : input.action === 'escalate'
            ? 'escalated'
            : input.action === 'resolve'
              ? 'resolved'
              : 'dismissed';
    await client.query(
      `UPDATE zhiban.risk_cases SET status=$2,assigned_to=CASE WHEN $3 IN('assign','takeover') THEN $4 ELSE assigned_to END,takeover=CASE WHEN $3='takeover' THEN true ELSE takeover END,acknowledged_at=CASE WHEN $2='acknowledged' THEN now() ELSE acknowledged_at END,resolved_at=CASE WHEN $2 IN('resolved','dismissed') THEN now() ELSE resolved_at END,resolution_code=CASE WHEN $2='dismissed' THEN 'false_positive' WHEN $2='resolved' THEN 'supported' ELSE resolution_code END,resolution_note=CASE WHEN $2 IN('resolved','dismissed') THEN $5 ELSE resolution_note END,updated_at=now() WHERE id=$1`,
      [input.caseId, status, input.action, input.assignedTo ?? p.id, input.note ?? ''],
    );
    if (input.action === 'dismiss')
      await client.query(`UPDATE zhiban.risk_snapshots SET status='dismissed' WHERE id=$1`, [
        found.rows[0].snapshot_id,
      ]);
    if (input.action === 'takeover')
      await client.query(
        `UPDATE zhiban.intervention_briefs SET status='escalated',assigned_to=$2 WHERE source_event_id=(SELECT source_event_id FROM zhiban.risk_snapshots WHERE id=$1) AND status IN('pending','accepted','running')`,
        [found.rows[0].snapshot_id, p.id],
      );
    await client.query(
      `INSERT INTO zhiban.risk_case_transitions(id,tenant_id,case_id,actor_id,actor_type,from_status,to_status,action,note) VALUES($1,$2,$3,$4,'teacher',$5,$6,$7,$8)`,
      [
        randomUUID(),
        p.tenantId,
        input.caseId,
        p.id,
        found.rows[0].status,
        status,
        input.action,
        input.note ?? '',
      ],
    );
    return { status };
  });
}
export async function getOwnRisks(pool: ZhibanDatabasePool, p: AuthorizedPrincipal) {
  return withZhibanTenant(pool, p.tenantId, async (client) => ({
    risks: (
      await client.query(
        `SELECT s.course_id,c.name course_name,s.risk_type,s.level,s.score,s.evidence,s.created_at,s.expires_at,rc.id case_id FROM zhiban.risk_snapshots s JOIN zhiban.courses c ON c.id=s.course_id LEFT JOIN zhiban.risk_cases rc ON rc.snapshot_id=s.id WHERE s.learner_id=$1 AND s.status='active' AND s.expires_at>now() ORDER BY s.created_at DESC`,
        [p.id],
      )
    ).rows,
    preferences: (
      await client.query(`SELECT * FROM zhiban.risk_support_preferences WHERE learner_id=$1`, [
        p.id,
      ])
    ).rows,
    requests: (
      await client.query(
        `SELECT * FROM zhiban.risk_learner_requests WHERE learner_id=$1 ORDER BY created_at DESC`,
        [p.id],
      )
    ).rows,
  }));
}
export async function setRiskPreference(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  input: { courseId: string; enabled: boolean; pauseDays?: number },
) {
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    const enrolled = await client.query(
      `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE e.student_id=$1 AND o.course_id=$2 AND e.status='enrolled'`,
      [p.id, input.courseId],
    );
    if (!enrolled.rows[0]) throw new Error('Permission denied');
    await client.query(
      `INSERT INTO zhiban.risk_support_preferences(tenant_id,learner_id,course_id,proactive_support_enabled,paused_until) VALUES($1,$2,$3,$4,CASE WHEN $5>0 THEN now()+($5||' days')::interval END) ON CONFLICT(tenant_id,learner_id,course_id) DO UPDATE SET proactive_support_enabled=excluded.proactive_support_enabled,paused_until=excluded.paused_until,updated_at=now()`,
      [p.tenantId, p.id, input.courseId, input.enabled, input.pauseDays ?? 0],
    );
    return { saved: true };
  });
}
export function pseudonymizeRiskLearner(tenantId: string, learnerId: string) {
  return createHash('sha256').update(`${tenantId}:${learnerId}`).digest('hex').slice(0, 16);
}

export async function sweepRiskSla(pool: ZhibanDatabasePool, tenantId: string) {
  return withZhibanTenant(pool, tenantId, async (client) => {
    const rows = await client.query<{ id: string; course_id: string; status: string }>(
      `SELECT c.id,c.course_id,c.status FROM zhiban.risk_cases c LEFT JOIN zhiban.risk_course_controls x ON x.course_id=c.course_id WHERE c.status IN('new','acknowledged','in_progress') AND c.sla_due_at<now() AND COALESCE(x.sla_scan_enabled,true) FOR UPDATE SKIP LOCKED`,
    );
    for (const row of rows.rows) {
      await client.query(
        `UPDATE zhiban.risk_cases SET status='escalated',updated_at=now() WHERE id=$1`,
        [row.id],
      );
      await client.query(
        `INSERT INTO zhiban.risk_case_transitions(id,tenant_id,case_id,actor_type,from_status,to_status,action,note) VALUES($1,$2,$3,'system',$4,'escalated','sla.escalated','SLA超时后台自动升级')`,
        [randomUUID(), tenantId, row.id, row.status],
      );
      await client.query(
        `INSERT INTO zhiban.risk_notifications(id,tenant_id,course_id,case_id,notification_type,title,message) VALUES($1,$2,$3,$4,'sla_overdue','预警处置超时','风险案例已超过SLA并自动升级')`,
        [randomUUID(), tenantId, row.course_id, row.id],
      );
    }
    return { escalated: rows.rows.length };
  });
}
export async function updateRiskControl(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
  input: { mode: 'off' | 'shadow' | 'active'; automatic: boolean; emergencyStop: boolean },
) {
  if (!can(p, 'risk:handle', courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    await client.query(
      `INSERT INTO zhiban.risk_course_controls(tenant_id,course_id,mode,automatic_intervention_enabled,emergency_stop,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,course_id) DO UPDATE SET mode=excluded.mode,automatic_intervention_enabled=excluded.automatic_intervention_enabled,emergency_stop=excluded.emergency_stop,updated_by=excluded.updated_by,updated_at=now()`,
      [p.tenantId, courseId, input.mode, input.automatic, input.emergencyStop, p.id],
    );
    if (input.emergencyStop)
      await client.query(
        `UPDATE zhiban.intervention_briefs SET status='expired' WHERE course_id=$1 AND status IN('pending','accepted') AND policy_version='risk-v1'`,
        [courseId],
      );
    return { saved: true };
  });
}
export async function batchRiskCases(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
  input: { caseIds: string[]; action: 'assign' | 'resolve' | 'dismiss'; note: string },
) {
  const results = [];
  for (const caseId of input.caseIds)
    results.push(
      await actOnRiskCase(pool, p, courseId, { caseId, action: input.action, note: input.note }),
    );
  return { handled: results.length };
}
export async function createLearnerRiskRequest(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  input: {
    courseId: string;
    caseId?: string;
    type: 'help' | 'explanation' | 'correction';
    content: string;
  },
) {
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    const enrolled = await client.query(
      `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE e.student_id=$1 AND o.course_id=$2 AND e.status='enrolled'`,
      [p.id, input.courseId],
    );
    if (!enrolled.rows[0]) throw new Error('Permission denied');
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.risk_learner_requests(id,tenant_id,course_id,learner_id,case_id,request_type,content) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [id, p.tenantId, input.courseId, p.id, input.caseId ?? null, input.type, input.content],
    );
    return { id };
  });
}
export async function handleLearnerRiskRequest(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
  input: { requestId: string; status: 'handled' | 'rejected'; response: string },
) {
  if (!can(p, 'risk:handle', courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE zhiban.risk_learner_requests SET status=$3,response=$4,handled_by=$5,handled_at=now() WHERE id=$1 AND course_id=$2 AND status='pending' RETURNING id`,
      [input.requestId, courseId, input.status, input.response, p.id],
    );
    if (!result.rows[0]) throw new Error('Request not found');
    return { status: input.status };
  });
}
