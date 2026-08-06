import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanDatabaseClient } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { calculateLearnerProfile } from './calculator';
function canManage(principal: AuthorizedPrincipal, courseId: string) {
  return principal.grants.some(
    (g) =>
      g.permission === 'course:manage' &&
      ((g.scopeType === 'course' && g.scopeId === courseId) ||
        g.scopeType === 'tenant' ||
        g.scopeType === 'system'),
  );
}
async function syncSources(
  client: ZhibanDatabaseClient,
  tenantId: string,
  learnerId: string,
  courseId: string,
) {
  const preference = await client.query<{ collection_enabled: boolean; retention_days: number }>(
    `SELECT collection_enabled,retention_days FROM zhiban.learner_profile_preferences WHERE learner_id=$1 AND course_id=$2`,
    [learnerId, courseId],
  );
  if (preference.rows[0]?.collection_enabled === false) return;
  const retentionDays = preference.rows[0]?.retention_days ?? 730;
  const sources = await client.query<Record<string, unknown>>(
    `SELECT 'classroom' source_kind,e.id::text source_id,e.event_type,cc.id classroom_binding_id,NULL::uuid project_id,e.payload,e.occurred_at FROM zhiban.classroom_learning_events e JOIN zhiban.classroom_learning_sessions s ON s.id=e.session_id JOIN zhiban.course_classrooms cc ON cc.id=s.course_classroom_id WHERE s.student_id=$1 AND cc.course_id=$2 UNION ALL SELECT 'pbl',e.id::text,e.event_type,NULL,p.id,e.payload,e.occurred_at FROM zhiban.pbl_learning_events e JOIN zhiban.pbl_project_instances i ON i.id=e.instance_id JOIN zhiban.pbl_projects p ON p.id=i.project_id WHERE i.student_id=$1 AND p.course_id=$2 UNION ALL SELECT 'submission',s.id::text,'submission_created',NULL,p.id,jsonb_build_object('kind',s.kind,'attempt',s.attempt,'reviewStatus',s.review_status),s.submitted_at FROM zhiban.pbl_submissions s JOIN zhiban.pbl_project_instances i ON i.id=s.instance_id JOIN zhiban.pbl_projects p ON p.id=i.project_id WHERE i.student_id=$1 AND p.course_id=$2 UNION ALL SELECT 'evaluation',e.id::text,'evaluation_completed',NULL,p.id,jsonb_build_object('score',e.score,'kind',e.kind,'teacherReviewed',COALESCE(e.teacher_reviewed,false)),e.evaluated_at FROM zhiban.pbl_evaluations e JOIN zhiban.pbl_project_instances i ON i.id=e.instance_id JOIN zhiban.pbl_projects p ON p.id=i.project_id WHERE i.student_id=$1 AND p.course_id=$2`,
    [learnerId, courseId],
  );
  for (const row of sources.rows)
    await client.query(
      `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,project_id,classroom_binding_id,payload,occurred_at,expires_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$11::timestamptz+($12||' days')::interval)ON CONFLICT(tenant_id,source_kind,source_id)DO NOTHING`,
      [
        randomUUID(),
        tenantId,
        learnerId,
        courseId,
        row.source_kind,
        row.source_id,
        row.event_type,
        row.project_id ?? null,
        row.classroom_binding_id ?? null,
        JSON.stringify(row.payload ?? {}),
        row.occurred_at,
        retentionDays,
      ],
    );
}
export async function rebuildLearnerProfile(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  learnerId: string,
  courseId: string,
) {
  if (principal.id !== learnerId && !canManage(principal, courseId))
    throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const enrollment = await client.query(
      `SELECT 1 FROM zhiban.enrollments e
       JOIN zhiban.course_offerings o ON o.id=e.offering_id
       WHERE e.student_id=$1 AND o.course_id=$2 AND e.status='enrolled' LIMIT 1`,
      [learnerId, courseId],
    );
    if (!enrollment.rows[0]) throw new Error('Learner is not enrolled in this course');
    const collection = await client.query<{ collection_enabled: boolean }>(
      `SELECT collection_enabled FROM zhiban.learner_profile_preferences WHERE learner_id=$1 AND course_id=$2`,
      [learnerId, courseId],
    );
    if (collection.rows[0]?.collection_enabled === false) {
      const existing = await client.query<Record<string, unknown>>(
        `SELECT * FROM zhiban.learner_profiles WHERE learner_id=$1 AND course_id=$2`,
        [learnerId, courseId],
      );
      return { ...(existing.rows[0] ?? {}), learnerId, courseId, skipped: true };
    }
    await client.query(
      `DELETE FROM zhiban.learning_events WHERE learner_id=$1 AND course_id=$2 AND expires_at<=now()`,
      [learnerId, courseId],
    );
    await syncSources(client, principal.tenantId, learnerId, courseId);
    const [events, classrooms, pbl, scores] = await Promise.all([
      client.query<Record<string, unknown>>(
        `SELECT count(*)::int event_count,count(DISTINCT occurred_at::date)::int active_days,count(*)FILTER(WHERE event_type IN('pbl_activity','chat_message'))::int collaboration_count,count(*)FILTER(WHERE event_type='resource_opened')::int resource_count,count(*)FILTER(WHERE source_kind='submission')::int submission_count,min(occurred_at) computed_from,max(occurred_at) computed_to FROM zhiban.learning_events WHERE learner_id=$1 AND course_id=$2`,
        [learnerId, courseId],
      ),
      client.query<{ progress_percent: string }>(
        `SELECT progress_percent::text FROM zhiban.classroom_learning_sessions s JOIN zhiban.course_classrooms cc ON cc.id=s.course_classroom_id WHERE s.student_id=$1 AND cc.course_id=$2`,
        [learnerId, courseId],
      ),
      client.query<{ progress_percent: string }>(
        `SELECT i.progress_percent::text FROM zhiban.pbl_project_instances i JOIN zhiban.pbl_projects p ON p.id=i.project_id WHERE i.student_id=$1 AND p.course_id=$2`,
        [learnerId, courseId],
      ),
      client.query<{ score: string }>(
        `SELECT payload->>'score' score FROM zhiban.learning_events WHERE learner_id=$1 AND course_id=$2 AND payload ? 'score' AND (payload->>'score')~'^[0-9]+(\\.[0-9]+)?$'`,
        [learnerId, courseId],
      ),
    ]);
    const e = events.rows[0] ?? {};
    const calculated = calculateLearnerProfile({
      eventCount: Number(e.event_count ?? 0),
      activeDays: Number(e.active_days ?? 0),
      classroomProgress: classrooms.rows.map((r) => Number(r.progress_percent)),
      pblProgress: pbl.rows.map((r) => Number(r.progress_percent)),
      scores: scores.rows.map((r) => Number(r.score)),
      submissionCount: Number(e.submission_count ?? 0),
      collaborationCount: Number(e.collaboration_count ?? 0),
      resourceCount: Number(e.resource_count ?? 0),
    });
    const current = await client.query<{ id: string; profile_version: number }>(
      `SELECT id,profile_version FROM zhiban.learner_profiles WHERE learner_id=$1 AND course_id=$2 FOR UPDATE`,
      [learnerId, courseId],
    );
    const id = current.rows[0]?.id ?? randomUUID();
    const version = (current.rows[0]?.profile_version ?? 0) + 1;
    await client.query(
      `INSERT INTO zhiban.learner_profiles(id,tenant_id,learner_id,course_id,dimensions,evidence_summary,algorithm_version,profile_version,event_count,computed_from,computed_to)VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)ON CONFLICT(tenant_id,learner_id,course_id)DO UPDATE SET dimensions=EXCLUDED.dimensions,evidence_summary=EXCLUDED.evidence_summary,algorithm_version=EXCLUDED.algorithm_version,profile_version=EXCLUDED.profile_version,event_count=EXCLUDED.event_count,computed_from=EXCLUDED.computed_from,computed_to=EXCLUDED.computed_to,computed_at=now()`,
      [
        id,
        principal.tenantId,
        learnerId,
        courseId,
        JSON.stringify(calculated.dimensions),
        JSON.stringify(calculated.evidenceSummary),
        calculated.algorithmVersion,
        version,
        Number(e.event_count ?? 0),
        e.computed_from ?? null,
        e.computed_to ?? null,
      ],
    );
    await client.query(
      `INSERT INTO zhiban.learner_profile_snapshots(id,tenant_id,profile_id,profile_version,dimensions,evidence_summary,algorithm_version,event_count,computed_at)VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,now())`,
      [
        randomUUID(),
        principal.tenantId,
        id,
        version,
        JSON.stringify(calculated.dimensions),
        JSON.stringify(calculated.evidenceSummary),
        calculated.algorithmVersion,
        Number(e.event_count ?? 0),
      ],
    );
    return {
      ...calculated,
      id,
      learnerId,
      courseId,
      profileVersion: version,
      eventCount: Number(e.event_count ?? 0),
    };
  });
}
export async function listOwnProfiles(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal) {
  return withZhibanTenant(
    pool,
    principal.tenantId,
    async (client) =>
      (
        await client.query<Record<string, unknown>>(
          `SELECT p.id,c.id course_id,c.code course_code,c.name course_name,p.dimensions,p.evidence_summary,p.algorithm_version,p.profile_version,COALESCE(p.event_count,0)event_count,p.computed_at FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id JOIN zhiban.courses c ON c.id=o.course_id LEFT JOIN zhiban.learner_profiles p ON p.course_id=c.id AND p.learner_id=e.student_id WHERE e.student_id=$1 AND e.status='enrolled' GROUP BY c.id,p.id ORDER BY c.name`,
          [principal.id],
        )
      ).rows,
  );
}
export async function listCourseProfiles(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  if (!canManage(principal, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(
    pool,
    principal.tenantId,
    async (client) =>
      (
        await client.query<Record<string, unknown>>(
          `SELECT a.id learner_id,a.display_name,a.login_name,p.dimensions,p.evidence_summary,p.algorithm_version,p.profile_version,p.event_count,p.computed_at FROM zhiban.course_offerings o JOIN zhiban.enrollments e ON e.offering_id=o.id AND e.status='enrolled' JOIN zhiban.accounts a ON a.id=e.student_id LEFT JOIN zhiban.learner_profiles p ON p.learner_id=a.id AND p.course_id=o.course_id WHERE o.course_id=$1 GROUP BY a.id,p.id ORDER BY a.display_name`,
          [courseId],
        )
      ).rows,
  );
}
export async function rebuildCourseProfiles(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  if (!canManage(principal, courseId)) throw new Error('Permission denied');
  const learners = await withZhibanTenant(
    pool,
    principal.tenantId,
    async (client) =>
      (
        await client.query<{ id: string }>(
          `SELECT DISTINCT e.student_id id FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE o.course_id=$1 AND e.status='enrolled'`,
          [courseId],
        )
      ).rows,
  );
  for (const learner of learners)
    await rebuildLearnerProfile(pool, principal, learner.id, courseId);
  return { rebuilt: learners.length };
}
