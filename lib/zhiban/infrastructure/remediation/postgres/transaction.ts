import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import type { RemediationCommand } from '../../../domain/remediation/model';
import type {
  RemediationQuery,
  RemediationTransaction,
} from '../../../application/remediation/service';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
type Row = Record<string, unknown>;
export class RemediationPgTransaction implements RemediationTransaction {
  constructor(private readonly client: PoolClient) {}
  private async rows(sql: string, args: unknown[]) {
    return (await this.client.query<Row>(sql, args)).rows;
  }
  private async enrollment(a: AcademicActor, o: string, p: Row) {
    const [e] = await this.rows(
      "SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND membership_id=$4 AND status='ACTIVE' AND valid_from<=$5 AND valid_until IS NULL FOR SHARE",
      [a.tenantId, o, p.enrollment_id, p.membership_id, a.now],
    );
    requireAcademic(e, 'FORBIDDEN');
  }
  private async tasks(a: AcademicActor, p: Row) {
    return this.rows(
      'SELECT id,activity_id,activity_version,activity_title,position,baseline FROM zhiban_remediation.tasks WHERE tenant_id=$1 AND plan_id=$2 ORDER BY position',
      [a.tenantId, p.id],
    );
  }
  private async facts(a: AcademicActor, o: string, p: Row, tasks: Row[]) {
    // One canonical activity order; original start/publish writers take activity UPDATE.
    const ids = tasks.map((t) => String(t.activity_id)).sort();
    await this.rows(
      'SELECT id FROM zhiban_learning.activities WHERE tenant_id=$1 AND offering_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR SHARE',
      [a.tenantId, o, ids],
    );
    for (const task of [...tasks].sort((x, y) =>
      String(x.activity_id).localeCompare(String(y.activity_id)),
    ))
      await this.rows(
        'SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND enrollment_id=$2 AND membership_id=$3 AND activity_id=$4 AND activity_version=$5 ORDER BY attempt_no DESC LIMIT 1 FOR SHARE',
        [a.tenantId, p.enrollment_id, p.membership_id, task.activity_id, task.activity_version],
      );
    // Fixed versions, original Enrollment, latest submission and latest formal publication only.
    // No answers, private notes or draft grade columns enter this projection.
    return this.rows(
      `WITH refs AS(SELECT * FROM jsonb_to_recordset($5::jsonb) AS r(id uuid,activity_id uuid,activity_version integer))
   SELECT r.id AS "taskId",r.activity_id AS "activityId",r.activity_version AS version,
    floor(extract(epoch FROM statement_timestamp())*1000)::bigint AS "asOf",
    v.title AS "activityTitle",v.deadline_at AS "deadlineAt",a.status AS "activityState",a.published_version AS "currentPublishedVersion",
    t.id AS "attemptId",t.attempt_no AS "attemptNo",t.started_at AS "attemptStartedAt",
    s.id AS "submissionId",s.version AS "submissionVersion",s.submitted_at AS "submittedAt",
    g.id AS "publicationId",g.version AS "gradeVersion",g.score_points AS "scorePoints",g.max_points AS "maxPoints",g.published_at AS "publishedAt"
   FROM refs r JOIN zhiban_learning.activities a ON a.tenant_id=$1 AND a.offering_id=$2 AND a.id=r.activity_id
   JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=r.activity_version
   LEFT JOIN LATERAL(SELECT id,attempt_no,started_at FROM zhiban_learning.attempts WHERE tenant_id=$1 AND enrollment_id=$3 AND membership_id=$4 AND activity_id=r.activity_id AND activity_version=r.activity_version ORDER BY attempt_no DESC LIMIT 1)t ON true
   LEFT JOIN LATERAL(SELECT id,version,submitted_at FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=t.id ORDER BY version DESC LIMIT 1)s ON true
   LEFT JOIN LATERAL(SELECT id,version,score_points,max_points,published_at FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=s.id ORDER BY version DESC LIMIT 1)g ON true
   ORDER BY r.id`,
      [
        a.tenantId,
        o,
        p.enrollment_id,
        p.membership_id,
        JSON.stringify(
          tasks.map((t) => ({
            id: t.id,
            activity_id: t.activity_id,
            activity_version: t.activity_version,
          })),
        ),
      ],
    );
  }
  async read(a: AcademicActor, o: string, q: RemediationQuery) {
    await new LearningPgTransaction(this.client).access(a, o, q.mode);
    if (q.options) {
      const rows = await this.rows(
        `SELECT a.id,v.version,v.title,v.deadline_at FROM zhiban_learning.activities a JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version
    WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.status='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions z WHERE z.tenant_id=a.tenant_id AND z.activity_id=a.id AND z.mode='PRACTICE')
    AND ($3='' OR strpos(lower(v.title),lower($3))>0 OR a.id::text=$3) AND ($4::uuid IS NULL OR a.id<$4) ORDER BY a.id DESC LIMIT 21`,
        [a.tenantId, o, q.q, q.after],
      );
      return { rows: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19].id) : null };
    }
    const teacher = q.mode === 'TEACHER';
    if (q.caseId) {
      const [c] = await this.rows(
        'SELECT id FROM zhiban_followup.cases WHERE tenant_id=$1 AND offering_id=$2 AND id=$3',
        [a.tenantId, o, q.caseId],
      );
      requireAcademic(c, 'NOT_FOUND');
    }
    const args = [
      a.tenantId,
      o,
      teacher ? null : a.membershipId,
      q.caseId,
      q.id,
      q.id ? null : q.after,
      a.now,
    ];
    const rows = await this.rows(
      `SELECT p.id,p.title,p.goal,p.due_at,p.state,p.revision::text,p.created_at,p.updated_at,coalesce(creator.display_name,'任教教师') AS teacher_name
   ${teacher ? ",p.case_id,p.enrollment_id,p.membership_id,coalesce(student.display_name,'历史成员') AS student_name,c.revision::text AS case_revision,c.state AS case_state" : ''}
   FROM zhiban_remediation.plans p
   JOIN zhiban_academic.enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
   JOIN zhiban_followup.cases c ON c.tenant_id=p.tenant_id AND c.id=p.case_id
   LEFT JOIN zhiban_academic.people creator ON creator.tenant_id=p.tenant_id AND creator.membership_id=p.created_by
   ${teacher ? 'LEFT JOIN zhiban_academic.people student ON student.tenant_id=p.tenant_id AND student.membership_id=p.membership_id' : ''}
   WHERE p.tenant_id=$1 AND p.offering_id=$2 AND ($3::uuid IS NULL OR (p.membership_id=$3 AND e.status='ACTIVE' AND e.valid_from<=$7 AND e.valid_until IS NULL))
   AND ($4::uuid IS NULL OR p.case_id=$4) AND ($5::uuid IS NULL OR p.id=$5) AND ($6::uuid IS NULL OR p.id<$6)
   ORDER BY p.id DESC LIMIT 21 ${q.id ? 'FOR SHARE OF p' : ''}`,
      args,
    );
    if (!q.id)
      return { rows: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19].id) : null };
    requireAcademic(rows.length === 1, 'NOT_FOUND');
    const [internal] = await this.rows(
      'SELECT id,enrollment_id,membership_id FROM zhiban_remediation.plans WHERE tenant_id=$1 AND id=$2',
      [a.tenantId, q.id],
    );
    const tasks = await this.tasks(a, internal),
      facts = await this.facts(a, o, internal, tasks);
    const reports = await this.rows(
      "SELECT DISTINCT ON(task_id) task_id,value,body,created_at FROM zhiban_remediation.events WHERE tenant_id=$1 AND plan_id=$2 AND action='REPORT_TASK' ORDER BY task_id,revision DESC",
      [a.tenantId, q.id],
    );
    const events = await this.rows(
      `SELECT e.id,e.task_id,e.action,e.value,e.body,e.snapshot,e.revision::text,e.created_at,coalesce(p.display_name,'历史成员') AS actor_name
   FROM zhiban_remediation.events e LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.actor_id
   WHERE e.tenant_id=$1 AND e.plan_id=$2 AND ($3::uuid IS NULL OR e.id<$3) ORDER BY e.id DESC LIMIT 21`,
      [a.tenantId, q.id, q.after],
    );
    return {
      record: rows[0],
      tasks: tasks.map((t) => ({
        ...t,
        current: facts.find((f) => f.taskId === t.id),
        report: reports.find((r) => r.task_id === t.id) ?? null,
      })),
      rows: events.slice(0, 20),
      next: events.length > 20 ? String(events[19].id) : null,
    };
  }
  async execute(a: AcademicActor, o: string, c: RemediationCommand, key: string) {
    const t = a.tenantId,
      student = c.type === 'REPORT_TASK';
    await new LearningPgTransaction(this.client).access(a, o, student ? 'STUDENT' : 'TEACHER');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `remediation-command:${t}:${key}`,
    ]);
    let p: Row;
    if (c.type === 'ASSIGN_PLAN') {
      const [anchor] = await this.rows(
        'SELECT id,revision::text,state,enrollment_id,membership_id FROM zhiban_followup.cases WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
        [t, o, c.caseId],
      );
      requireAcademic(anchor, 'NOT_FOUND');
      await this.enrollment(a, o, anchor);
      p = anchor;
    } else {
      const [plan] = await this.rows(
        'SELECT * ,revision::text FROM zhiban_remediation.plans WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND ($4::uuid IS NULL OR membership_id=$4) FOR UPDATE',
        [t, o, c.id, student ? a.membershipId : null],
      );
      requireAcademic(plan, 'NOT_FOUND');
      p = plan;
      if (student) await this.enrollment(a, o, p);
    }
    const digest = createHash('sha256')
      .update(JSON.stringify([o, c]))
      .digest('hex');
    const [prior] = await this.rows(
      'SELECT actor_id,offering_id,payload_digest,result FROM zhiban_remediation.commands WHERE tenant_id=$1 AND command_key=$2',
      [t, key],
    );
    if (prior) {
      requireAcademic(
        prior.actor_id === a.membershipId &&
          prior.offering_id === o &&
          prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result;
    }
    requireAcademic(p.revision === c.revision, 'CONFLICT');
    let snapshot: Row[] = [],
      value: string | null = null,
      body: string,
      taskId: string | null = null;
    if (c.type === 'ASSIGN_PLAN') {
      requireAcademic(p.state === 'OPEN', 'CONFLICT');
      requireAcademic(c.dueAt === null || c.dueAt > a.now);
      await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `remediation-case:${t}:${c.caseId}`,
      ]);
      const [existing] = await this.rows(
        "SELECT id FROM zhiban_remediation.plans WHERE tenant_id=$1 AND case_id=$2 AND state='ACTIVE'",
        [t, c.caseId],
      );
      requireAcademic(!existing, 'CONFLICT');
      const refs: Row[] = [];
      for (const ref of [...c.tasks].sort((x, y) => x.activityId.localeCompare(y.activityId))) {
        const [activity] = await this.rows(
          "SELECT a.id,v.title FROM zhiban_learning.activities a JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=$3 AND a.published_version=$4 AND a.status='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions z WHERE z.tenant_id=a.tenant_id AND z.activity_id=a.id AND z.mode='PRACTICE') FOR SHARE OF a",
          [t, o, ref.activityId, ref.version],
        );
        requireAcademic(activity, 'CONFLICT');
        refs.push({
          id: v7(),
          activity_id: ref.activityId,
          activity_version: ref.version,
          activity_title: activity.title,
          position: c.tasks.findIndex((r) => r.activityId === ref.activityId) + 1,
        });
      }
      const id = v7();
      snapshot = await this.facts(a, o, p, refs);
      await this.client.query(
        "INSERT INTO zhiban_remediation.plans VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',1,$10,$11,$11)",
        [
          t,
          o,
          id,
          c.caseId,
          p.enrollment_id,
          p.membership_id,
          c.title,
          c.goal,
          c.dueAt,
          a.membershipId,
          a.now,
        ],
      );
      for (const ref of refs)
        await this.client.query(
          'INSERT INTO zhiban_remediation.tasks VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            t,
            o,
            id,
            ref.id,
            ref.position,
            ref.activity_id,
            ref.activity_version,
            ref.activity_title,
            JSON.stringify(snapshot.find((f) => f.taskId === ref.id)),
          ],
        );
      p = { id, state: 'ACTIVE', revision: '1' };
      body = c.goal;
    } else {
      requireAcademic(p.state === 'ACTIVE', 'INVALID_STATE');
      body = c.body;
      if (c.type === 'REPORT_TASK') {
        const [task] = await this.rows(
          'SELECT id FROM zhiban_remediation.tasks WHERE tenant_id=$1 AND plan_id=$2 AND id=$3',
          [t, p.id, c.taskId],
        );
        requireAcademic(task, 'NOT_FOUND');
        taskId = c.taskId;
        value = c.status;
      }
      if (c.type === 'REVIEW_PLAN') {
        value = c.outcome;
        snapshot = await this.facts(a, o, p, await this.tasks(a, p));
      }
      const state =
        c.type === 'CANCEL_PLAN'
          ? 'CANCELLED'
          : c.type === 'REVIEW_PLAN' && c.outcome === 'ACHIEVED'
            ? 'CLOSED'
            : 'ACTIVE';
      [p] = await this.rows(
        'UPDATE zhiban_remediation.plans SET state=$3,revision=revision+1,updated_at=$4 WHERE tenant_id=$1 AND id=$2 RETURNING id,state,revision::text',
        [t, p.id, state, a.now],
      );
    }
    await this.client.query(
      'INSERT INTO zhiban_remediation.events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        t,
        p.id,
        v7(),
        taskId,
        c.type,
        value,
        body,
        JSON.stringify(snapshot),
        p.revision,
        a.membershipId,
        a.now,
      ],
    );
    const result = { id: p.id, state: p.state, revision: p.revision };
    await this.client.query(
      'INSERT INTO zhiban_remediation.commands VALUES($1,$2,$3,$4,$5,$6,$7)',
      [t, key, a.membershipId, o, digest, JSON.stringify(result), a.now],
    );
    return result;
  }
}
