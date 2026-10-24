import { progressBarrier, requireProgress } from '../../curriculum/postgres/progress';
import type { FileClearanceEvidence } from '../../../application/learning/attachment-assets';
import { PostgresSubmissionFileAssets } from '../../learning-files/postgres/assets';
import type { RecordPage, RecordQuery } from '@/lib/zhiban/application/learning/pages';
import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import type {
  LearningTransaction,
  LearningSnapshot,
} from '@/lib/zhiban/application/learning/service';
import {
  AcademicError,
  requireAcademic,
  academicTeacher,
  academicStudent,
  type AcademicActor,
} from '@/lib/zhiban/domain/academic/model';
import { writableAttempt, type LearningCommand } from '@/lib/zhiban/domain/learning/model';
type Row = Record<string, unknown>;
export interface QuizWriteExtension {
  kind: 'QUIZ';
  command: unknown;
  eventType: string;
  before?: (activity: Row, now: number) => Promise<void>;
  after: (result: Row) => Promise<void>;
}
export class LearningPgTransaction implements LearningTransaction {
  constructor(private readonly client: PoolClient) {}
  async rows(sql: string, args: unknown[] = []): Promise<Row[]> {
    return (await this.client.query(sql, args)).rows;
  }
  async access(actor: AcademicActor, offeringId: string, kind?: 'TEACHER' | 'STUDENT') {
    const offerings = await this.rows(
      'SELECT * FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2 FOR SHARE',
      [actor.tenantId, offeringId],
    );
    requireAcademic(offerings.length === 1, 'FORBIDDEN');
    const offering = offerings[0];
    const courses = await this.rows(
      'SELECT status FROM zhiban_academic.courses WHERE tenant_id=$1 AND id=$2 FOR SHARE',
      [actor.tenantId, offering.course_id],
    );
    requireAcademic(courses.length === 1 && courses[0].status !== 'ARCHIVED', 'FORBIDDEN');
    const teacher =
      academicTeacher(actor, String(offering.course_id), offeringId) &&
      (
        await this.rows(
          "SELECT id FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE' AND valid_from<=$4 AND valid_until IS NULL FOR SHARE",
          [actor.tenantId, offeringId, actor.membershipId, actor.now],
        )
      ).length === 1;
    const enrollments = academicStudent(actor)
      ? await this.rows(
          "SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE' AND valid_from<=$4 AND valid_until IS NULL FOR SHARE",
          [actor.tenantId, offeringId, actor.membershipId, actor.now],
        )
      : [];
    const mode = kind ?? (teacher ? 'TEACHER' : 'STUDENT');
    requireAcademic(mode === 'TEACHER' ? teacher : enrollments.length === 1, 'FORBIDDEN');
    return { mode, offering, enrollmentId: enrollments[0]?.id };
  }
  async read(actor: AcademicActor, offeringId: string): Promise<LearningSnapshot> {
    const { mode } = await this.access(actor, offeringId);
    const teacher = mode === 'TEACHER';
    // One statement snapshot. Student draft data never enters the returned JSON.
    const [snapshot] = await this.rows(
      `SELECT
      (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
       SELECT a.id,a.activity_type,a.status,a.published_version,${teacher ? 'a.revision::text AS revision,a.title,a.prompt,a.deadline_at,a.allow_resubmit,a.max_attempts' : 'NULL::text AS revision,v.title,v.prompt,v.deadline_at,v.allow_resubmit,v.max_attempts'}
       FROM zhiban_learning.activities a LEFT JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version
       WHERE a.tenant_id=$1 AND a.offering_id=$2 ${teacher ? '' : "AND a.published_version>0 AND (a.status='PUBLISHED' OR EXISTS(SELECT 1 FROM zhiban_learning.attempts t WHERE t.tenant_id=a.tenant_id AND t.activity_id=a.id AND t.membership_id=$3))"} ORDER BY a.created_at,a.id LIMIT 501) x) AS activities,
      (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
       SELECT t.id,t.activity_id,t.activity_version,t.membership_id,t.enrollment_id,t.attempt_no,t.status,(SELECT activity_type FROM zhiban_learning.activities WHERE tenant_id=t.tenant_id AND id=t.activity_id) AS activity_type,${teacher ? 'NULL::text AS draft' : 't.draft'},t.revision::text AS revision,t.started_at,t.updated_at,v.title,v.prompt,v.deadline_at,v.allow_resubmit,v.max_attempts
       FROM zhiban_learning.attempts t JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version
       WHERE t.tenant_id=$1 AND t.offering_id=$2 ${teacher ? '' : 'AND t.membership_id=$3'} ORDER BY t.started_at,t.id LIMIT 501) x) AS attempts,
      (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
       SELECT s.id,s.attempt_id,s.version,s.answer,s.submitted_at FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id
       WHERE t.tenant_id=$1 AND t.offering_id=$2 ${teacher ? '' : 'AND t.membership_id=$3'} ORDER BY s.submitted_at,s.id LIMIT 501) x) AS submissions`,
      teacher ? [actor.tenantId, offeringId] : [actor.tenantId, offeringId, actor.membershipId],
    );
    for (const name of ['activities', 'attempts', 'submissions'])
      requireAcademic((snapshot[name] as Row[]).length <= 500, 'UNAVAILABLE');
    return {
      mode,
      offeringId,
      activities: snapshot.activities as Row[],
      attempts: snapshot.attempts as Row[],
      submissions: snapshot.submissions as Row[],
    };
  }
  async page(actor: AcademicActor, offeringId: string, query: RecordQuery): Promise<RecordPage> {
    const { mode } = await this.access(actor, offeringId),
      teacher = mode === 'TEACHER';
    let rows: Row[];
    if (query.kind === 'activities') {
      rows = await this.rows(
        `SELECT a.id,a.activity_type,a.status,a.published_version,
        CASE WHEN $3 THEN a.revision::text ELSE NULL END AS revision,
        CASE WHEN $3 THEN a.title ELSE v.title END AS title,
        CASE WHEN $3 THEN a.prompt ELSE v.prompt END AS prompt,
        CASE WHEN $3 THEN a.deadline_at ELSE v.deadline_at END AS deadline_at,
        CASE WHEN $3 THEN a.allow_resubmit ELSE v.allow_resubmit END AS allow_resubmit,
        CASE WHEN $3 THEN a.max_attempts ELSE v.max_attempts END AS max_attempts,
        (SELECT coalesce(max(t.attempt_no),0) FROM zhiban_learning.attempts t WHERE t.tenant_id=a.tenant_id AND t.activity_id=a.id AND t.membership_id=$4) AS latest_attempt_no,
        EXISTS(SELECT 1 FROM zhiban_learning.attempts t WHERE t.tenant_id=a.tenant_id AND t.activity_id=a.id AND t.membership_id=$4 AND t.status='IN_PROGRESS') AS has_active_attempt
        FROM zhiban_learning.activities a LEFT JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version
        WHERE a.tenant_id=$1 AND a.offering_id=$2 AND ($3 OR (a.published_version>0 AND (a.status='PUBLISHED' OR EXISTS(SELECT 1 FROM zhiban_learning.attempts t WHERE t.tenant_id=a.tenant_id AND t.activity_id=a.id AND t.membership_id=$4))))
        AND ($5='' OR strpos(lower(CASE WHEN $3 THEN a.title ELSE v.title END),lower($5))>0 OR a.id::text=$5)
        AND ($6='ALL' OR a.status=$6) AND ($7::uuid IS NULL OR a.id<$7)
        ORDER BY a.id DESC LIMIT $8`,
        [
          actor.tenantId,
          offeringId,
          teacher,
          actor.membershipId,
          query.q,
          query.state,
          query.after,
          query.limit + 1,
        ],
      );
    } else if (query.kind === 'attempts') {
      requireAcademic(teacher || !query.member || query.member === actor.membershipId, 'FORBIDDEN');
      const activity = await this.rows(
        `SELECT a.id FROM zhiban_learning.activities a WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=$5
        AND ($3 OR (a.published_version>0 AND (a.status='PUBLISHED' OR EXISTS(SELECT 1 FROM zhiban_learning.attempts t WHERE t.tenant_id=a.tenant_id AND t.activity_id=a.id AND t.membership_id=$4))))`,
        [actor.tenantId, offeringId, teacher, actor.membershipId, query.target],
      );
      requireAcademic(activity.length === 1, 'NOT_FOUND');
      rows = await this.rows(
        `SELECT t.id,t.activity_id,t.activity_version,t.membership_id,t.enrollment_id,t.attempt_no,t.status,(SELECT activity_type FROM zhiban_learning.activities WHERE tenant_id=t.tenant_id AND id=t.activity_id) AS activity_type,
        CASE WHEN $3::uuid IS NULL THEN NULL ELSE t.draft END AS draft,t.revision::text AS revision,t.started_at,t.updated_at,
        v.title,v.prompt,v.deadline_at,v.allow_resubmit,v.max_attempts,p.display_name,
        NOT EXISTS(SELECT 1 FROM zhiban_learning.attempts n WHERE n.tenant_id=t.tenant_id AND n.activity_id=t.activity_id AND n.membership_id=t.membership_id AND n.attempt_no>t.attempt_no) AS latest_attempt
        FROM zhiban_learning.attempts t JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version
        LEFT JOIN zhiban_academic.people p ON p.tenant_id=t.tenant_id AND p.membership_id=t.membership_id
        WHERE t.tenant_id=$1 AND t.offering_id=$2 AND ($3::uuid IS NULL OR t.membership_id=$3) AND t.activity_id=$4
        AND ($5='ALL' OR t.status=$5) AND ($6::uuid IS NULL OR t.membership_id=$6) AND ($7::uuid IS NULL OR t.id<$7) AND ($9::uuid IS NULL OR t.id=$9)
        ORDER BY t.id DESC LIMIT $8`,
        [
          actor.tenantId,
          offeringId,
          teacher ? null : actor.membershipId,
          query.target,
          query.state,
          query.member,
          query.after,
          query.limit + 1,
          query.exactId ?? null,
        ],
      );
    } else {
      requireAcademic(query.kind === 'submissions');
      const attempt = await this.rows(
        'SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND offering_id=$2 AND id=$4 AND ($3::uuid IS NULL OR membership_id=$3)',
        [actor.tenantId, offeringId, teacher ? null : actor.membershipId, query.target],
      );
      requireAcademic(attempt.length === 1, 'NOT_FOUND');
      rows = await this.rows(
        `SELECT s.id,s.attempt_id,s.version,s.answer,s.submitted_at,t.activity_id,t.activity_version,t.membership_id,t.attempt_no,
        NOT EXISTS(SELECT 1 FROM zhiban_learning.submissions n WHERE n.tenant_id=s.tenant_id AND n.attempt_id=s.attempt_id AND n.version>s.version) AS latest_submission
        FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id
        WHERE t.tenant_id=$1 AND t.offering_id=$2 AND ($3::uuid IS NULL OR t.membership_id=$3) AND t.id=$4 AND ($5::uuid IS NULL OR s.id<$5)
        ORDER BY s.id DESC LIMIT $6`,
        [
          actor.tenantId,
          offeringId,
          teacher ? null : actor.membershipId,
          query.target,
          query.after,
          query.limit + 1,
        ],
      );
    }
    if (
      query.kind === 'attempts' &&
      (await this.client.query("SELECT to_regclass('zhiban_flow.notebooks') AS r")).rows[0].r
    ) {
      const notebooks = (
        await this.client.query(
          'SELECT id,attempt_id FROM zhiban_flow.notebooks WHERE tenant_id=$1 AND offering_id=$2 AND attempt_id=ANY($3::uuid[])',
          [actor.tenantId, offeringId, rows.map((r) => r.id)],
        )
      ).rows;
      for (const row of rows)
        row.lab_notebook_id = notebooks.find((n) => n.attempt_id === row.id)?.id ?? null;
    }
    const more = rows.length > query.limit;
    rows = rows.slice(0, query.limit);
    return { mode, offeringId, rows, next: more ? String(rows.at(-1)!.id) : null };
  }
  async files(
    actor: AcademicActor,
    offeringId: string,
    submission: string,
    file?: string,
  ): Promise<Row[]> {
    const { mode } = await this.access(actor, offeringId);
    const anchor = await this.rows(
      `SELECT s.id FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts t
      ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id WHERE s.tenant_id=$1 AND s.id=$2 AND t.offering_id=$3
      AND ($4::uuid IS NULL OR t.membership_id=$4)`,
      [actor.tenantId, submission, offeringId, mode === 'TEACHER' ? null : actor.membershipId],
    );
    requireAcademic(anchor.length === 1, 'NOT_FOUND');
    return new PostgresSubmissionFileAssets(this.client).read(actor.tenantId, submission, file);
  }

  async authorizeAttachment(actor: AcademicActor, offeringId: string, attemptId: string) {
    await this.access(actor, offeringId, 'STUDENT');
    const rows = await this.rows(
      "SELECT t.id FROM zhiban_learning.attempts t JOIN zhiban_learning.activities a ON a.tenant_id=t.tenant_id AND a.id=t.activity_id WHERE t.tenant_id=$1 AND t.offering_id=$2 AND t.membership_id=$3 AND t.id=$4 AND a.activity_type='TEXT_RESPONSE'",
      [actor.tenantId, offeringId, actor.membershipId, attemptId],
    );
    requireAcademic(rows.length === 1, 'NOT_FOUND');
  }

  async execute(
    actor: AcademicActor,
    offeringId: string,
    command: LearningCommand,
    key: string,
    clearance?: FileClearanceEvidence,
    extension?: QuizWriteExtension,
    trustedLabNotebook?: string,
  ): Promise<Row> {
    await progressBarrier(this.client, actor, offeringId);
    const author = [
      'CREATE_ACTIVITY',
      'EDIT_ACTIVITY',
      'PUBLISH_ACTIVITY',
      'WITHDRAW_ACTIVITY',
    ].includes(command.type);
    const access = await this.access(actor, offeringId, author ? 'TEACHER' : 'STUDENT');
    const digest = createHash('sha256')
      .update(JSON.stringify({ offeringId, command: extension?.command ?? command }))
      .digest('hex');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `academic-command:${actor.tenantId}:${key}`,
    ]);
    const receipts = await this.rows(
      'SELECT c.actor_id,c.payload_digest,a.facts FROM zhiban_academic.commands c JOIN zhiban_academic.audit_events a ON a.tenant_id=c.tenant_id AND a.command_key=c.command_key WHERE c.tenant_id=$1 AND c.command_key=$2',
      [actor.tenantId, key],
    );
    if (receipts.length) {
      requireAcademic(
        receipts[0].actor_id === actor.membershipId && receipts[0].payload_digest === digest,
        'CONFLICT',
      );
      return (receipts[0].facts as { result: Row }).result;
    }
    requireAcademic(access.offering.status === 'OPEN', 'INVALID_STATE');
    const tenant = actor.tenantId;
    let result: Row;
    let progressDecision: Awaited<ReturnType<typeof requireProgress>> | undefined;
    const update = async (table: 'activities' | 'attempts', row: Row, columns: Row) => {
      const entries = Object.entries(columns);
      const updated = await this.rows(
        `UPDATE zhiban_learning.${table} SET ${entries.map(([name], i) => `${name}=$${i + 4}`).join(',')},revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING id,revision::text AS revision`,
        [tenant, row.id, row.revision, ...entries.map(([, value]) => value)],
      );
      requireAcademic(updated.length === 1, 'CONFLICT');
      return updated[0];
    };
    if (command.type === 'CREATE_ACTIVITY') {
      const id = v7();
      await this.client.query(
        "INSERT INTO zhiban_learning.activities(tenant_id,id,offering_id,title,prompt,deadline_at,allow_resubmit,max_attempts,status,created_at,updated_at,activity_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT',$9,$9,$10)",
        [
          tenant,
          id,
          offeringId,
          command.title,
          command.prompt,
          command.deadlineAt,
          command.allowResubmit,
          command.maxAttempts,
          actor.now,
          extension?.kind ?? 'TEXT_RESPONSE',
        ],
      );
      result = { id, revision: '1' };
    } else {
      let attempt: Row | undefined;
      let activityId = command.id;
      if (command.type === 'SAVE_DRAFT' || command.type === 'SUBMIT') {
        const rows = await this.rows(
          'SELECT activity_id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2 AND offering_id=$3 AND membership_id=$4',
          [tenant, command.id, offeringId, actor.membershipId],
        );
        requireAcademic(rows.length === 1, 'FORBIDDEN');
        activityId = String(rows[0].activity_id);
      }
      const activities = await this.rows(
        'SELECT * FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2 AND offering_id=$3 FOR UPDATE',
        [tenant, activityId, offeringId],
      );
      requireAcademic(activities.length === 1, 'NOT_FOUND');
      const activity = activities[0];
      requireAcademic(
        activity.activity_type === (extension?.kind ?? 'TEXT_RESPONSE'),
        'INVALID_STATE',
      );
      const now = Number(
        (
          await this.rows('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now')
        )[0].now,
      );
      await extension?.before?.(activity, now);
      if (author) {
        requireAcademic(
          'revision' in command && activity.revision === command.revision,
          'CONFLICT',
        );
        if (command.type === 'EDIT_ACTIVITY')
          result = await update('activities', activity, {
            title: command.title,
            prompt: command.prompt,
            deadline_at: command.deadlineAt,
            allow_resubmit: command.allowResubmit,
            max_attempts: command.maxAttempts,
            updated_at: now,
          });
        else if (command.type === 'PUBLISH_ACTIVITY') {
          if (activity.deadline_at !== null && now >= Number(activity.deadline_at))
            throw new AcademicError('DEADLINE_PASSED');
          const version = Number(activity.published_version) + 1;
          await this.client.query(
            'INSERT INTO zhiban_learning.activity_versions(tenant_id,activity_id,version,offering_id,title,prompt,deadline_at,allow_resubmit,max_attempts,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [
              tenant,
              activity.id,
              version,
              offeringId,
              activity.title,
              activity.prompt,
              activity.deadline_at,
              activity.allow_resubmit,
              activity.max_attempts,
              now,
            ],
          );
          result = {
            ...(await update('activities', activity, {
              status: 'PUBLISHED',
              published_version: version,
              updated_at: now,
            })),
            version,
          };
        } else {
          requireAcademic(
            command.type === 'WITHDRAW_ACTIVITY' && activity.status === 'PUBLISHED',
            'INVALID_STATE',
          );
          result = await update('activities', activity, { status: 'WITHDRAWN', updated_at: now });
        }
      } else {
        requireAcademic(activity.status === 'PUBLISHED', 'INVALID_STATE');
        const attempts = await this.rows(
          'SELECT * FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2 AND membership_id=$3 ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE',
          [tenant, activity.id, actor.membershipId],
        );
        const latest = attempts[0];
        if (command.type === 'START_ATTEMPT' && command.expectedVersion !== undefined) {
          requireAcademic(
            String(activity.published_version) === command.expectedVersion,
            'INVALID_STATE',
          );
          if (latest?.status === 'IN_PROGRESS')
            requireAcademic(
              String(latest.activity_version) === command.expectedVersion,
              'INVALID_STATE',
            );
        }
        if (command.type === 'START_ATTEMPT' && latest?.status === 'IN_PROGRESS') {
          result = { id: latest.id, revision: latest.revision, resumed: true };
        } else if (command.type === 'START_ATTEMPT') {
          progressDecision = await requireProgress(
            this.client,
            actor,
            offeringId,
            String(activity.id),
          );
          const [version] = await this.rows(
            'SELECT * FROM zhiban_learning.activity_versions WHERE tenant_id=$1 AND activity_id=$2 AND version=$3',
            [tenant, activity.id, activity.published_version],
          );
          if (version.deadline_at !== null && now >= Number(version.deadline_at))
            throw new AcademicError('DEADLINE_PASSED');
          const number = Number(latest?.attempt_no ?? 0) + 1;
          if (version.max_attempts !== null && number > Number(version.max_attempts))
            throw new AcademicError('ATTEMPT_LIMIT');
          const id = v7();
          await this.client.query(
            "INSERT INTO zhiban_learning.attempts(tenant_id,id,offering_id,activity_id,activity_version,enrollment_id,membership_id,attempt_no,status,started_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'IN_PROGRESS',$9,$9)",
            [
              tenant,
              id,
              offeringId,
              activity.id,
              version.version,
              access.enrollmentId,
              actor.membershipId,
              number,
              now,
            ],
          );
          await this.client.query(
            "INSERT INTO zhiban_learning.events(tenant_id,id,attempt_id,event_type,source_version,received_at) VALUES($1,$2,$3,'ATTEMPT_STARTED','learning-v1',$4)",
            [tenant, v7(), id, now],
          );
          result = { id, revision: '1', resumed: false };
        } else {
          requireAcademic(latest && latest.id === command.id, 'INVALID_STATE');
          attempt = latest;
          requireAcademic(
            'revision' in command && attempt.revision === command.revision,
            'CONFLICT',
          );
          const [version] = await this.rows(
            'SELECT * FROM zhiban_learning.activity_versions WHERE tenant_id=$1 AND activity_id=$2 AND version=$3',
            [tenant, activity.id, attempt.activity_version],
          );
          writableAttempt(
            String(attempt.status),
            Boolean(version.allow_resubmit),
            version.deadline_at === null ? null : Number(version.deadline_at),
            now,
          );
          requireAcademic(command.type === 'SAVE_DRAFT' || command.type === 'SUBMIT');
          if (
            command.type === 'SUBMIT' &&
            (await this.client.query("SELECT to_regclass('zhiban_flow.notebooks') AS r")).rows[0].r
          ) {
            const notebook = (
              await this.client.query(
                'SELECT id FROM zhiban_flow.notebooks WHERE tenant_id=$1 AND attempt_id=$2',
                [tenant, attempt.id],
              )
            ).rows[0];
            requireAcademic(!notebook || trustedLabNotebook === notebook.id, 'INVALID_STATE');
          }
          if (command.type === 'SAVE_DRAFT')
            result = await update('attempts', attempt, { draft: command.answer, updated_at: now });
          else {
            const [{ next }] = await this.rows(
              'SELECT coalesce(max(version),0)+1 AS next FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
              [tenant, attempt.id],
            );
            const submissionId = v7();
            await this.client.query(
              'INSERT INTO zhiban_learning.submissions(tenant_id,id,attempt_id,version,answer,submitted_at) VALUES($1,$2,$3,$4,$5,$6)',
              [tenant, submissionId, attempt.id, next, command.answer, now],
            );
            if (command.attachment)
              await new PostgresSubmissionFileAssets(this.client).append(
                {
                  tenant,
                  offering: offeringId,
                  member: actor.membershipId,
                  attempt: String(attempt.id),
                  submission: submissionId,
                  now,
                  status: String(attempt.status),
                  allowResubmit: Boolean(version.allow_resubmit),
                  deadline: version.deadline_at === null ? null : Number(version.deadline_at),
                },
                command.attachment,
                clearance,
              );
            await this.client.query(
              "INSERT INTO zhiban_learning.events(tenant_id,id,attempt_id,submission_id,event_type,source_version,received_at) VALUES($1,$2,$3,$4,'SUBMISSION_RECORDED','learning-v1',$5)",
              [tenant, v7(), attempt.id, submissionId, now],
            );
            result = {
              ...(await update('attempts', attempt, {
                status: 'SUBMITTED',
                draft: command.answer,
                updated_at: now,
              })),
              submissionId,
              submissionVersion: next,
            };
          }
        }
      }
    }
    await extension?.after(result);
    await this.client.query(
      'INSERT INTO zhiban_academic.commands(tenant_id,command_key,actor_id,payload_digest,completed_at) VALUES($1,$2,$3,$4,$5)',
      [tenant, key, actor.membershipId, digest, actor.now],
    );
    // Audit carries stable references, never learner response or activity prompt.
    await this.client.query(
      'INSERT INTO zhiban_academic.audit_events(tenant_id,id,actor_id,command_key,event_type,occurred_at,facts) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        tenant,
        v7(),
        actor.membershipId,
        key,
        `LEARNING_${extension?.eventType ?? command.type}`,
        actor.now,
        JSON.stringify({ offeringId, result, ...(progressDecision ? { progressDecision } : {}) }),
      ],
    );
    return result;
  }
}
