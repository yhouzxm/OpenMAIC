import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { ClassroomBindingInput, ClassroomEventType, ZhibanCourseClassroom } from './types';
import type { SceneRuleSetting } from '@/lib/zhiban/teacher-courses';
import { evaluateSceneAccess } from './scene-access';

function canManageCourse(principal: AuthorizedPrincipal, courseId: string) {
  return principal.grants.some(
    (grant) =>
      grant.permission === 'course:manage' &&
      ((grant.scopeType === 'course' && grant.scopeId === courseId) ||
        grant.scopeType === 'tenant' ||
        grant.scopeType === 'system'),
  );
}

export async function listManagedCourseClassrooms(
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
        await client.query<Record<string, unknown>>(
          `SELECT id,classroom_id,title,description,display_order,opens_at,closes_at,status FROM zhiban.course_classrooms WHERE course_id=$1 ORDER BY (status='archived'),display_order,title`,
          [courseId],
        )
      ).rows,
  );
}

export async function createCourseClassroom(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: ClassroomBindingInput,
) {
  if (!canManageCourse(principal, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const course = await client.query(
      `SELECT id FROM zhiban.courses WHERE id=$1 AND tenant_id=$2`,
      [courseId, principal.tenantId],
    );
    if (!course.rows[0]) throw new Error('Course not found');
    const id = randomUUID();
    const result = await client.query<{ id: string }>(
      `INSERT INTO zhiban.course_classrooms (id,tenant_id,course_id,classroom_id,title,description,display_order,opens_at,closes_at,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
      ON CONFLICT (tenant_id,course_id,classroom_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,display_order=EXCLUDED.display_order,opens_at=EXCLUDED.opens_at,closes_at=EXCLUDED.closes_at,status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING id`,
      [
        id,
        principal.tenantId,
        courseId,
        input.classroomId,
        input.title,
        input.description,
        input.displayOrder,
        input.opensAt,
        input.closesAt,
        input.status,
        principal.id,
      ],
    );
    return { id: result.rows[0].id };
  });
}

export async function updateCourseClassroom(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  bindingId: string,
  input: ClassroomBindingInput,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const binding = await client.query<{ course_id: string }>(
      `SELECT course_id FROM zhiban.course_classrooms WHERE id=$1`,
      [bindingId],
    );
    if (!binding.rows[0] || !canManageCourse(principal, binding.rows[0].course_id))
      throw new Error('Permission denied');
    await client.query(
      `UPDATE zhiban.course_classrooms SET classroom_id=$3,title=$4,description=$5,display_order=$6,opens_at=$7,closes_at=$8,status=$9,updated_by=$10,updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [
        bindingId,
        principal.tenantId,
        input.classroomId,
        input.title,
        input.description,
        input.displayOrder,
        input.opensAt,
        input.closesAt,
        input.status,
        principal.id,
      ],
    );
    return { id: bindingId };
  });
}

export async function unbindCourseClassroom(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  bindingId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const binding = await client.query<{ course_id: string; classroom_id: string }>(
      `SELECT course_id,classroom_id FROM zhiban.course_classrooms WHERE id=$1`,
      [bindingId],
    );
    if (!binding.rows[0] || !canManageCourse(principal, binding.rows[0].course_id))
      throw new Error('Permission denied');
    await client.query(
      `UPDATE zhiban.course_classrooms SET status='archived',updated_by=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [bindingId, principal.tenantId, principal.id],
    );
    await client.query(
      `INSERT INTO zhiban.audit_log(tenant_id,actor_type,actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,'account',$2,'classroom.unbound','course_classroom',$3,$4::jsonb)`,
      [
        principal.tenantId,
        principal.id,
        bindingId,
        JSON.stringify({ classroomId: binding.rows[0].classroom_id }),
      ],
    );
    return { id: bindingId, unbound: true };
  });
}

export async function deleteCourseClassroom(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  bindingId: string,
  deletePersisted: (classroomId: string) => Promise<unknown>,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const binding = await client.query<{ course_id: string; classroom_id: string }>(
      `SELECT course_id,classroom_id FROM zhiban.course_classrooms WHERE id=$1 FOR UPDATE`,
      [bindingId],
    );
    if (!binding.rows[0] || !canManageCourse(principal, binding.rows[0].course_id))
      throw new Error('Permission denied');
    const shared = await client.query(
      `SELECT 1 FROM zhiban.course_classrooms WHERE classroom_id=$1 AND id<>$2 AND status<>'archived' LIMIT 1`,
      [binding.rows[0].classroom_id, bindingId],
    );
    if (shared.rows[0]) throw new Error('该 OpenMAIC 课堂仍绑定其他课程，请先解除其他绑定');
    await deletePersisted(binding.rows[0].classroom_id);
    await client.query(`DELETE FROM zhiban.course_classrooms WHERE id=$1 AND tenant_id=$2`, [
      bindingId,
      principal.tenantId,
    ]);
    await client.query(
      `INSERT INTO zhiban.audit_log(tenant_id,actor_type,actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,'account',$2,'classroom.deleted','course_classroom',$3,$4::jsonb)`,
      [
        principal.tenantId,
        principal.id,
        bindingId,
        JSON.stringify({ classroomId: binding.rows[0].classroom_id }),
      ],
    );
    return { id: bindingId, deleted: true };
  });
}

export async function listStudentClassrooms(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
): Promise<ZhibanCourseClassroom[]> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT cc.id,cc.course_id,c.code AS course_code,c.name AS course_name,cc.classroom_id,cc.title,cc.description,cc.display_order,cc.opens_at,cc.closes_at,cc.status,s.id AS session_id,COALESCE(s.progress_percent,0) AS progress_percent,s.current_scene_id,s.last_activity_at,
              COALESCE(MAX(EXTRACT(YEAR FROM term.starts_on)::text),'') AS academic_year,
              COALESCE(MAX(term.name),'') AS term_name,
              COALESCE(MAX(o.status),'') AS offering_status,
              COALESCE(MAX(tp.department),'') AS department,
              COALESCE(MAX(sp.learning_center),'') AS learning_center,
              COALESCE(BOOL_OR(settings.pbl_enabled),true) AS pbl_enabled
      FROM zhiban.course_classrooms cc JOIN zhiban.courses c ON c.id=cc.course_id
      JOIN zhiban.course_offerings o ON o.course_id=cc.course_id JOIN zhiban.enrollments e ON e.offering_id=o.id AND e.student_id=$2 AND e.status='enrolled'
      JOIN zhiban.academic_terms term ON term.id=o.term_id
      LEFT JOIN zhiban.student_profiles sp ON sp.account_id=e.student_id
      LEFT JOIN zhiban.teacher_profiles tp ON tp.account_id=c.owner_teacher_id
      LEFT JOIN zhiban.course_settings settings ON settings.course_id=c.id
      LEFT JOIN zhiban.classroom_learning_sessions s ON s.course_classroom_id=cc.id AND s.student_id=$2
      WHERE cc.tenant_id=$1 AND cc.status='published' AND (cc.opens_at IS NULL OR cc.opens_at<=now()) AND (cc.closes_at IS NULL OR cc.closes_at>=now())
      GROUP BY cc.id,c.id,s.id ORDER BY c.name,cc.display_order,cc.title`,
      [principal.tenantId, principal.id],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      courseId: row.course_id as string,
      courseCode: row.course_code as string,
      courseName: row.course_name as string,
      academicYear: row.academic_year as string,
      termName: row.term_name as string,
      offeringStatus: row.offering_status as string,
      department: row.department as string,
      learningCenter: row.learning_center as string,
      pblEnabled: Boolean(row.pbl_enabled),
      classroomId: row.classroom_id as string,
      title: row.title as string,
      description: row.description as string,
      displayOrder: Number(row.display_order),
      opensAt: row.opens_at ? new Date(row.opens_at as string).toISOString() : null,
      closesAt: row.closes_at ? new Date(row.closes_at as string).toISOString() : null,
      status: row.status as ZhibanCourseClassroom['status'],
      sessionId: row.session_id as string | null,
      progressPercent: Number(row.progress_percent),
      currentSceneId: row.current_scene_id as string | null,
      lastActivityAt: row.last_activity_at
        ? new Date(row.last_activity_at as string).toISOString()
        : null,
    }));
  });
}

async function requireStudentBinding(
  client: { query: ZhibanDatabasePool['query'] },
  principal: AuthorizedPrincipal,
  bindingId: string,
) {
  const result = await client.query<{ id: string }>(
    `SELECT cc.id FROM zhiban.course_classrooms cc JOIN zhiban.course_offerings o ON o.course_id=cc.course_id JOIN zhiban.enrollments e ON e.offering_id=o.id WHERE cc.id=$1 AND cc.status='published' AND e.student_id=$2 AND e.status='enrolled' AND (cc.opens_at IS NULL OR cc.opens_at<=now()) AND (cc.closes_at IS NULL OR cc.closes_at>=now())`,
    [bindingId, principal.id],
  );
  if (!result.rows[0]) throw new Error('Classroom is unavailable');
}

export async function startClassroomSession(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  bindingId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireStudentBinding(client, principal, bindingId);
    const existing = await client.query<{
      id: string;
      current_scene_id: string | null;
      visited_scene_ids: string[];
      progress_percent: string;
    }>(
      `SELECT id,current_scene_id,visited_scene_ids,progress_percent::text FROM zhiban.classroom_learning_sessions WHERE course_classroom_id=$1 AND student_id=$2`,
      [bindingId, principal.id],
    );
    const id = existing.rows[0]?.id ?? randomUUID();
    if (!existing.rows[0])
      await client.query(
        `INSERT INTO zhiban.classroom_learning_sessions (id,tenant_id,course_classroom_id,student_id) VALUES ($1,$2,$3,$4)`,
        [id, principal.tenantId, bindingId, principal.id],
      );
    const state = existing.rows[0] ?? {
      id,
      current_scene_id: null,
      visited_scene_ids: [],
      progress_percent: '0',
    };
    const settings = await client.query<{ scene_rules: SceneRuleSetting[] }>(
      `SELECT COALESCE(cs.scene_rules,'[]'::jsonb) AS scene_rules FROM zhiban.course_classrooms cc LEFT JOIN zhiban.course_settings cs ON cs.course_id=cc.course_id WHERE cc.id=$1`,
      [bindingId],
    );
    const score = await client.query<{ max_score: string | null }>(
      `SELECT max((payload->>'score')::numeric)::text AS max_score FROM zhiban.classroom_learning_events WHERE session_id=$1 AND payload ? 'score' AND (payload->>'score') ~ '^[0-9]+(\\.[0-9]+)?$'`,
      [id],
    );
    return {
      sessionId: id,
      currentSceneId: state.current_scene_id,
      visitedSceneIds: state.visited_scene_ids,
      progressPercent: Number(state.progress_percent),
      sceneRules: settings.rows[0]?.scene_rules ?? [],
      maxScore: score.rows[0]?.max_score === null ? null : Number(score.rows[0]?.max_score),
    };
  });
}

export async function recordClassroomEvent(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  bindingId: string,
  input: {
    eventId: string;
    eventType: ClassroomEventType;
    sceneId?: string;
    progressPercent: number;
    payload: Record<string, unknown>;
    occurredAt: string;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireStudentBinding(client, principal, bindingId);
    const session = await client.query<{
      id: string;
      visited_scene_ids: string[];
      course_id: string;
    }>(
      `SELECT s.id,s.visited_scene_ids,cc.course_id FROM zhiban.classroom_learning_sessions s JOIN zhiban.course_classrooms cc ON cc.id=s.course_classroom_id WHERE s.course_classroom_id=$1 AND s.student_id=$2`,
      [bindingId, principal.id],
    );
    if (!session.rows[0]) throw new Error('Classroom session has not started');
    if (input.sceneId && input.eventType !== 'classroom_opened') {
      const access = await client.query<{
        scene_rules: SceneRuleSetting[];
        max_score: string | null;
      }>(
        `SELECT COALESCE(cs.scene_rules,'[]'::jsonb) AS scene_rules,(SELECT max((e.payload->>'score')::numeric)::text FROM zhiban.classroom_learning_events e WHERE e.session_id=$2 AND e.payload ? 'score' AND (e.payload->>'score') ~ '^[0-9]+(\\.[0-9]+)?$') AS max_score FROM zhiban.course_classrooms cc LEFT JOIN zhiban.course_settings cs ON cs.course_id=cc.course_id WHERE cc.id=$1`,
        [bindingId, session.rows[0].id],
      );
      const decision = evaluateSceneAccess(access.rows[0]?.scene_rules ?? [], input.sceneId, {
        visitedSceneIds: session.rows[0].visited_scene_ids ?? [],
        maxScore: access.rows[0]?.max_score === null ? null : Number(access.rows[0]?.max_score),
        now: new Date(),
      });
      if (!decision.allowed) throw new Error(decision.reason ?? 'Scene is locked');
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO zhiban.classroom_learning_events (id,tenant_id,session_id,event_id,event_type,scene_id,payload,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (tenant_id,event_id) DO NOTHING RETURNING id`,
      [
        randomUUID(),
        principal.tenantId,
        session.rows[0].id,
        input.eventId,
        input.eventType,
        input.sceneId ?? null,
        JSON.stringify(input.payload),
        input.occurredAt,
      ],
    );
    if (inserted.rows[0]) {
      await client.query(
        `INSERT INTO zhiban.learning_events (id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,classroom_binding_id,payload,occurred_at,expires_at)
         SELECT $1,$2,$3,cc.course_id,'classroom',$4,$5,cc.id,$6::jsonb,$7,
           $7::timestamptz+(COALESCE(pref.retention_days,730)||' days')::interval
         FROM zhiban.course_classrooms cc
         LEFT JOIN zhiban.learner_profile_preferences pref ON pref.learner_id=$3 AND pref.course_id=cc.course_id
         WHERE cc.id=$8 AND COALESCE(pref.collection_enabled,true)`,
        [
          randomUUID(),
          principal.tenantId,
          principal.id,
          inserted.rows[0].id,
          input.eventType,
          JSON.stringify(input.payload),
          input.occurredAt,
          bindingId,
        ],
      );
      const visited = input.sceneId
        ? [...new Set([...(session.rows[0].visited_scene_ids ?? []), input.sceneId])]
        : session.rows[0].visited_scene_ids;
      await client.query(
        `UPDATE zhiban.classroom_learning_sessions SET current_scene_id=$3,visited_scene_ids=$4::jsonb,progress_percent=GREATEST(progress_percent,$5),status=CASE WHEN $6 THEN 'completed' ELSE status END,completed_at=CASE WHEN $6 THEN COALESCE(completed_at,now()) ELSE completed_at END,last_activity_at=now() WHERE id=$1 AND tenant_id=$2`,
        [
          session.rows[0].id,
          principal.tenantId,
          input.sceneId ?? null,
          JSON.stringify(visited),
          input.progressPercent,
          input.eventType === 'classroom_completed',
        ],
      );
    }
    return { accepted: Boolean(inserted.rows[0]), courseId: session.rows[0].course_id };
  });
}

export async function getManagedClassroomProgress(
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
        await client.query<Record<string, unknown>>(
          `SELECT cc.id AS binding_id,cc.title,cc.classroom_id,a.id AS student_id,a.display_name,a.login_name,COALESCE(s.status,'not_started') AS status,COALESCE(s.progress_percent,0) AS progress_percent,s.current_scene_id,s.started_at,s.last_activity_at,s.completed_at,COALESCE(jsonb_array_length(s.visited_scene_ids),0) AS visited_count,COUNT(e.id)::int AS interaction_count,MAX(CASE WHEN e.payload ? 'score' AND (e.payload->>'score') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (e.payload->>'score')::numeric END) AS max_score,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('sceneId',qe.scene_id,'score',qe.payload->'score','answers',qe.payload->'answers','occurredAt',qe.occurred_at) ORDER BY qe.occurred_at DESC),'[]'::jsonb) FROM zhiban.classroom_learning_events qe WHERE qe.session_id=s.id AND qe.event_type='quiz_completed') AS quiz_attempts
      FROM zhiban.course_classrooms cc JOIN zhiban.course_offerings o ON o.course_id=cc.course_id JOIN zhiban.enrollments en ON en.offering_id=o.id AND en.status='enrolled' JOIN zhiban.accounts a ON a.id=en.student_id LEFT JOIN zhiban.classroom_learning_sessions s ON s.course_classroom_id=cc.id AND s.student_id=a.id LEFT JOIN zhiban.classroom_learning_events e ON e.session_id=s.id WHERE cc.course_id=$1 GROUP BY cc.id,a.id,s.id ORDER BY cc.display_order,a.display_name`,
          [courseId],
        )
      ).rows,
  );
}

export async function getManagedClassroomEvents(
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
        await client.query<Record<string, unknown>>(
          `SELECT e.id,cc.id AS binding_id,cc.title,a.id AS student_id,a.display_name,e.event_type,e.scene_id,e.payload,e.occurred_at,e.received_at FROM zhiban.classroom_learning_events e JOIN zhiban.classroom_learning_sessions s ON s.id=e.session_id JOIN zhiban.course_classrooms cc ON cc.id=s.course_classroom_id JOIN zhiban.accounts a ON a.id=s.student_id WHERE cc.course_id=$1 ORDER BY e.occurred_at DESC LIMIT 1000`,
          [courseId],
        )
      ).rows,
  );
}
