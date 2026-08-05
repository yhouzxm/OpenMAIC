import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { TeacherCourse, TeacherCourseUpdate } from './types';

function accessibleCourseIds(principal: AuthorizedPrincipal) {
  return principal.grants
    .filter((grant) => grant.permission === 'course:manage' && grant.scopeType === 'course' && grant.scopeId)
    .map((grant) => grant.scopeId!);
}

function tenantWide(principal: AuthorizedPrincipal) {
  return principal.grants.some((grant) => grant.permission === 'course:manage' && (grant.scopeType === 'tenant' || grant.scopeType === 'system'));
}

export async function listTeacherCourses(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal): Promise<TeacherCourse[]> {
  const ids = accessibleCourseIds(principal);
  const all = tenantWide(principal);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT c.id,c.code,c.name,c.description,c.credits::text,
        s.starts_at,s.ends_at,COALESCE(s.delivery_mode,'blended') AS delivery_mode,
        COALESCE(s.learning_objectives,'[]'::jsonb) AS learning_objectives,s.teaching_notes,
        COALESCE(s.pbl_enabled,true) AS pbl_enabled,COALESCE(s.pbl_projects,'[]'::jsonb) AS pbl_projects,
        COALESCE(s.scene_rules,'[]'::jsonb) AS scene_rules,COALESCE(s.course_resources,'[]'::jsonb) AS course_resources,
        COALESCE(s.agent_settings,'{"tutorEnabled":true,"peerEnabled":false,"monitorEnabled":false,"strategyEnabled":false}'::jsonb) AS agent_settings,
        COALESCE(s.prompt_strategy,'{"version":"v1","policy":""}'::jsonb) AS prompt_strategy,
        COALESCE(s.grading_policy,'{"formativeWeight":40,"projectWeight":30,"finalWeight":30}'::jsonb) AS grading_policy,
        COALESCE(s.assignment_policy,'{"assignmentCount":0,"maxAttempts":1}'::jsonb) AS assignment_policy,
        COALESCE(s.warning_policy,'{"scoreThreshold":60,"inactivityDays":7,"missedAssignments":2}'::jsonb) AS warning_policy,
        COALESCE(s.intervention_policy,'{"strategy":"notify_teacher","message":""}'::jsonb) AS intervention_policy,
        COALESCE(s.publication_status,'draft') AS publication_status,COALESCE(s.version,0) AS version
       FROM zhiban.courses c LEFT JOIN zhiban.course_settings s ON s.course_id=c.id
       WHERE c.tenant_id=$1 AND c.status<>'archived' AND ($2::boolean OR c.id=ANY($3::uuid[])) ORDER BY c.name`,
      [principal.tenantId, all, ids],
    );
    return result.rows.map((r) => ({
      id: r.id as string, code: r.code as string, name: r.name as string,
      description: (r.description as string | null) ?? '',
      credits: r.credits === null ? null : Number(r.credits),
      startsAt: r.starts_at ? new Date(r.starts_at as string).toISOString() : null,
      endsAt: r.ends_at ? new Date(r.ends_at as string).toISOString() : null,
      deliveryMode: r.delivery_mode as TeacherCourse['deliveryMode'],
      learningObjectives: r.learning_objectives as string[], teachingNotes: (r.teaching_notes as string | null) ?? '',
      pblEnabled: r.pbl_enabled as boolean, pblProjects: r.pbl_projects as TeacherCourse['pblProjects'],
      sceneRules: r.scene_rules as TeacherCourse['sceneRules'], courseResources: r.course_resources as TeacherCourse['courseResources'],
      agentSettings: r.agent_settings as TeacherCourse['agentSettings'], promptStrategy: r.prompt_strategy as TeacherCourse['promptStrategy'],
      gradingPolicy: r.grading_policy as TeacherCourse['gradingPolicy'], assignmentPolicy: r.assignment_policy as TeacherCourse['assignmentPolicy'],
      warningPolicy: r.warning_policy as TeacherCourse['warningPolicy'], interventionPolicy: r.intervention_policy as TeacherCourse['interventionPolicy'],
      publicationStatus: r.publication_status as TeacherCourse['publicationStatus'], version: r.version as number,
    }));
  });
}

export async function updateTeacherCourse(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, courseId: string, input: TeacherCourseUpdate) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const current = await client.query<Record<string, unknown> & { version: number; snapshot: Record<string, unknown> }>(
      `SELECT s.version,to_jsonb(s)-'tenant_id'-'created_at'-'updated_at' AS snapshot
       FROM zhiban.courses c LEFT JOIN zhiban.course_settings s ON s.course_id=c.id
       WHERE c.id=$1 AND c.tenant_id=$2 FOR UPDATE OF c`, [courseId, principal.tenantId],
    );
    if (!current.rows[0]) throw new Error('Course not found');
    const version = current.rows[0].version ?? 0;
    if (version !== input.expectedVersion) throw new Error('Course settings were changed by another user; refresh and retry');
    if (version > 0) await client.query(
      `INSERT INTO zhiban.course_setting_versions (tenant_id,course_id,version,snapshot,changed_by) VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [principal.tenantId, courseId, version, JSON.stringify(current.rows[0].snapshot), principal.id],
    );
    await client.query(`UPDATE zhiban.courses SET name=$3,description=$4,credits=$5,updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [courseId, principal.tenantId, input.name, input.description, input.credits]);
    const next = version + 1;
    await client.query(
      `INSERT INTO zhiban.course_settings
       (course_id,tenant_id,starts_at,ends_at,delivery_mode,learning_objectives,teaching_notes,pbl_enabled,pbl_settings,pbl_projects,scene_rules,course_resources,agent_settings,prompt_strategy,grading_policy,assignment_policy,warning_policy,intervention_policy,publication_status,version,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21)
       ON CONFLICT (course_id) DO UPDATE SET
        starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,delivery_mode=EXCLUDED.delivery_mode,
        learning_objectives=EXCLUDED.learning_objectives,teaching_notes=EXCLUDED.teaching_notes,pbl_enabled=EXCLUDED.pbl_enabled,
        pbl_settings=EXCLUDED.pbl_settings,pbl_projects=EXCLUDED.pbl_projects,scene_rules=EXCLUDED.scene_rules,
        course_resources=EXCLUDED.course_resources,agent_settings=EXCLUDED.agent_settings,prompt_strategy=EXCLUDED.prompt_strategy,
        grading_policy=EXCLUDED.grading_policy,assignment_policy=EXCLUDED.assignment_policy,warning_policy=EXCLUDED.warning_policy,
        intervention_policy=EXCLUDED.intervention_policy,publication_status=EXCLUDED.publication_status,
        version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [courseId, principal.tenantId, input.startsAt, input.endsAt, input.deliveryMode,
        JSON.stringify(input.learningObjectives), input.teachingNotes, input.pblEnabled,
        JSON.stringify({ projects: input.pblProjects }), JSON.stringify(input.pblProjects), JSON.stringify(input.sceneRules),
        JSON.stringify(input.courseResources), JSON.stringify(input.agentSettings), JSON.stringify(input.promptStrategy),
        JSON.stringify(input.gradingPolicy), JSON.stringify(input.assignmentPolicy), JSON.stringify(input.warningPolicy),
        JSON.stringify(input.interventionPolicy), input.publicationStatus, next, principal.id],
    );
    await client.query(
      `INSERT INTO zhiban.audit_log (tenant_id,actor_type,actor_account_id,action,resource_type,resource_id,metadata) VALUES ($1,'account',$2,'course.settings_updated','course',$3,$4::jsonb)`,
      [principal.tenantId, principal.id, courseId, JSON.stringify({ version: next, status: input.publicationStatus })],
    );
    return { version: next };
  });
}
