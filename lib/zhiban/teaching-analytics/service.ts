import { randomUUID } from 'node:crypto';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';

type Row = Record<string, unknown>;

async function requireCourse(
  client: { query: ZhibanDatabasePool['query'] },
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  if (!principal.permissions.includes('course:manage')) throw new Error('Permission denied');
  const broad = principal.grants.some(
    (g) => g.permission === 'course:manage' && ['tenant', 'system'].includes(g.scopeType),
  );
  const result = await client.query(
    `SELECT 1 FROM zhiban.courses c WHERE c.id=$1 AND (c.owner_teacher_id=$2 OR $3::boolean OR EXISTS(SELECT 1 FROM zhiban.course_offerings o JOIN zhiban.teaching_assignments ta ON ta.offering_id=o.id AND ta.ended_at IS NULL WHERE o.course_id=c.id AND ta.teacher_id=$2))`,
    [courseId, principal.id, broad],
  );
  if (!result.rows[0]) throw new Error('Permission denied');
}

export async function getTeachingAnalytics(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireCourse(client, principal, courseId);
    const [
      summary,
      activities,
      trend,
      effectiveness,
      actions,
      snapshots,
      learners,
      modules,
      activityTypes,
    ] = await Promise.all([
      client.query<Row>(
        `SELECT
        (SELECT count(DISTINCT e.student_id)::int FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE o.course_id=$1 AND e.status='enrolled') enrolled_students,
        (SELECT count(DISTINCT learner_id)::int FROM zhiban.learning_events WHERE course_id=$1 AND occurred_at>=now()-interval '7 days') active_students_7d,
        (SELECT count(*)::int FROM zhiban.learning_events WHERE course_id=$1 AND occurred_at>=now()-interval '30 days') events_30d,
        (SELECT COALESCE(round(100.0*count(*) FILTER(WHERE status='completed')/NULLIF(count(*),0),1),0) FROM zhiban.student_activity_progress WHERE course_id=$1) completion_rate,
        (SELECT COALESCE(round(avg(total_score),1),0) FROM zhiban.course_final_grades WHERE course_id=$1 AND status='published') average_score,
        (SELECT count(DISTINCT learner_id)::int FROM zhiban.risk_cases WHERE course_id=$1 AND status IN('new','acknowledged','in_progress','escalated')) at_risk_students`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT a.id,a.title,a.activity_type,m.title module_title,ch.title chapter_title,a.position,
        count(DISTINCT p.student_id)::int started_count,count(DISTINCT p.student_id) FILTER(WHERE p.status='completed')::int completed_count,
        COALESCE(round(100.0*count(DISTINCT p.student_id) FILTER(WHERE p.status='completed')/NULLIF((SELECT count(DISTINCT e.student_id) FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE o.course_id=$1 AND e.status='enrolled'),0),1),0) completion_rate
        FROM zhiban.course_activities a JOIN zhiban.course_chapters ch ON ch.id=a.chapter_id JOIN zhiban.course_modules m ON m.id=ch.module_id LEFT JOIN zhiban.student_activity_progress p ON p.activity_id=a.id WHERE a.course_id=$1 AND a.status='published' GROUP BY a.id,m.title,m.position,ch.title,ch.position ORDER BY m.position,ch.position,a.position`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT day::date,COALESCE(count(e.id),0)::int event_count,count(DISTINCT e.learner_id)::int active_students FROM generate_series(current_date-13,current_date,interval '1 day') day LEFT JOIN zhiban.learning_events e ON e.course_id=$1 AND e.occurred_at>=day AND e.occurred_at<day+interval '1 day' GROUP BY day ORDER BY day`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT count(*)::int measured,count(*) FILTER(WHERE effective)::int effective_count,COALESCE(round(100.0*count(*) FILTER(WHERE effective)/NULLIF(count(*),0),1),0) effective_rate,COALESCE(round(avg(before_score-after_score),1),0) average_risk_reduction FROM zhiban.intervention_effectiveness WHERE course_id=$1`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT * FROM zhiban.teaching_improvement_actions WHERE course_id=$1 ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,created_at DESC`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT id,analysis_version,metrics,generated_at FROM zhiban.teaching_analysis_snapshots WHERE course_id=$1 ORDER BY generated_at DESC LIMIT 12`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT a.id learner_id,COALESCE(sp.real_name,a.display_name) learner_name,COALESCE(sp.student_no,a.login_name) student_no,
        count(DISTINCT le.id)::int events_30d,count(DISTINCT p.activity_id) FILTER(WHERE p.status='completed')::int completed_activities,
        COALESCE(max(f.total_score),0) total_score,count(DISTINCT rc.id) FILTER(WHERE rc.status IN('new','acknowledged','in_progress','escalated'))::int active_risks,
        CASE WHEN count(DISTINCT rc.id) FILTER(WHERE rc.status IN('new','acknowledged','in_progress','escalated'))>0 THEN 'needs_support'
             WHEN count(DISTINCT le.id)=0 THEN 'inactive' WHEN COALESCE(max(f.total_score),0)>=80 THEN 'high_achiever' ELSE 'steady' END segment
        FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id JOIN zhiban.accounts a ON a.id=e.student_id LEFT JOIN zhiban.student_profiles sp ON sp.account_id=a.id
        LEFT JOIN zhiban.learning_events le ON le.course_id=o.course_id AND le.learner_id=a.id AND le.occurred_at>=now()-interval '30 days'
        LEFT JOIN zhiban.student_activity_progress p ON p.course_id=o.course_id AND p.student_id=a.id
        LEFT JOIN zhiban.course_final_grades f ON f.course_id=o.course_id AND f.student_id=a.id AND f.status='published'
        LEFT JOIN zhiban.risk_cases rc ON rc.course_id=o.course_id AND rc.learner_id=a.id
        WHERE o.course_id=$1 AND e.status='enrolled' GROUP BY a.id,sp.real_name,sp.student_no ORDER BY segment,learner_name`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT m.id,m.title,count(DISTINCT a.id)::int activity_count,count(DISTINCT p.student_id) FILTER(WHERE p.status='completed')::int completions,
        COALESCE(round(100.0*count(DISTINCT (p.student_id,p.activity_id)) FILTER(WHERE p.status='completed')/NULLIF(count(DISTINCT a.id)*(SELECT count(DISTINCT e.student_id) FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE o.course_id=$1 AND e.status='enrolled'),0),1),0) completion_rate
        FROM zhiban.course_modules m LEFT JOIN zhiban.course_chapters ch ON ch.module_id=m.id LEFT JOIN zhiban.course_activities a ON a.chapter_id=ch.id AND a.status='published' LEFT JOIN zhiban.student_activity_progress p ON p.activity_id=a.id WHERE m.course_id=$1 GROUP BY m.id ORDER BY m.position`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT a.activity_type,count(DISTINCT a.id)::int activity_count,count(DISTINCT p.student_id)::int started_students,count(DISTINCT p.student_id) FILTER(WHERE p.status='completed')::int completed_students,COALESCE(round(avg(p.score),1),0) average_score FROM zhiban.course_activities a LEFT JOIN zhiban.student_activity_progress p ON p.activity_id=a.id WHERE a.course_id=$1 AND a.status='published' GROUP BY a.activity_type ORDER BY a.activity_type`,
        [courseId],
      ),
    ]);
    const metrics = summary.rows[0] ?? {};
    const snapshotRows = snapshots.rows;
    const current = { summary: metrics };
    const previous = (snapshotRows[0]?.metrics ?? null) as Row | null;
    return {
      summary: metrics,
      activities: activities.rows,
      trend: trend.rows,
      effectiveness: effectiveness.rows[0] ?? {},
      recommendations: recommend(metrics, activities.rows),
      actions: actions.rows.map(withAttainment),
      snapshots: snapshotRows,
      learners: learners.rows,
      modules: modules.rows,
      activityTypes: activityTypes.rows,
      comparison: previous ? compare((previous.summary ?? {}) as Row, current.summary) : null,
      dataQuality: {
        sampleSize: Number(metrics.enrolled_students ?? 0),
        updatedAt: new Date().toISOString(),
        warnings: [
          Number(metrics.enrolled_students ?? 0) < 10 ? '样本少于10人，比例指标仅供参考' : '',
          Number(metrics.events_30d ?? 0) === 0 ? '近30日无学习事件，请检查事件采集' : '',
        ].filter(Boolean),
      },
    };
  });
}

function compare(before: Row, after: Row) {
  return ['active_students_7d', 'completion_rate', 'average_score', 'at_risk_students'].map(
    (metric) => ({
      metric,
      before: Number(before[metric] ?? 0),
      after: Number(after[metric] ?? 0),
      change: Number(after[metric] ?? 0) - Number(before[metric] ?? 0),
    }),
  );
}
function withAttainment(action: Row) {
  const target = action.target_value,
    result = action.result_value;
  if (target == null || result == null) return { ...action, attainment: 'not_measured' };
  const lower = String(action.target_metric).includes('risk'),
    achieved = lower ? Number(result) <= Number(target) : Number(result) >= Number(target);
  return { ...action, attainment: achieved ? 'achieved' : 'not_achieved' };
}

function recommend(summary: Row, activities: Row[]) {
  const items: Array<{ level: string; title: string; evidence: string; actionType: string }> = [];
  const enrolled = Number(summary.enrolled_students ?? 0),
    active = Number(summary.active_students_7d ?? 0);
  if (enrolled && active / enrolled < 0.6)
    items.push({
      level: 'high',
      title: '提升近 7 日学习活跃度',
      evidence: `仅 ${active}/${enrolled} 名学生近7日有学习事件`,
      actionType: 'intervention',
    });
  if (Number(summary.completion_rate) < 60)
    items.push({
      level: 'high',
      title: '优化低完成率活动与开放节奏',
      evidence: `课程活动完成率为 ${summary.completion_rate}%`,
      actionType: 'activity',
    });
  const bottleneck = activities.filter((a) => Number(a.completion_rate) < 50).slice(0, 3);
  if (bottleneck.length)
    items.push({
      level: 'medium',
      title: '处理活动完成瓶颈',
      evidence: bottleneck.map((a) => `${a.title} ${a.completion_rate}%`).join('；'),
      actionType: 'content',
    });
  if (Number(summary.at_risk_students) > 0)
    items.push({
      level: 'high',
      title: '复核风险学生支持方案',
      evidence: `当前 ${summary.at_risk_students} 名学生存在未关闭风险`,
      actionType: 'intervention',
    });
  if (!items.length)
    items.push({
      level: 'low',
      title: '保持当前教学设计并持续观察',
      evidence: '关键指标暂未发现明显异常',
      actionType: 'other',
    });
  return items;
}

export async function createImprovementAction(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    title: string;
    evidence?: string;
    hypothesis?: string;
    actionType: string;
    priority: string;
    targetMetric?: string;
    targetValue?: number;
    baselineValue?: number;
    dueAt?: string;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireCourse(client, principal, courseId);
    const id = randomUUID();
    const r = await client.query(
      `INSERT INTO zhiban.teaching_improvement_actions(id,tenant_id,course_id,title,evidence,hypothesis,action_type,priority,target_metric,target_value,baseline_value,due_at,owner_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::numeric,CASE $9::text WHEN 'completion_rate' THEN (SELECT COALESCE(100.0*count(*) FILTER(WHERE status='completed')/NULLIF(count(*),0),0) FROM zhiban.student_activity_progress WHERE course_id=$3) WHEN 'average_score' THEN (SELECT COALESCE(avg(total_score),0) FROM zhiban.course_final_grades WHERE course_id=$3 AND status='published') WHEN 'active_students_7d' THEN (SELECT count(DISTINCT learner_id) FROM zhiban.learning_events WHERE course_id=$3 AND occurred_at>=now()-interval '7 days') WHEN 'at_risk_students' THEN (SELECT count(DISTINCT learner_id) FROM zhiban.risk_cases WHERE course_id=$3 AND status IN('new','acknowledged','in_progress','escalated')) ELSE NULL END),$12,$13,$13) RETURNING *`,
      [
        id,
        principal.tenantId,
        courseId,
        input.title,
        input.evidence ?? '',
        input.hypothesis ?? '',
        input.actionType,
        input.priority,
        input.targetMetric ?? '',
        input.targetValue ?? null,
        input.baselineValue ?? null,
        input.dueAt ?? null,
        principal.id,
      ],
    );
    return r.rows[0];
  });
}

export async function updateImprovementAction(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  id: string,
  input: { status: string; resultValue?: number },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireCourse(client, principal, courseId);
    const r = await client.query(
      `UPDATE zhiban.teaching_improvement_actions a SET status=$3::varchar,result_value=CASE WHEN $3::text='completed' THEN COALESCE($4::numeric,CASE a.target_metric WHEN 'completion_rate' THEN (SELECT COALESCE(100.0*count(*) FILTER(WHERE status='completed')/NULLIF(count(*),0),0) FROM zhiban.student_activity_progress WHERE course_id=$2) WHEN 'average_score' THEN (SELECT COALESCE(avg(total_score),0) FROM zhiban.course_final_grades WHERE course_id=$2 AND status='published') WHEN 'active_students_7d' THEN (SELECT count(DISTINCT learner_id) FROM zhiban.learning_events WHERE course_id=$2 AND occurred_at>=now()-interval '7 days') WHEN 'at_risk_students' THEN (SELECT count(DISTINCT learner_id) FROM zhiban.risk_cases WHERE course_id=$2 AND status IN('new','acknowledged','in_progress','escalated')) ELSE a.result_value END) ELSE a.result_value END,completed_at=CASE WHEN $3::text='completed' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND course_id=$2 RETURNING *`,
      [id, courseId, input.status, input.resultValue ?? null],
    );
    if (!r.rows[0]) throw new Error('Improvement action not found');
    return r.rows[0];
  });
}

export async function createAnalysisSnapshot(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  const dashboard = await getTeachingAnalytics(pool, principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const r = await client.query(
      `INSERT INTO zhiban.teaching_analysis_snapshots(id,tenant_id,course_id,metrics,generated_by) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id,analysis_version,generated_at`,
      [
        randomUUID(),
        principal.tenantId,
        courseId,
        JSON.stringify({
          summary: dashboard.summary,
          activities: dashboard.activities,
          effectiveness: dashboard.effectiveness,
        }),
        principal.id,
      ],
    );
    return r.rows[0];
  });
}
