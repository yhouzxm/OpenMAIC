import { createHash, randomUUID } from 'node:crypto';
import { isPBLProjectV2, type PBLProjectV2 } from '@/lib/pbl/v2/types';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { GeneratedPBLContent } from '@/lib/types/generation';
import type {
  StudentPblProjectSummary,
  ZhibanPblInstance,
  ZhibanPblProject,
  ZhibanPblProjectInput,
} from './types';

function scope(principal: AuthorizedPrincipal) {
  const all = principal.grants.some(
    (g) => g.permission === 'course:manage' && ['tenant', 'system'].includes(g.scopeType),
  );
  const ids = principal.grants
    .filter((g) => g.permission === 'course:manage' && g.scopeType === 'course' && g.scopeId)
    .map((g) => g.scopeId!);
  return { all, ids };
}

function project(row: Record<string, unknown>): ZhibanPblProject {
  return {
    id: row.id as string,
    courseId: row.course_id as string,
    code: row.code as string,
    title: row.title as string,
    description: row.description as string,
    learningObjective: row.learning_objective as string,
    targetSkills: row.target_skills as string[],
    deliverable: row.deliverable as string,
    scenarioRoleplay: row.scenario_roleplay as boolean,
    scenarioBrief: row.scenario_brief as string,
    opensAt: row.opens_at ? new Date(row.opens_at as string).toISOString() : null,
    closesAt: row.closes_at ? new Date(row.closes_at as string).toISOString() : null,
    status: row.status as ZhibanPblProject['status'],
    packageVersion: row.package_version as number,
    openmaicPackage: row.openmaic_package as GeneratedPBLContent | null,
    templateId: row.template_id as string | null | undefined,
    rubricId: row.rubric_id as string | null | undefined,
    gradeItemId: row.grade_item_id as string | null | undefined,
  };
}

export async function listManagedPblProjects(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId?: string,
) {
  const { all, ids } = scope(principal);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT p.* FROM zhiban.pbl_projects p WHERE p.tenant_id=$1 AND ($2::boolean OR p.course_id=ANY($3::uuid[])) AND ($4::uuid IS NULL OR p.course_id=$4) AND p.status<>'archived' ORDER BY p.updated_at DESC`,
      [principal.tenantId, all, ids, courseId ?? null],
    );
    return result.rows.map(project);
  });
}

export async function createPblProject(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: ZhibanPblProjectInput,
) {
  const { all, ids } = scope(principal);
  if (!all && !ids.includes(input.courseId)) throw new Error('Permission denied for this course');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const id = randomUUID();
    const result = await client.query<Record<string, unknown>>(
      `INSERT INTO zhiban.pbl_projects (id,tenant_id,course_id,code,title,description,learning_objective,target_skills,deliverable,scenario_roleplay,scenario_brief,opens_at,closes_at,status,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
      [
        id,
        principal.tenantId,
        input.courseId,
        input.code,
        input.title,
        input.description,
        input.learningObjective,
        JSON.stringify(input.targetSkills),
        input.deliverable,
        input.scenarioRoleplay,
        input.scenarioBrief,
        input.opensAt,
        input.closesAt,
        input.status,
        principal.id,
      ],
    );
    return project(result.rows[0]);
  });
}

export async function getManagedPblProject(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  projectId: string,
) {
  const projects = await listManagedPblProjects(pool, principal);
  const found = projects.find((candidate) => candidate.id === projectId);
  if (!found) throw new Error('PBL project not found or permission denied');
  return found;
}

export async function saveGeneratedPblPackage(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  projectId: string,
  content: GeneratedPBLContent,
) {
  if (!content.projectV2 || !isPBLProjectV2(content.projectV2))
    throw new Error('Generated OpenMAIC PBL package is invalid');
  await getManagedPblProject(pool, principal, projectId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `UPDATE zhiban.pbl_projects SET openmaic_package=$3::jsonb,package_version=package_version+1,updated_by=$4,updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [projectId, principal.tenantId, JSON.stringify(content), principal.id],
    );
    const tasks = content.projectV2!.milestones.flatMap((milestone) =>
      milestone.microtasks.map((task) => ({ task, milestone })),
    );
    await client.query(`DELETE FROM zhiban.pbl_tasks WHERE project_id=$1 AND tenant_id=$2`, [
      projectId,
      principal.tenantId,
    ]);
    let previousTaskId: string | null = null;
    for (let index = 0; index < tasks.length; index += 1) {
      const { task, milestone } = tasks[index];
      const id = randomUUID();
      await client.query(
        `INSERT INTO zhiban.pbl_tasks (id,tenant_id,project_id,openmaic_task_id,milestone_id,title,description,display_order,task_scope,dependencies)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'individual',$9::jsonb)`,
        [
          id,
          principal.tenantId,
          projectId,
          task.id,
          milestone.id,
          task.title,
          task.description ?? '',
          index,
          JSON.stringify(previousTaskId ? [previousTaskId] : []),
        ],
      );
      previousTaskId = id;
    }
    return project(result.rows[0]);
  });
}

export async function setPblProjectStatus(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  projectId: string,
  status: 'draft' | 'published',
) {
  const current = await getManagedPblProject(pool, principal, projectId);
  if (status === 'published' && (!current.openmaicPackage || current.packageVersion < 1))
    throw new Error('请先生成 OpenMAIC PBL 项目包');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `UPDATE zhiban.pbl_projects SET status=$3,updated_by=$4,updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [projectId, principal.tenantId, status, principal.id],
    );
    return project(result.rows[0]);
  });
}

export async function updatePblProjectDefinition(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  projectId: string,
  input: ZhibanPblProjectInput,
) {
  const current = await getManagedPblProject(pool, principal, projectId);
  const { all, ids } = scope(principal);
  if (!all && !ids.includes(input.courseId)) throw new Error('Permission denied for this course');
  if (current.courseId !== input.courseId)
    throw new Error('PBL project cannot be moved to another course');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `UPDATE zhiban.pbl_projects SET code=$3,title=$4,description=$5,learning_objective=$6,
       target_skills=$7::jsonb,deliverable=$8,scenario_roleplay=$9,scenario_brief=$10,
       opens_at=$11,closes_at=$12,status='draft',openmaic_package=NULL,updated_by=$13,updated_at=now()
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        projectId,
        principal.tenantId,
        input.code,
        input.title,
        input.description,
        input.learningObjective,
        JSON.stringify(input.targetSkills),
        input.deliverable,
        input.scenarioRoleplay,
        input.scenarioBrief,
        input.opensAt,
        input.closesAt,
        principal.id,
      ],
    );
    return project(result.rows[0]);
  });
}

export async function listStudentPblProjects(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
): Promise<StudentPblProjectSummary[]> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT p.id,p.title,p.description,p.deliverable,p.package_version,c.id AS course_id,c.name AS course_name,
        i.id AS instance_id,i.status AS instance_status,i.progress_percent,i.last_activity_at
       FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id
       JOIN zhiban.courses c ON c.id=o.course_id JOIN zhiban.pbl_projects p ON p.course_id=c.id
       LEFT JOIN zhiban.pbl_project_instances i ON i.project_id=p.id AND i.student_id=e.student_id
       WHERE e.tenant_id=$1 AND e.student_id=$2 AND e.status='enrolled' AND p.status='published'
        AND p.openmaic_package IS NOT NULL AND (p.opens_at IS NULL OR p.opens_at<=now()) AND (p.closes_at IS NULL OR p.closes_at>=now())
       ORDER BY c.name,p.title`,
      [principal.tenantId, principal.id],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      deliverable: row.deliverable as string,
      packageVersion: row.package_version as number,
      courseId: row.course_id as string,
      courseName: row.course_name as string,
      instanceId: row.instance_id as string | null,
      instanceStatus: row.instance_status as string | null,
      progressPercent: Number(row.progress_percent ?? 0),
      lastActivityAt: row.last_activity_at
        ? new Date(row.last_activity_at as string).toISOString()
        : null,
    }));
  });
}

export async function startStudentPblInstance(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  projectId: string,
): Promise<ZhibanPblInstance> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const available = await client.query<Record<string, unknown>>(
      `SELECT p.*,c.name AS course_name FROM zhiban.pbl_projects p JOIN zhiban.courses c ON c.id=p.course_id
       WHERE p.id=$1 AND p.tenant_id=$2 AND p.status='published' AND p.openmaic_package IS NOT NULL
       AND EXISTS (SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE e.student_id=$3 AND e.status='enrolled' AND o.course_id=p.course_id)`,
      [projectId, principal.tenantId, principal.id],
    );
    const row = available.rows[0];
    if (!row) throw new Error('PBL project is unavailable');
    const content = row.openmaic_package as GeneratedPBLContent;
    if (!content.projectV2 || !isPBLProjectV2(content.projectV2))
      throw new Error('PBL package is invalid');
    const id = randomUUID();
    const result = await client.query<Record<string, unknown>>(
      `INSERT INTO zhiban.pbl_project_instances (id,tenant_id,project_id,student_id,package_version,project_state)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (project_id,student_id) DO UPDATE SET updated_at=now()
       RETURNING *`,
      [
        id,
        principal.tenantId,
        projectId,
        principal.id,
        row.package_version,
        JSON.stringify(content.projectV2),
      ],
    );
    return instance(
      result.rows[0],
      row.title as string,
      row.course_id as string,
      row.course_name as string,
    );
  });
}

function instance(
  row: Record<string, unknown>,
  projectTitle: string,
  courseId: string,
  courseName: string,
): ZhibanPblInstance {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    projectTitle,
    courseId,
    courseName,
    status: row.status as ZhibanPblInstance['status'],
    progressPercent: Number(row.progress_percent),
    packageVersion: row.package_version as number,
    projectState: row.project_state as PBLProjectV2,
    lastActivityAt: row.last_activity_at
      ? new Date(row.last_activity_at as string).toISOString()
      : null,
  };
}

function progress(projectState: PBLProjectV2) {
  const tasks = projectState.milestones.flatMap((milestone) => milestone.microtasks);
  return tasks.length
    ? Math.round(
        (tasks.filter((task) => task.status === 'completed' || task.status === 'skipped').length /
          tasks.length) *
          10000,
      ) / 100
    : 0;
}

export async function syncStudentPblInstance(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  instanceId: string,
  projectState: PBLProjectV2,
) {
  if (!isPBLProjectV2(projectState)) throw new Error('Invalid PBL project state');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const percent = progress(projectState);
    const status =
      projectState.status === 'completed'
        ? 'completed'
        : projectState.uiPhase === 'hero'
          ? 'not_started'
          : 'in_progress';
    const owned = await client.query<Record<string, unknown>>(
      `UPDATE zhiban.pbl_project_instances SET project_state=$4::jsonb,status=$5,progress_percent=$6,
       started_at=CASE WHEN $5='in_progress' AND started_at IS NULL THEN now() ELSE started_at END,
       completed_at=CASE WHEN $5='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END,
       last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND student_id=$3 RETURNING *`,
      [instanceId, principal.tenantId, principal.id, JSON.stringify(projectState), status, percent],
    );
    if (!owned.rows[0]) throw new Error('PBL instance not found');
    const projectContext = await client.query<{ project_id: string; course_id: string }>(
      `SELECT p.id AS project_id,p.course_id FROM zhiban.pbl_projects p WHERE p.id=$1`,
      [owned.rows[0].project_id],
    );
    const context = projectContext.rows[0];
    for (const event of projectState.runtimeEvents ?? []) {
      const eventRow = await client.query<{ id: string }>(
        `INSERT INTO zhiban.pbl_learning_events (id,tenant_id,instance_id,source_event_id,event_type,actor_type,payload,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (instance_id,source_event_id) DO NOTHING RETURNING id`,
        [
          randomUUID(),
          principal.tenantId,
          instanceId,
          event.id,
          event.kind,
          event.actorType === 'user' ? 'student' : event.actorType,
          JSON.stringify(event),
          event.ts,
        ],
      );
      if (eventRow.rows[0] && context)
        await client.query(
          `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,project_id,payload,occurred_at,expires_at)
           SELECT $1,$2,$3,$4,'pbl',$5,$6,$7,$8::jsonb,$9,$9::timestamptz+(COALESCE(pref.retention_days,730)||' days')::interval
           FROM (SELECT 1) seed LEFT JOIN zhiban.learner_profile_preferences pref ON pref.learner_id=$3 AND pref.course_id=$4
           WHERE COALESCE(pref.collection_enabled,true)`,
          [
            randomUUID(),
            principal.tenantId,
            principal.id,
            context.course_id,
            eventRow.rows[0].id,
            event.kind,
            context.project_id,
            JSON.stringify(event),
            event.ts,
          ],
        );
    }
    for (const submission of projectState.submissions) {
      const exists = await client.query<{ id: string }>(
        `SELECT id FROM zhiban.pbl_submissions WHERE id=$1 AND tenant_id=$2`,
        [submission.id, principal.tenantId],
      );
      if (exists.rows[0]) continue;
      const next = await client.query<{ version: number }>(
        `SELECT COALESCE(max(attempt),0)+1 AS version FROM zhiban.pbl_submissions WHERE instance_id=$1 AND microtask_id=$2`,
        [instanceId, submission.microtaskId],
      );
      const group = await client.query<{ group_id: string }>(
        `SELECT gm.group_id FROM zhiban.pbl_group_members gm JOIN zhiban.pbl_project_instances i ON i.project_id=gm.project_id
         WHERE i.id=$1 AND gm.student_id=$2 AND gm.left_at IS NULL LIMIT 1`,
        [instanceId, principal.id],
      );
      const hash = createHash('sha256')
        .update(submission.content)
        .update(submission.fileUrl ?? '')
        .digest('hex');
      await client.query(
        `INSERT INTO zhiban.pbl_submissions (id,tenant_id,instance_id,milestone_id,microtask_id,kind,content,file_url,attempt,submitted_at,submitted_by,group_id,content_hash,hash_algorithm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'sha256')`,
        [
          submission.id,
          principal.tenantId,
          instanceId,
          submission.milestoneId ?? null,
          submission.microtaskId,
          submission.kind,
          submission.content,
          submission.fileUrl ?? null,
          next.rows[0]?.version ?? 1,
          submission.createdAt,
          principal.id,
          group.rows[0]?.group_id ?? null,
          hash,
        ],
      );
      if (context)
        await client.query(
          `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,project_id,payload,occurred_at,expires_at)
           SELECT $1,$2,$3,$4,'submission',$5,'submission_created',$6,$7::jsonb,$8,$8::timestamptz+(COALESCE(pref.retention_days,730)||' days')::interval
           FROM (SELECT 1) seed LEFT JOIN zhiban.learner_profile_preferences pref ON pref.learner_id=$3 AND pref.course_id=$4
           WHERE COALESCE(pref.collection_enabled,true)`,
          [
            randomUUID(),
            principal.tenantId,
            principal.id,
            context.course_id,
            submission.id,
            context.project_id,
            JSON.stringify({
              kind: submission.kind,
              attempt: next.rows[0]?.version ?? 1,
              microtaskId: submission.microtaskId,
            }),
            submission.createdAt,
          ],
        );
    }
    for (const evaluation of projectState.evaluations) {
      const evaluationRow = await client.query<{ id: string }>(
        `INSERT INTO zhiban.pbl_evaluations (id,tenant_id,instance_id,source_evaluation_id,kind,milestone_id,microtask_id,score,feedback,evidence,evaluated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) ON CONFLICT (instance_id,source_evaluation_id) DO NOTHING RETURNING id`,
        [
          randomUUID(),
          principal.tenantId,
          instanceId,
          evaluation.id,
          evaluation.kind,
          evaluation.milestoneId ?? null,
          evaluation.microtaskId ?? null,
          evaluation.score ?? null,
          evaluation.feedback,
          JSON.stringify({
            strengths: evaluation.strengths,
            improvements: evaluation.improvements,
            stars: evaluation.stars,
          }),
          evaluation.createdAt,
        ],
      );
      if (evaluationRow.rows[0] && context)
        await client.query(
          `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,project_id,payload,occurred_at,expires_at)
           SELECT $1,$2,$3,$4,'evaluation',$5,'evaluation_completed',$6,$7::jsonb,$8,$8::timestamptz+(COALESCE(pref.retention_days,730)||' days')::interval
           FROM (SELECT 1) seed LEFT JOIN zhiban.learner_profile_preferences pref ON pref.learner_id=$3 AND pref.course_id=$4
           WHERE COALESCE(pref.collection_enabled,true)`,
          [
            randomUUID(),
            principal.tenantId,
            principal.id,
            context.course_id,
            evaluationRow.rows[0].id,
            context.project_id,
            JSON.stringify({ score: evaluation.score, kind: evaluation.kind }),
            evaluation.createdAt,
          ],
        );
    }
    return { status, progressPercent: percent, courseId: context?.course_id ?? null };
  });
}

export async function getStudentPblInstance(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  instanceId: string,
): Promise<ZhibanPblInstance> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT i.*,p.title AS project_title,p.course_id,c.name AS course_name
       FROM zhiban.pbl_project_instances i JOIN zhiban.pbl_projects p ON p.id=i.project_id
       JOIN zhiban.courses c ON c.id=p.course_id
       WHERE i.id=$1 AND i.tenant_id=$2 AND i.student_id=$3`,
      [instanceId, principal.tenantId, principal.id],
    );
    if (!result.rows[0]) throw new Error('PBL instance not found');
    const row = result.rows[0];
    const [group, reviews] = await Promise.all([
      client.query<Record<string, unknown>>(
        `SELECT g.id,g.name,me.group_role,COALESCE(jsonb_agg(jsonb_build_object('name',a.display_name,'role',gm.group_role)),'[]') AS members FROM zhiban.pbl_group_members me JOIN zhiban.pbl_groups g ON g.id=me.group_id JOIN zhiban.pbl_group_members gm ON gm.group_id=g.id AND gm.left_at IS NULL JOIN zhiban.accounts a ON a.id=gm.student_id WHERE me.project_id=$1 AND me.student_id=$2 AND me.left_at IS NULL GROUP BY g.id,me.group_role`,
        [row.project_id, principal.id],
      ),
      client.query<Record<string, unknown>>(
        `SELECT id,microtask_id,attempt,review_status,COALESCE(teacher_feedback,'') AS teacher_feedback,submitted_at FROM zhiban.pbl_submissions WHERE instance_id=$1 ORDER BY submitted_at DESC`,
        [instanceId],
      ),
    ]);
    return {
      ...instance(
        row,
        row.project_title as string,
        row.course_id as string,
        row.course_name as string,
      ),
      group: group.rows[0]
        ? {
            id: group.rows[0].id as string,
            name: group.rows[0].name as string,
            role: group.rows[0].group_role as NonNullable<ZhibanPblInstance['group']>['role'],
            members: group.rows[0].members as Array<{ name: string; role: string }>,
          }
        : null,
      submissionReviews: reviews.rows.map((review) => ({
        id: review.id as string,
        microtaskId: review.microtask_id as string,
        version: Number(review.attempt),
        status: review.review_status as string,
        feedback: review.teacher_feedback as string,
        submittedAt: new Date(review.submitted_at as string).toISOString(),
      })),
    };
  });
}
