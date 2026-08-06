import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { createPblProject, getManagedPblProject } from './service';

export async function getPblCollaborationOverview(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, projectId: string) {
  const project = await getManagedPblProject(pool, principal, projectId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const [tasks, groups, submissions, rubrics, gradeItems, students] = await Promise.all([
      client.query<Record<string, unknown>>(`SELECT * FROM zhiban.pbl_tasks WHERE project_id=$1 ORDER BY display_order`, [projectId]),
      client.query<Record<string, unknown>>(`SELECT g.*,COALESCE(jsonb_agg(jsonb_build_object('id',gm.id,'studentId',gm.student_id,'name',a.display_name,'role',gm.group_role)) FILTER (WHERE gm.id IS NOT NULL),'[]') AS members FROM zhiban.pbl_groups g LEFT JOIN zhiban.pbl_group_members gm ON gm.group_id=g.id AND gm.left_at IS NULL LEFT JOIN zhiban.accounts a ON a.id=gm.student_id WHERE g.project_id=$1 GROUP BY g.id ORDER BY g.code`, [projectId]),
      client.query<Record<string, unknown>>(`SELECT s.*,a.display_name AS submitter_name FROM zhiban.pbl_submissions s JOIN zhiban.pbl_project_instances i ON i.id=s.instance_id JOIN zhiban.accounts a ON a.id=s.submitted_by WHERE i.project_id=$1 ORDER BY s.submitted_at DESC`, [projectId]),
      client.query<Record<string, unknown>>(`SELECT r.*,COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'description',c.description,'weight',c.weight,'maxScore',c.max_score,'levels',c.levels,'displayOrder',c.display_order)) FILTER (WHERE c.id IS NOT NULL),'[]') AS criteria FROM zhiban.pbl_rubrics r LEFT JOIN zhiban.pbl_rubric_criteria c ON c.rubric_id=r.id WHERE r.course_id=$1 GROUP BY r.id ORDER BY r.updated_at DESC`, [project.courseId]),
      client.query<Record<string, unknown>>(`SELECT * FROM zhiban.pbl_grade_items WHERE course_id=$1 ORDER BY code`, [project.courseId]),
      client.query<Record<string, unknown>>(`SELECT DISTINCT a.id,a.display_name,a.login_name FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id JOIN zhiban.accounts a ON a.id=e.student_id WHERE o.course_id=$1 AND e.status='enrolled' ORDER BY a.display_name`, [project.courseId]),
    ]);
    return { tasks: tasks.rows, groups: groups.rows, submissions: submissions.rows, rubrics: rubrics.rows, gradeItems: gradeItems.rows, students: students.rows, project };
  });
}

export async function updatePblTaskPolicy(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, projectId: string, input: { taskId: string; taskScope: 'individual' | 'group'; dependencies: string[] }) {
  await getManagedPblProject(pool, principal, projectId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const tasks = await client.query<{ id: string; dependencies: string[] }>(`SELECT id,dependencies FROM zhiban.pbl_tasks WHERE project_id=$1`, [projectId]);
    const taskIds = new Set(tasks.rows.map((task) => task.id));
    if (!taskIds.has(input.taskId) || input.dependencies.some((id) => !taskIds.has(id)) || input.dependencies.length !== new Set(input.dependencies).size || input.dependencies.includes(input.taskId)) throw new Error('Invalid task dependencies');
    const graph = new Map(tasks.rows.map((task) => [task.id, task.id === input.taskId ? input.dependencies : task.dependencies]));
    const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const dependency of graph.get(id) ?? []) if (visit(dependency)) return true;
      visiting.delete(id); visited.add(id); return false;
    };
    if ([...graph.keys()].some(visit)) throw new Error('Task dependencies cannot contain a cycle');
    const result = await client.query(`UPDATE zhiban.pbl_tasks SET task_scope=$3,dependencies=$4::jsonb WHERE id=$1 AND project_id=$2 RETURNING id`, [input.taskId, projectId, input.taskScope, JSON.stringify(input.dependencies)]);
    if (!result.rows[0]) throw new Error('PBL task not found');
    return { id: input.taskId };
  });
}

const groupRoles = ['leader', 'recorder', 'presenter'] as const;
export async function createPblGroups(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, projectId: string, input: { method: 'manual' | 'random' | 'class' | 'balanced'; groupSize: number; name?: string; studentIds?: string[] }) {
  const project = await getManagedPblProject(pool, principal, projectId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    let studentIds = input.studentIds ?? [];
    if (input.method !== 'manual') {
      const students = await client.query<{ id: string }>(
        `SELECT DISTINCT e.student_id AS id FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id
         WHERE o.course_id=$1 AND e.status='enrolled' ORDER BY ${input.method === 'random' ? "md5(e.student_id::text || $1::text)" : 'e.student_id'}`,
        [project.courseId],
      );
      studentIds = students.rows.map((row) => row.id);
    }
    if (!studentIds.length) throw new Error('No students selected for grouping');
    studentIds = [...new Set(studentIds)];
    const eligible = await client.query<{ id: string }>(`SELECT DISTINCT e.student_id AS id FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE o.course_id=$1 AND e.status='enrolled' AND e.student_id=ANY($2::uuid[])`, [project.courseId, studentIds]);
    if (eligible.rows.length !== studentIds.length) throw new Error('Grouping contains a student who is not enrolled in this course');
    await client.query(`UPDATE zhiban.pbl_group_members SET left_at=now() WHERE project_id=$1 AND left_at IS NULL`, [projectId]);
    const chunks: string[][] = [];
    for (let i = 0; i < studentIds.length; i += input.groupSize) chunks.push(studentIds.slice(i, i + input.groupSize));
    const ids: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const id = randomUUID(); ids.push(id);
      await client.query(`INSERT INTO zhiban.pbl_groups (id,tenant_id,project_id,code,name,grouping_method,max_members,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, principal.tenantId, projectId, `G${String(index + 1).padStart(2, '0')}`, input.name && chunks.length === 1 ? input.name : `项目组 ${index + 1}`, input.method, input.groupSize, principal.id]);
      for (let memberIndex = 0; memberIndex < chunks[index].length; memberIndex += 1) {
        const role = memberIndex < 3 ? groupRoles[memberIndex] : 'member';
        await client.query(`INSERT INTO zhiban.pbl_group_members (id,tenant_id,project_id,group_id,student_id,group_role) VALUES ($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), principal.tenantId, projectId, id, chunks[index][memberIndex], role]);
      }
    }
    return { groupIds: ids };
  });
}

export async function changePblGroupRole(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, projectId: string, memberId: string, role: 'leader' | 'member' | 'recorder' | 'presenter') {
  await getManagedPblProject(pool, principal, projectId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query(`UPDATE zhiban.pbl_group_members SET group_role=$3 WHERE id=$1 AND project_id=$2 AND left_at IS NULL RETURNING id`, [memberId, projectId, role]);
    if (!result.rows[0]) throw new Error('Group member not found'); return { id: memberId };
  });
}

export async function reviewPblSubmission(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, projectId: string, input: { submissionId: string; status: 'changes_requested' | 'approved'; feedback: string }) {
  const project = await getManagedPblProject(pool, principal, projectId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query(`UPDATE zhiban.pbl_submissions s SET review_status=$4,teacher_feedback=$5,reviewed_by=$3,reviewed_at=now()
      FROM zhiban.pbl_project_instances i WHERE s.id=$1 AND s.tenant_id=$2 AND i.id=s.instance_id AND i.project_id=$6 RETURNING s.id`,
      [input.submissionId, principal.tenantId, principal.id, input.status, input.feedback, projectId]);
    if (!result.rows[0]) throw new Error('Submission not found');
    if (input.status === 'approved' && project.gradeItemId) {
      // Score publication remains explicit through rubric scoring; approval only closes revision workflow.
    }
    return { id: input.submissionId, status: input.status };
  });
}

export async function scorePblSubmission(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, projectId: string, input: { submissionId: string; feedback: string; scores: Array<{ criterionId: string; score: number; feedback: string }> }) {
  const project = await getManagedPblProject(pool, principal, projectId);
  if (!project.rubricId || !project.gradeItemId) throw new Error('Create and associate a rubric and grade item first');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const submission = await client.query<{ instance_id: string; microtask_id: string }>(`SELECT s.instance_id,s.microtask_id FROM zhiban.pbl_submissions s JOIN zhiban.pbl_project_instances i ON i.id=s.instance_id WHERE s.id=$1 AND i.project_id=$2`, [input.submissionId, projectId]);
    if (!submission.rows[0]) throw new Error('Submission not found');
    const criteria = await client.query<{ id: string; weight: string; max_score: string }>(`SELECT id,weight,max_score FROM zhiban.pbl_rubric_criteria WHERE rubric_id=$1 ORDER BY display_order`, [project.rubricId]);
    const scoreByCriterion = new Map(input.scores.map((score) => [score.criterionId, score]));
    if (criteria.rows.length !== scoreByCriterion.size || criteria.rows.some((criterion) => !scoreByCriterion.has(criterion.id))) throw new Error('A score is required for every rubric criterion');
    let total = 0;
    for (const criterion of criteria.rows) {
      const value = scoreByCriterion.get(criterion.id)!;
      if (value.score < 0 || value.score > Number(criterion.max_score)) throw new Error('Criterion score exceeds its allowed range');
      total += (value.score / Number(criterion.max_score)) * Number(criterion.weight);
    }
    const evaluationId = randomUUID();
    await client.query(`INSERT INTO zhiban.pbl_evaluations (id,tenant_id,instance_id,source_evaluation_id,kind,microtask_id,score,feedback,evidence,rubric_id,grade_item_id,teacher_reviewed) VALUES ($1,$2,$3,$4,'task',$5,$6,$7,$8::jsonb,$9,$10,true)`, [evaluationId, principal.tenantId, submission.rows[0].instance_id, `teacher:${input.submissionId}:${evaluationId}`, submission.rows[0].microtask_id, total, input.feedback, JSON.stringify({ submissionId: input.submissionId }), project.rubricId, project.gradeItemId]);
    for (const criterion of criteria.rows) {
      const value = scoreByCriterion.get(criterion.id)!;
      await client.query(`INSERT INTO zhiban.pbl_rubric_scores (id,tenant_id,evaluation_id,criterion_id,score,feedback,scored_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), principal.tenantId, evaluationId, criterion.id, value.score, value.feedback, principal.id]);
    }
    await client.query(`UPDATE zhiban.pbl_submissions SET review_status='approved',teacher_feedback=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1 AND tenant_id=$2`, [input.submissionId, principal.tenantId, input.feedback, principal.id]);
    return { evaluationId, score: Math.round(total * 100) / 100, gradeItemId: project.gradeItemId };
  });
}

export async function createProjectRubric(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, projectId: string, input: { name: string; description: string; gradeItemCode: string; gradeItemName: string; gradeWeight: number; criteria: Array<{ code: string; name: string; description: string; weight: number; maxScore: number }> }) {
  const project = await getManagedPblProject(pool, principal, projectId);
  const total = input.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (Math.abs(total - 100) > 0.001) throw new Error('Rubric criteria weights must total 100');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const rubricId = randomUUID(); const gradeItemId = randomUUID();
    await client.query(`INSERT INTO zhiban.pbl_rubrics (id,tenant_id,course_id,name,description,status,created_by) VALUES ($1,$2,$3,$4,$5,'published',$6)`, [rubricId, principal.tenantId, project.courseId, input.name, input.description, principal.id]);
    for (let index = 0; index < input.criteria.length; index += 1) { const c = input.criteria[index]; await client.query(`INSERT INTO zhiban.pbl_rubric_criteria (id,tenant_id,rubric_id,code,name,description,weight,max_score,display_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), principal.tenantId, rubricId, c.code, c.name, c.description, c.weight, c.maxScore, index]); }
    await client.query(`INSERT INTO zhiban.pbl_grade_items (id,tenant_id,course_id,code,name,category,weight) VALUES ($1,$2,$3,$4,$5,'project',$6)`, [gradeItemId, principal.tenantId, project.courseId, input.gradeItemCode, input.gradeItemName, input.gradeWeight]);
    await client.query(`UPDATE zhiban.pbl_projects SET rubric_id=$3,grade_item_id=$4,updated_by=$5,updated_at=now() WHERE id=$1 AND tenant_id=$2`, [projectId, principal.tenantId, rubricId, gradeItemId, principal.id]);
    return { rubricId, gradeItemId };
  });
}

export async function createPblTemplateFromProject(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, projectId: string, input: { code: string; name: string }) {
  const project = await getManagedPblProject(pool, principal, projectId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const id = randomUUID();
    const definition = { title: project.title, description: project.description, learningObjective: project.learningObjective, targetSkills: project.targetSkills, deliverable: project.deliverable, scenarioRoleplay: project.scenarioRoleplay, scenarioBrief: project.scenarioBrief };
    await client.query(`INSERT INTO zhiban.pbl_project_templates (id,tenant_id,code,name,description,definition,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'published',$7,$7)`, [id, principal.tenantId, input.code, input.name, project.description, JSON.stringify(definition), principal.id]);
    await client.query(`UPDATE zhiban.pbl_projects SET template_id=$3 WHERE id=$1 AND tenant_id=$2`, [projectId, principal.tenantId, id]);
    return { id };
  });
}

export async function createProjectFromTemplate(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, templateId: string, courseId: string, code: string) {
  const definition = await withZhibanTenant(pool, principal.tenantId, async (client) => {
    const template = await client.query<{ definition: Record<string, unknown> }>(`SELECT definition FROM zhiban.pbl_project_templates WHERE id=$1 AND tenant_id=$2 AND status='published'`, [templateId, principal.tenantId]);
    if (!template.rows[0]) throw new Error('PBL template not found');
    return template.rows[0].definition;
  });
  return createPblProject(pool, principal, { courseId, code, title: String(definition.title), description: String(definition.description ?? ''), learningObjective: String(definition.learningObjective ?? ''), targetSkills: Array.isArray(definition.targetSkills) ? definition.targetSkills.map(String) : [], deliverable: String(definition.deliverable ?? ''), scenarioRoleplay: Boolean(definition.scenarioRoleplay), scenarioBrief: String(definition.scenarioBrief ?? ''), opensAt: null, closesAt: null, status: 'draft' });
}

export async function listPblTemplates(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(`SELECT id,code,name,description,version FROM zhiban.pbl_project_templates WHERE tenant_id=$1 AND status='published' ORDER BY name`, [principal.tenantId]);
    return result.rows;
  });
}
