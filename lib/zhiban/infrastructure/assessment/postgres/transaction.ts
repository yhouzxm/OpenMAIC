import { progressBarrier } from '../../curriculum/postgres/progress';
import {
  GRADEBOOK_EXPORT_LIMITS,
  type GradebookPage,
  type GradebookQuery,
} from '@/lib/zhiban/application/assessment/gradebook';
import type { RecordPage, RecordQuery } from '@/lib/zhiban/application/learning/pages';
import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import type {
  AssessmentSnapshot,
  AssessmentTransaction,
} from '@/lib/zhiban/application/assessment/service';
import { requireAcademic, type AcademicActor } from '@/lib/zhiban/domain/academic/model';
import { scorePoints, type AssessmentCommand } from '@/lib/zhiban/domain/assessment/model';
import { LearningPgTransaction } from '@/lib/zhiban/infrastructure/learning/postgres/transaction';
type Row = Record<string, unknown>;
export class AssessmentPgTransaction implements AssessmentTransaction {
  private readonly learning: LearningPgTransaction;
  constructor(private readonly client: PoolClient) {
    this.learning = new LearningPgTransaction(client);
  }
  async rows(sql: string, args: unknown[] = []): Promise<Row[]> {
    return (await this.client.query(sql, args)).rows;
  }
  async read(actor: AcademicActor, offeringId: string): Promise<AssessmentSnapshot> {
    const { mode } = await this.learning.access(actor, offeringId);
    const teacher = mode === 'TEACHER';
    const [snapshot] = await this.rows(
      `SELECT
   (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
    SELECT g.id,g.submission_id,g.score_points,g.max_points,g.feedback,g.revision::text AS revision,g.published_version,g.updated_by,g.updated_at
    FROM zhiban_assessment.grades g JOIN zhiban_learning.submissions s ON s.tenant_id=g.tenant_id AND s.id=g.submission_id JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id
    WHERE t.tenant_id=$1 AND t.offering_id=$2 ${teacher ? '' : 'AND false'} ORDER BY g.id LIMIT 501) x) AS grades,
   (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
    SELECT p.id,p.grade_id,p.submission_id,p.version,p.score_points,p.max_points,p.feedback,p.reason,p.published_by,p.published_at,t.id AS attempt_id,t.activity_id,t.activity_version,t.attempt_no,t.membership_id,s.version AS submission_version,
    (s.version=(SELECT max(q.version) FROM zhiban_learning.submissions q WHERE q.tenant_id=s.tenant_id AND q.attempt_id=s.attempt_id)) AS latest_submission
    FROM zhiban_assessment.publications p JOIN zhiban_learning.submissions s ON s.tenant_id=p.tenant_id AND s.id=p.submission_id JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id
    WHERE t.tenant_id=$1 AND t.offering_id=$2 ${teacher ? '' : 'AND t.membership_id=$3'} ORDER BY p.published_at,p.id LIMIT 501) x) AS publications`,
      teacher ? [actor.tenantId, offeringId] : [actor.tenantId, offeringId, actor.membershipId],
    );
    requireAcademic(
      (snapshot.grades as Row[]).length <= 500 && (snapshot.publications as Row[]).length <= 500,
      'UNAVAILABLE',
    );
    return {
      mode,
      offeringId,
      grades: snapshot.grades as Row[],
      publications: snapshot.publications as Row[],
    };
  }
  async page(actor: AcademicActor, offeringId: string, query: RecordQuery): Promise<RecordPage> {
    if (query.kind === 'queue') return this.queue(actor, offeringId, query);
    requireAcademic(query.kind === 'publications');
    const { mode } = await this.learning.access(actor, offeringId),
      teacher = mode === 'TEACHER';
    const anchors = await this.rows(
      `SELECT s.id FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id
      WHERE t.tenant_id=$1 AND t.offering_id=$2 AND s.id=$4 AND ($3::uuid IS NULL OR t.membership_id=$3)`,
      [actor.tenantId, offeringId, teacher ? null : actor.membershipId, query.target],
    );
    requireAcademic(anchors.length === 1, 'NOT_FOUND');
    // Current grade and history are projected in one statement; student grade drafts never enter JSON.
    const [data] = await this.rows(
      `SELECT
      (SELECT to_jsonb(r) FROM (SELECT s.id,s.attempt_id,s.version,s.answer,s.submitted_at,t.activity_id,t.activity_version,t.membership_id,t.attempt_no,v.title,(SELECT activity_type FROM zhiban_learning.activities WHERE tenant_id=t.tenant_id AND id=t.activity_id) AS activity_type,
        NOT EXISTS(SELECT 1 FROM zhiban_learning.submissions n WHERE n.tenant_id=s.tenant_id AND n.attempt_id=s.attempt_id AND n.version>s.version) AS latest_submission
        FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id
        JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version
        WHERE s.tenant_id=$1 AND s.id=$2 AND $3) r) AS review,
      (SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM (SELECT id,submission_id,score_points,max_points,feedback,revision::text AS revision,published_version FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2 AND $3) g) AS grades,
      (SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM (
        SELECT p.id,p.grade_id,p.submission_id,p.version,p.score_points,p.max_points,p.feedback,p.reason,p.published_by,p.published_at,t.activity_id,t.activity_version,t.membership_id,t.attempt_no,s.version AS submission_version,v.title AS activity_title,
        NOT EXISTS(SELECT 1 FROM zhiban_learning.submissions n WHERE n.tenant_id=s.tenant_id AND n.attempt_id=s.attempt_id AND n.version>s.version) AS latest_submission,
        (SELECT max(n.version) FROM zhiban_assessment.publications n WHERE n.tenant_id=p.tenant_id AND n.grade_id=p.grade_id) AS current_version
        FROM zhiban_assessment.publications p JOIN zhiban_learning.submissions s ON s.tenant_id=p.tenant_id AND s.id=p.submission_id
        JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id
        JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version
        WHERE p.tenant_id=$1 AND p.submission_id=$2 AND ($4::uuid IS NULL OR p.id<$4) ORDER BY p.id DESC LIMIT $5
      ) p) AS publications`,
      [actor.tenantId, query.target, teacher, query.after, query.limit + 1],
    );
    const all = data.publications as Row[],
      rows = all.slice(0, query.limit);
    return {
      mode,
      offeringId,
      rows,
      grades: data.grades as Row[],
      ...(teacher ? { review: data.review as Row } : {}),
      next: all.length > query.limit ? String(rows.at(-1)!.id) : null,
    };
  }
  private async queue(
    actor: AcademicActor,
    offeringId: string,
    query: RecordQuery,
  ): Promise<RecordPage> {
    await this.learning.access(actor, offeringId, 'TEACHER');
    const rows = await this.rows(
      `SELECT s.id,s.attempt_id,s.version AS submission_version,s.submitted_at,
      t.activity_id,t.activity_version,t.attempt_no,t.membership_id,v.title AS activity_title,(SELECT activity_type FROM zhiban_learning.activities WHERE tenant_id=t.tenant_id AND id=t.activity_id) AS activity_type,
      coalesce(p.display_name,t.membership_id::text) AS student_name,
      CASE WHEN g.id IS NULL AND EXISTS(SELECT 1 FROM zhiban_learning.quiz_evaluations qe WHERE qe.tenant_id=s.tenant_id AND qe.submission_id=s.id AND qe.manual_pending) THEN 'MANUAL' WHEN g.id IS NULL THEN 'UNSCORED' WHEN g.published_version=0 THEN 'DRAFT' ELSE 'PUBLISHED' END AS grading_state,
      coalesce(g.published_version,0) AS published_version
      FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id
      JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version
      LEFT JOIN zhiban_academic.people p ON p.tenant_id=t.tenant_id AND p.membership_id=t.membership_id
      LEFT JOIN zhiban_assessment.grades g ON g.tenant_id=s.tenant_id AND g.submission_id=s.id
      WHERE t.tenant_id=$1 AND t.offering_id=$2
      AND NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions q WHERE q.tenant_id=t.tenant_id AND q.activity_id=t.activity_id AND q.mode='PRACTICE')
      AND NOT EXISTS(SELECT 1 FROM zhiban_learning.submissions n WHERE n.tenant_id=s.tenant_id AND n.attempt_id=s.attempt_id AND n.version>s.version)
      AND ($3::uuid IS NULL OR t.activity_id=$3) AND ($4::uuid IS NULL OR t.membership_id=$4)
      AND ($5='' OR strpos(lower(v.title),lower($5))>0 OR strpos(lower(coalesce(p.display_name,'')),lower($5))>0 OR t.membership_id::text=$5)
      AND ($6='ALL' OR ($6='TODO' AND coalesce(g.published_version,0)=0) OR ($6='MANUAL' AND g.id IS NULL AND EXISTS(SELECT 1 FROM zhiban_learning.quiz_evaluations qe WHERE qe.tenant_id=s.tenant_id AND qe.submission_id=s.id AND qe.manual_pending)) OR ($6='UNSCORED' AND g.id IS NULL) OR ($6='DRAFT' AND g.id IS NOT NULL AND g.published_version=0) OR ($6='PUBLISHED' AND g.published_version>0))
      AND ($9='ALL' OR EXISTS(SELECT 1 FROM zhiban_learning.activities a WHERE a.tenant_id=t.tenant_id AND a.id=t.activity_id AND a.activity_type=$9))
      AND ($7::uuid IS NULL OR s.id<$7) ORDER BY s.id DESC LIMIT $8`,
      [
        actor.tenantId,
        offeringId,
        query.target,
        query.member,
        query.q,
        query.state,
        query.after,
        query.limit + 1,
        query.activityType ?? 'ALL',
      ],
    );
    if ((await this.client.query("SELECT to_regclass('zhiban_flow.reports') AS r")).rows[0].r) {
      const notebooks = (
        await this.client.query(
          'SELECT notebook_id,submission_id FROM zhiban_flow.reports WHERE tenant_id=$1 AND submission_id=ANY($2::uuid[])',
          [actor.tenantId, rows.map((r) => r.id)],
        )
      ).rows;
      for (const row of rows)
        row.lab_notebook_id =
          notebooks.find((n) => n.submission_id === row.id)?.notebook_id ?? null;
    }
    const page = rows.slice(0, query.limit);
    return {
      mode: 'TEACHER',
      offeringId,
      rows: page,
      next: rows.length > query.limit ? String(page.at(-1)!.id) : null,
    };
  }
  async gradebook(
    actor: AcademicActor,
    offeringId: string,
    q: GradebookQuery,
  ): Promise<GradebookPage> {
    await this.learning.access(actor, offeringId, 'TEACHER');
    // Both axes and every cell share one statement snapshot; no answers or grade drafts projected.
    const [data] = await this.rows(
      `WITH students AS MATERIALIZED (
      SELECT e.membership_id,coalesce(p.display_name,e.membership_id::text) AS display_name
      FROM zhiban_academic.enrollments e LEFT JOIN zhiban_academic.people p
      ON p.tenant_id=e.tenant_id AND p.membership_id=e.membership_id
      WHERE e.tenant_id=$1 AND e.offering_id=$2 AND e.status='ACTIVE'
      AND e.valid_from<=$3 AND e.valid_until IS NULL
      AND ($4='' OR strpos(lower(coalesce(p.display_name,'')),lower($4))>0 OR e.membership_id::text=$4)
      AND ($5::uuid IS NULL OR e.membership_id>$5) ORDER BY e.membership_id LIMIT $6
    ), activities AS MATERIALIZED (
      SELECT a.id,v.version,v.title FROM zhiban_learning.activities a
      JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version
      WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.status='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions q WHERE q.tenant_id=a.tenant_id AND q.activity_id=a.id AND q.mode='PRACTICE')
      AND ($7::uuid IS NULL OR a.id>$7) ORDER BY a.id LIMIT $8
    ), bounds AS MATERIALIZED (
      SELECT (SELECT count(*) FROM students)>$9 OR (SELECT count(*) FROM activities)>$10
        OR (SELECT count(*) FROM students)*(SELECT count(*) FROM activities)>$12 AS exceeded
    ), visible_students AS (SELECT * FROM students ORDER BY membership_id LIMIT $9),
    visible_activities AS (SELECT * FROM activities ORDER BY id LIMIT $10),
    cells AS (
      SELECT r.membership_id,v.id AS activity_id,v.version AS activity_version,
      a.id AS attempt_id,a.attempt_no,s.id AS submission_id,s.version AS submission_version,
      g.version AS grade_version,g.score_points,g.max_points,
      CASE WHEN a.id IS NULL THEN 'NOT_STARTED' WHEN s.id IS NULL THEN 'IN_PROGRESS'
        WHEN g.id IS NULL THEN 'AWAITING_GRADE' ELSE 'PUBLISHED' END AS state
      FROM visible_students r CROSS JOIN visible_activities v
      LEFT JOIN LATERAL (SELECT id,attempt_no FROM zhiban_learning.attempts
        WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=r.membership_id AND activity_id=v.id AND activity_version=v.version
        ORDER BY attempt_no DESC LIMIT 1) a ON true
      LEFT JOIN LATERAL (SELECT id,version FROM zhiban_learning.submissions
        WHERE tenant_id=$1 AND attempt_id=a.id ORDER BY version DESC LIMIT 1) s ON true
      LEFT JOIN LATERAL (SELECT id,version,score_points,max_points FROM zhiban_assessment.publications
        WHERE tenant_id=$1 AND submission_id=s.id ORDER BY version DESC LIMIT 1) g ON true
      WHERE NOT $11::boolean OR NOT (SELECT exceeded FROM bounds)
    ) SELECT
      (SELECT exceeded FROM bounds) AS export_exceeded,
      (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM visible_activities v) AS activities,
      (SELECT count(*)>$10 FROM activities) AS more_activities,
      (SELECT count(*)>$9 FROM students) AS more_students,
      (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY membership_id),'[]') FROM (
        SELECT r.*,(SELECT coalesce(jsonb_agg(to_jsonb(c)-'membership_id' ORDER BY activity_id),'[]') FROM cells c WHERE c.membership_id=r.membership_id) AS cells
        FROM visible_students r) x) AS students`,
      [
        actor.tenantId,
        offeringId,
        actor.now,
        q.q,
        q.after,
        q.limit + 1,
        q.activityAfter,
        q.activityLimit + 1,
        q.limit,
        q.activityLimit,
        q.exportAll === true,
        GRADEBOOK_EXPORT_LIMITS.records,
      ],
    );
    requireAcademic(!q.exportAll || !data.export_exceeded, 'EXPORT_LIMIT');
    const rows = data.students as Row[],
      activities = data.activities as Row[];
    return {
      mode: 'TEACHER',
      offeringId,
      asOf: actor.now,
      rows,
      activities,
      next: data.more_students ? String(rows.at(-1)!.membership_id) : null,
      activityNext: data.more_activities ? String(activities.at(-1)!.id) : null,
    };
  }
  async execute(
    actor: AcademicActor,
    offeringId: string,
    command: AssessmentCommand,
    key: string,
    quiz?: { command: unknown; marks: Record<string, number>; overrides: Record<string, string> },
  ): Promise<Row> {
    await progressBarrier(this.client, actor, offeringId);
    await this.learning.access(actor, offeringId, 'TEACHER');
    const tenant = actor.tenantId,
      digest = createHash('sha256')
        .update(JSON.stringify({ offeringId, command: quiz?.command ?? command }))
        .digest('hex');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `academic-command:${tenant}:${key}`,
    ]);
    const receipts = await this.rows(
      'SELECT c.actor_id,c.payload_digest,a.facts FROM zhiban_academic.commands c JOIN zhiban_academic.audit_events a ON a.tenant_id=c.tenant_id AND a.command_key=c.command_key WHERE c.tenant_id=$1 AND c.command_key=$2',
      [tenant, key],
    );
    if (receipts.length) {
      requireAcademic(
        receipts[0].actor_id === actor.membershipId && receipts[0].payload_digest === digest,
        'CONFLICT',
      );
      return (receipts[0].facts as { result: Row }).result;
    }
    const anchors = await this.rows(
      'SELECT s.id,s.version,s.attempt_id,t.activity_id FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id WHERE s.tenant_id=$1 AND s.id=$2 AND t.offering_id=$3',
      [tenant, command.submissionId, offeringId],
    );
    requireAcademic(anchors.length === 1, 'FORBIDDEN');
    const anchor = anchors[0];
    // Same resource lock order as Learning: activity -> attempt -> grade. Never UPDATE immutable submissions.
    const [activity] = await this.rows(
      'SELECT activity_type FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2 FOR SHARE',
      [tenant, anchor.activity_id],
    );
    if (activity.activity_type === 'QUIZ') {
      const [definition] = await this.rows(
        'SELECT mode FROM zhiban_learning.quiz_definitions WHERE tenant_id=$1 AND activity_id=$2',
        [tenant, anchor.activity_id],
      );
      requireAcademic(definition?.mode === 'ASSESSED', 'INVALID_STATE');
      requireAcademic(command.type === 'PUBLISH_GRADE' || !!quiz, 'INVALID_STATE');
    } else requireAcademic(!quiz, 'INVALID_STATE');
    await this.client.query(
      'SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [tenant, anchor.attempt_id],
    );
    if (command.type !== 'CORRECT_GRADE') {
      const latest = await this.rows(
        'SELECT max(version) AS version FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
        [tenant, anchor.attempt_id],
      );
      requireAcademic(anchor.version === latest[0].version, 'CONFLICT');
    }
    const grades = await this.rows(
      'SELECT * FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2 FOR UPDATE',
      [tenant, anchor.id],
    );
    let grade = grades[0];
    const previousRevision = grade?.revision;
    if (activity.activity_type === 'QUIZ' && command.type === 'PUBLISH_GRADE') {
      const details = await this.rows(
        'SELECT revision FROM zhiban_assessment.quiz_grade_details WHERE tenant_id=$1 AND grade_id=$2 AND revision=$3',
        [tenant, grade?.id, previousRevision],
      );
      requireAcademic(details.length === 1, 'INVALID_STATE');
    }
    let result: Row;
    const now = Number(
      (
        await this.rows('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now')
      )[0].now,
    );
    const update = async (fields: Row) => {
      // A human correction takes explicit authorship; the immutable service publication keeps its provenance.
      if ('service_job_id' in grade && 'updated_by' in fields) fields.service_job_id = null;
      const entries = Object.entries(fields);
      const rows = await this.rows(
        `UPDATE zhiban_assessment.grades SET ${entries.map(([name], i) => `${name}=$${i + 4}`).join(',')},revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING *`,
        [tenant, grade.id, grade.revision, ...entries.map(([, value]) => value)],
      );
      requireAcademic(rows.length === 1, 'CONFLICT');
      grade = rows[0];
    };
    if (command.type === 'SAVE_GRADE') {
      if (!grade) {
        requireAcademic(command.revision === null, 'CONFLICT');
        const id = v7();
        grade = (
          await this.rows(
            'INSERT INTO zhiban_assessment.grades(tenant_id,id,submission_id,score_points,max_points,feedback,updated_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *',
            [
              tenant,
              id,
              anchor.id,
              scorePoints(command.score),
              scorePoints(command.maxScore, true),
              command.feedback,
              actor.membershipId,
              now,
            ],
          )
        )[0];
      } else {
        requireAcademic(grade.revision === command.revision, 'CONFLICT');
        requireAcademic(grade.published_version === 0, 'INVALID_STATE');
        await update({
          score_points: scorePoints(command.score),
          max_points: scorePoints(command.maxScore, true),
          feedback: command.feedback,
          updated_by: actor.membershipId,
          updated_at: now,
        });
      }
      result = { id: grade.id, revision: grade.revision };
    } else {
      requireAcademic(grade && grade.revision === command.revision, 'CONFLICT');
      if (command.type === 'PUBLISH_GRADE')
        requireAcademic(grade.published_version === 0, 'INVALID_STATE');
      else {
        requireAcademic(Number(grade.published_version) > 0, 'INVALID_STATE');
        await update({
          score_points: scorePoints(command.score),
          max_points: scorePoints(command.maxScore, true),
          feedback: command.feedback,
          updated_by: actor.membershipId,
          updated_at: now,
        });
      }
      const version = Number(grade.published_version) + 1,
        id = v7();
      await this.client.query(
        'INSERT INTO zhiban_assessment.publications(tenant_id,id,grade_id,submission_id,version,score_points,max_points,feedback,reason,published_by,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          tenant,
          id,
          grade.id,
          anchor.id,
          version,
          grade.score_points,
          grade.max_points,
          grade.feedback,
          command.type === 'CORRECT_GRADE' ? command.reason : null,
          actor.membershipId,
          now,
        ],
      );
      await update({ published_version: version, updated_by: actor.membershipId, updated_at: now });
      result = {
        id: grade.id,
        revision: grade.revision,
        publicationId: id,
        publicationVersion: version,
      };
    }
    if (quiz)
      await this.client.query(
        'INSERT INTO zhiban_assessment.quiz_grade_details(tenant_id,grade_id,revision,submission_id,marks,overrides) VALUES($1,$2,$3,$4,$5,$6)',
        [
          tenant,
          result.id,
          result.revision,
          anchor.id,
          JSON.stringify(quiz.marks),
          JSON.stringify(quiz.overrides),
        ],
      );
    if (activity.activity_type === 'QUIZ' && result.publicationId) {
      const sourceRevision = quiz ? result.revision : previousRevision;
      const inserted = await this.rows(
        'INSERT INTO zhiban_assessment.quiz_publication_details(tenant_id,publication_id,submission_id,marks,overrides) SELECT tenant_id,$4,submission_id,marks,overrides FROM zhiban_assessment.quiz_grade_details WHERE tenant_id=$1 AND grade_id=$2 AND revision=$3 RETURNING publication_id',
        [tenant, result.id, sourceRevision, result.publicationId],
      );
      requireAcademic(inserted.length === 1, 'UNAVAILABLE');
    }
    await this.client.query(
      'INSERT INTO zhiban_academic.commands(tenant_id,command_key,actor_id,payload_digest,completed_at) VALUES($1,$2,$3,$4,$5)',
      [tenant, key, actor.membershipId, digest, now],
    );
    await this.client.query(
      'INSERT INTO zhiban_academic.audit_events(tenant_id,id,actor_id,command_key,event_type,occurred_at,facts) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        tenant,
        v7(),
        actor.membershipId,
        key,
        `ASSESSMENT_${command.type}`,
        now,
        JSON.stringify({ offeringId, submissionId: anchor.id, result }),
      ],
    );
    return result;
  }
}
