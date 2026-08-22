import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';

type Row = Record<string, unknown>;
export type OpenMaicActivityRule = {
  completionEvent: 'scene_viewed' | 'quiz_completed' | 'interaction' | 'minimum_score';
  minimumScore: number;
  maxAttempts: number;
};
export type OpenMaicActivityEvent = {
  eventId: string;
  eventType: string;
  sceneId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

function ruleOf(value: unknown): OpenMaicActivityRule {
  const raw = (((value ?? {}) as Row).openmaicInteraction ?? {}) as Row,
    event = String(raw.completionEvent ?? 'scene_viewed');
  return {
    completionEvent: ['quiz_completed', 'interaction', 'minimum_score'].includes(event)
      ? (event as OpenMaicActivityRule['completionEvent'])
      : 'scene_viewed',
    minimumScore: Number(raw.minimumScore ?? 0),
    maxAttempts: Number(raw.maxAttempts ?? 0),
  };
}

export async function getOpenMaicActivityLaunch(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  activityId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Row>(
      `SELECT a.id,a.title,a.description,a.completion_rule,d.document_id,d.revision,COALESCE(s.attempt_count,0)::int attempt_count,COALESCE(s.status,'not_started') session_status FROM zhiban.course_activities a JOIN zhiban.openmaic_activity_documents d ON d.activity_id=a.id LEFT JOIN zhiban.openmaic_activity_sessions s ON s.activity_id=a.id AND s.student_id=$3 WHERE a.id=$1 AND a.course_id=$2 AND a.activity_type IN('openmaic_slide','openmaic_quiz','openmaic_interactive','openmaic_pbl','openmaic_3d') AND a.status='published' AND d.status='published' AND EXISTS(SELECT 1 FROM zhiban.course_offerings o JOIN zhiban.enrollments e ON e.offering_id=o.id WHERE o.course_id=a.course_id AND e.student_id=$3 AND e.status='enrolled')`,
      [activityId, courseId, principal.id],
    );
    const row = result.rows[0];
    if (!row) throw new Error('OpenMAIC 活动不可用或尚未发布');
    return {
      activityId,
      courseId,
      documentId: String(row.document_id),
      title: String(row.title),
      description: String(row.description ?? ''),
      revision: Number(row.revision),
      rule: ruleOf(row.completion_rule),
      attemptCount: Number(row.attempt_count),
      sessionStatus: String(row.session_status),
    };
  });
}

export async function startOpenMaicActivitySession(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  activityId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const activity = await client.query<Row>(
      `SELECT a.completion_rule FROM zhiban.course_activities a JOIN zhiban.openmaic_activity_documents d ON d.activity_id=a.id WHERE a.id=$1 AND a.course_id=$2 AND a.status='published' AND d.status='published' AND EXISTS(SELECT 1 FROM zhiban.course_offerings o JOIN zhiban.enrollments e ON e.offering_id=o.id WHERE o.course_id=a.course_id AND e.student_id=$3 AND e.status='enrolled')`,
      [activityId, courseId, principal.id],
    );
    if (!activity.rows[0]) throw new Error('活动不可用');
    const rule = ruleOf(activity.rows[0].completion_rule);
    const previous = await client.query<{ attempt_count: number; status: string }>(
      `SELECT attempt_count,status FROM zhiban.openmaic_activity_sessions WHERE activity_id=$1 AND student_id=$2`,
      [activityId, principal.id],
    );
    if (previous.rows[0]?.status === 'completed')
      return { attemptCount: previous.rows[0].attempt_count, status: 'completed' };
    if (rule.maxAttempts > 0 && Number(previous.rows[0]?.attempt_count ?? 0) >= rule.maxAttempts)
      throw new Error('已达到最多尝试次数');
    const result = await client.query<Row>(
      `INSERT INTO zhiban.openmaic_activity_sessions(id,tenant_id,course_id,activity_id,student_id,attempt_count) VALUES($1,$2,$3,$4,$5,1) ON CONFLICT(tenant_id,activity_id,student_id) DO UPDATE SET attempt_count=zhiban.openmaic_activity_sessions.attempt_count+1,last_activity_at=now() RETURNING id,attempt_count,status,current_scene_id,state`,
      [randomUUID(), principal.tenantId, courseId, activityId, principal.id],
    );
    return result.rows[0];
  });
}

export async function recordOpenMaicActivityEvent(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  activityId: string,
  event: OpenMaicActivityEvent,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const current = await client.query<Row>(
      `SELECT s.id,s.status,a.completion_rule FROM zhiban.openmaic_activity_sessions s JOIN zhiban.course_activities a ON a.id=s.activity_id WHERE s.activity_id=$1 AND s.course_id=$2 AND s.student_id=$3`,
      [activityId, courseId, principal.id],
    );
    const row = current.rows[0];
    if (!row) throw new Error('请先启动活动会话');
    const inserted = await client.query<Row>(
      `INSERT INTO zhiban.openmaic_activity_events(id,tenant_id,session_id,event_id,event_type,scene_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(tenant_id,event_id) DO NOTHING RETURNING id`,
      [
        randomUUID(),
        principal.tenantId,
        row.id,
        event.eventId,
        event.eventType,
        event.sceneId ?? null,
        JSON.stringify(event.payload),
        event.occurredAt,
      ],
    );
    if (!inserted.rows[0]) return { accepted: false, completed: row.status === 'completed' };
    const rule = ruleOf(row.completion_rule),
      score = Number(event.payload.score ?? 0);
    const completed =
      row.status === 'completed' ||
      (rule.completionEvent === 'scene_viewed' && event.eventType === 'scene_viewed') ||
      (rule.completionEvent === 'quiz_completed' && event.eventType === 'quiz_completed') ||
      (rule.completionEvent === 'interaction' &&
        ['simulation_interacted', 'pbl_activity', 'slide_action'].includes(event.eventType)) ||
      (rule.completionEvent === 'minimum_score' && score >= rule.minimumScore);
    await client.query(
      `UPDATE zhiban.openmaic_activity_sessions SET current_scene_id=COALESCE($2,current_scene_id),state=state||$3::jsonb,last_activity_at=now(),status=CASE WHEN $4 THEN 'completed' ELSE status END,completed_at=CASE WHEN $4 THEN COALESCE(completed_at,now()) ELSE completed_at END WHERE id=$1`,
      [
        row.id,
        event.sceneId ?? null,
        JSON.stringify({ lastEventType: event.eventType, lastPayload: event.payload }),
        completed,
      ],
    );
    if (completed)
      await client.query(
        `INSERT INTO zhiban.student_activity_progress(id,tenant_id,course_id,activity_id,student_id,status,progress_percent,score,started_at,completed_at) VALUES($1,$2,$3,$4,$5,'completed',100,$6,now(),now()) ON CONFLICT(tenant_id,activity_id,student_id) DO UPDATE SET status='completed',progress_percent=100,score=GREATEST(COALESCE(zhiban.student_activity_progress.score,0),EXCLUDED.score),started_at=COALESCE(zhiban.student_activity_progress.started_at,now()),completed_at=COALESCE(zhiban.student_activity_progress.completed_at,now()),updated_at=now()`,
        [randomUUID(), principal.tenantId, courseId, activityId, principal.id, score],
      );
    return { accepted: true, completed };
  });
}
