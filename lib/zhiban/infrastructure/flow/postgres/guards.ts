/** Server-only guards shared by the existing Classroom and Learning write paths. */
import type { PoolClient, QueryResultRow } from 'pg';
import { v7 } from 'uuid';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import type { FlowStep } from '../../../domain/flow/model';
import { publishedThreshold } from '../../../domain/progress/rules';
export async function flowInstalled(c: PoolClient) {
  return !!(await c.query("SELECT to_regclass('zhiban_flow.runs') AS r")).rows[0].r;
}
export async function flowClassroomGuard(
  c: PoolClient,
  a: AcademicActor,
  classroom: string,
  type: string,
  dispatch?: string,
  trusted = false,
) {
  if (!(await flowInstalled(c))) return;
  const run = (
    await c.query('SELECT * FROM zhiban_flow.runs WHERE tenant_id=$1 AND classroom_id=$2', [
      a.tenantId,
      classroom,
    ])
  ).rows[0];
  if (!run) return;
  if (['DISPATCH_TASK', 'DISPATCH_JOINT_TASK', 'END_TASK'].includes(type))
    requireAcademic(trusted || !['RUNNING', 'PAUSED'].includes(run.state), 'INVALID_STATE');
  if (!dispatch || !['ENTER_TASK', 'PRESENT_LECTURE_PAGE'].includes(type)) return;
  const d = (
    await c.query(
      'SELECT f.position,f.plan_version::text,v.steps FROM zhiban_flow.dispatches f JOIN zhiban_flow.versions v ON v.tenant_id=f.tenant_id AND v.classroom_id=f.classroom_id AND v.version=f.plan_version WHERE f.tenant_id=$1 AND f.dispatch_id=$2',
      [a.tenantId, dispatch],
    )
  ).rows[0];
  if (!d) return;
  requireAcademic(run.state === 'RUNNING' && run.step_index === d.position, 'INVALID_STATE');
  if (type !== 'ENTER_TASK') return;
  const entered = (
    await c.query(
      'SELECT 1 FROM zhiban_classroom.entries WHERE tenant_id=$1 AND dispatch_id=$2 AND membership_id=$3',
      [a.tenantId, dispatch, a.membershipId],
    )
  ).rowCount;
  if (entered) return { planVersion: d.plan_version, resumed: true };
  const step = (d.steps as FlowStep[])[d.position];
  const evidence: {
    stepId: string;
    submissionId: string;
    gradePublicationId: string | null;
    scorePoints: number | null;
    maxPoints: number | null;
  }[] = [];
  for (const requirement of step.requires) {
    const pos = (d.steps as FlowStep[]).findIndex((s) => s.id === requirement.stepId);
    const fact = (
      await c.query(
        `SELECT s.id AS submission_id,g.id AS grade_id,g.score_points,g.max_points
 FROM zhiban_flow.dispatches f
 JOIN zhiban_academic.audit_events e ON e.tenant_id=f.tenant_id AND e.actor_id=$3 AND e.event_type='CLASSROOM_ENTER_TASK' AND e.facts#>>'{result,dispatchId}'=f.dispatch_id::text
 JOIN zhiban_learning.attempts t ON t.tenant_id=e.tenant_id AND t.id::text=e.facts#>>'{result,attemptId}'
 JOIN zhiban_academic.enrollments n ON n.tenant_id=t.tenant_id AND n.id=t.enrollment_id AND n.membership_id=$3 AND n.status='ACTIVE' AND n.valid_from<=$5 AND n.valid_until IS NULL AND t.started_at>=n.valid_from
 LEFT JOIN LATERAL(SELECT id FROM zhiban_learning.submissions WHERE tenant_id=t.tenant_id AND attempt_id=t.id ORDER BY version DESC LIMIT 1)s ON true
 LEFT JOIN LATERAL(SELECT id,score_points,max_points FROM zhiban_assessment.publications WHERE tenant_id=t.tenant_id AND submission_id=s.id ORDER BY version DESC LIMIT 1)g ON true
 WHERE f.tenant_id=$1 AND f.classroom_id=$2 AND f.position=$4 ORDER BY e.occurred_at,e.id LIMIT 1`,
        [a.tenantId, classroom, a.membershipId, pos, a.now],
      )
    ).rows[0];
    requireAcademic(
      fact?.submission_id &&
        (requirement.kind === 'SUBMITTED' ||
          (fact.grade_id &&
            publishedThreshold(
              fact.score_points,
              fact.max_points,
              Math.round(requirement.percent! * 100),
            ))),
      'PROGRESS_BLOCKED',
    );
    evidence.push({
      stepId: requirement.stepId,
      submissionId: fact.submission_id,
      gradePublicationId: fact.grade_id ?? null,
      scorePoints: fact.score_points ?? null,
      maxPoints: fact.max_points ?? null,
    });
  }
  return { planVersion: d.plan_version, stepId: step.id, resumed: false, evidence };
}
export async function ensureFlowNotebook(
  c: PoolClient,
  a: AcademicActor,
  offering: string,
  dispatch: string,
  attempt: string | null,
) {
  if (!attempt || !(await flowInstalled(c))) return null;
  const d = (
    await c.query(
      `SELECT f.*,v.steps FROM zhiban_flow.dispatches f JOIN zhiban_flow.versions v ON v.tenant_id=f.tenant_id AND v.classroom_id=f.classroom_id AND v.version=f.plan_version WHERE f.tenant_id=$1 AND f.dispatch_id=$2`,
      [a.tenantId, dispatch],
    )
  ).rows[0];
  if (!d) return null;
  const step = (d.steps as FlowStep[])[d.position];
  if (step.kind !== 'LAB') return null;
  const t = (
    await c.query(
      'SELECT * FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2 AND offering_id=$3 AND membership_id=$4',
      [a.tenantId, attempt, offering, a.membershipId],
    )
  ).rows[0];
  requireAcademic(t, 'NOT_FOUND');
  const parameters = Object.fromEntries(step.lab!.parameters.map((f) => [f.key, f.initial]));
  await c.query(
    `INSERT INTO zhiban_flow.notebooks(tenant_id,id,offering_id,classroom_id,plan_version,position,dispatch_id,attempt_id,membership_id,enrollment_id,revision,parameters,measurements,conclusion,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,'[]','',$12) ON CONFLICT(tenant_id,attempt_id) DO NOTHING`,
    [
      a.tenantId,
      v7(),
      offering,
      d.classroom_id,
      d.plan_version,
      d.position,
      dispatch,
      attempt,
      a.membershipId,
      t.enrollment_id,
      JSON.stringify(parameters),
      a.now,
    ],
  );
  const n = (
    await c.query(
      'SELECT id,dispatch_id,membership_id,enrollment_id FROM zhiban_flow.notebooks WHERE tenant_id=$1 AND attempt_id=$2',
      [a.tenantId, attempt],
    )
  ).rows[0];
  requireAcademic(
    n &&
      n.dispatch_id === dispatch &&
      n.membership_id === a.membershipId &&
      n.enrollment_id === t.enrollment_id,
    'INVALID_STATE',
  );
  return String(n.id);
}
export async function closeFlowForClassroom(c: PoolClient, a: AcademicActor, classroom: string) {
  if (!(await flowInstalled(c))) return;
  const rows = (
    await c.query(
      "UPDATE zhiban_flow.runs SET state='CANCELLED',revision=revision+1,updated_by=$3,updated_at=$4 WHERE tenant_id=$1 AND classroom_id=$2 AND state IN('RUNNING','PAUSED') RETURNING offering_id,plan_version",
      [a.tenantId, classroom, a.membershipId, a.now],
    )
  ).rows;
  for (const r of rows)
    await c.query('INSERT INTO zhiban_flow.events VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [
      a.tenantId,
      v7(),
      r.offering_id,
      classroom,
      a.membershipId,
      'CLASSROOM_ENDED',
      JSON.stringify({ planVersion: r.plan_version }),
      a.now,
    ]);
}
export async function flowTaskInfo(
  c: PoolClient,
  a: AcademicActor,
  dispatch: string,
): Promise<QueryResultRow | null> {
  if (!(await flowInstalled(c))) return null;
  return (
    (
      await c.query(
        `SELECT r.state,r.revision::text,r.step_index,f.position,v.steps FROM zhiban_flow.dispatches f JOIN zhiban_flow.runs r ON r.tenant_id=f.tenant_id AND r.classroom_id=f.classroom_id JOIN zhiban_flow.versions v ON v.tenant_id=f.tenant_id AND v.classroom_id=f.classroom_id AND v.version=f.plan_version WHERE f.tenant_id=$1 AND f.dispatch_id=$2`,
        [a.tenantId, dispatch],
      )
    ).rows[0] ?? null
  );
}
