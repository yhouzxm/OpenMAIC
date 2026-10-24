import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import type { CaseCommand } from '../../../domain/followup/model';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
type Row = Record<string, unknown>;
export class FollowupCasesPg {
  constructor(private readonly client: PoolClient) {}
  private async rows(sql: string, args: unknown[]) {
    return (await this.client.query<Row>(sql, args)).rows;
  }
  async read(
    actor: AcademicActor,
    offering: string,
    id: string | null,
    state: string,
    q: string,
    after: string | null,
  ) {
    await new LearningPgTransaction(this.client).access(actor, offering, 'TEACHER');
    if (id) {
      const [record] = await this.rows(
        `SELECT c.*,c.revision::text,coalesce(p.display_name,'历史成员') AS student_name,
        coalesce(creator.display_name,c.created_by::text) AS creator_name
        FROM zhiban_followup.cases c LEFT JOIN zhiban_academic.people p ON p.tenant_id=c.tenant_id AND p.membership_id=c.membership_id
        LEFT JOIN zhiban_academic.people creator ON creator.tenant_id=c.tenant_id AND creator.membership_id=c.created_by
        WHERE c.tenant_id=$1 AND c.offering_id=$2 AND c.id=$3 FOR SHARE OF c`,
        [actor.tenantId, offering, id],
      );
      requireAcademic(record, 'NOT_FOUND');
      const events = await this.rows(
        `SELECT e.id,e.action,e.body,e.revision::text,e.from_state,e.to_state,e.created_at,e.actor_id,coalesce(p.display_name,e.actor_id::text) AS actor_name
        FROM zhiban_followup.events e LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.actor_id
        WHERE e.tenant_id=$1 AND e.offering_id=$2 AND e.case_id=$3 AND ($4::uuid IS NULL OR e.id<$4) ORDER BY e.id DESC LIMIT 21`,
        [actor.tenantId, offering, id, after],
      );
      return {
        record,
        rows: events.slice(0, 20),
        next: events.length > 20 ? String(events[19].id) : null,
      };
    }
    const rows = await this.rows(
      `SELECT c.id,c.activity_id,c.activity_version,c.activity_title,c.membership_id,c.enrollment_id,c.state,c.revision::text,c.created_by,c.updated_by,c.created_at,c.updated_at,coalesce(p.display_name,'历史成员') AS student_name
      FROM zhiban_followup.cases c LEFT JOIN zhiban_academic.people p ON p.tenant_id=c.tenant_id AND p.membership_id=c.membership_id
      WHERE c.tenant_id=$1 AND c.offering_id=$2 AND ($3='ALL' OR c.state=$3)
      AND ($4='' OR strpos(lower(c.activity_title),lower($4))>0 OR strpos(lower(coalesce(p.display_name,'')),lower($4))>0 OR c.membership_id::text=$4)
      AND ($5::uuid IS NULL OR c.id<$5) ORDER BY c.id DESC LIMIT 21`,
      [actor.tenantId, offering, state, q, after],
    );
    return { rows: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19].id) : null };
  }
  async execute(actor: AcademicActor, offering: string, c: CaseCommand, key: string) {
    await new LearningPgTransaction(this.client).access(actor, offering, 'TEACHER');
    const t = actor.tenantId,
      digest = createHash('sha256')
        .update(JSON.stringify([offering, c]))
        .digest('hex');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `followup-command:${t}:${key}`,
    ]);
    const [prior] = await this.rows(
      'SELECT actor_id,offering_id,payload_digest,result FROM zhiban_followup.commands WHERE tenant_id=$1 AND command_key=$2',
      [t, key],
    );
    if (prior) {
      requireAcademic(
        prior.actor_id === actor.membershipId &&
          prior.offering_id === offering &&
          prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result;
    }
    let record: Row,
      from: string | null = null;
    if (c.type === 'CREATE_CASE') {
      const [activity] = await this.rows(
        "SELECT a.id,v.title,v.deadline_at FROM zhiban_learning.activities a JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=$3 AND a.published_version=$4 AND a.status='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions q WHERE q.tenant_id=a.tenant_id AND q.activity_id=a.id AND q.mode='PRACTICE') FOR SHARE OF a",
        [t, offering, c.activityId, c.version],
      );
      requireAcademic(activity, 'CONFLICT');
      const [enrollment] = await this.rows(
        "SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE' AND valid_from<=$4 AND valid_until IS NULL FOR SHARE",
        [t, offering, c.membershipId, actor.now],
      );
      requireAcademic(enrollment, 'CONFLICT');
      await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `followup-anchor:${t}:${enrollment.id}:${c.activityId}:${c.version}`,
      ]);
      const [existing] = await this.rows(
        'SELECT id FROM zhiban_followup.cases WHERE tenant_id=$1 AND enrollment_id=$2 AND activity_id=$3 AND activity_version=$4',
        [t, enrollment.id, c.activityId, c.version],
      );
      requireAcademic(!existing, 'CONFLICT');
      // Lock the selected latest Attempt against concurrent submit/resubmit. Activity SHARE serializes new attempts/publication changes.
      const [attempt] = await this.rows(
        'SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND activity_id=$4 AND activity_version=$5 ORDER BY attempt_no DESC LIMIT 1 FOR SHARE',
        [t, offering, c.membershipId, c.activityId, c.version],
      );
      const [submission] = attempt
        ? await this.rows(
            'SELECT id,version FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2 ORDER BY version DESC LIMIT 1',
            [t, attempt.id],
          )
        : [];
      if (submission) {
        // The original grading writer locks activity SHARE then Attempt UPDATE, so this lock prevents a stale publication decision.
        const [published] = await this.rows(
          'SELECT id FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=$2 LIMIT 1',
          [t, submission.id],
        );
        requireAcademic(!published, 'CONFLICT');
      }
      const evidence = {
        reason: submission
          ? 'AWAITING_GRADE'
          : activity.deadline_at !== null && Number(activity.deadline_at) <= actor.now
            ? 'OVERDUE'
            : attempt
              ? 'IN_PROGRESS'
              : 'NOT_STARTED',
        attemptId: attempt?.id ?? null,
        submissionId: submission?.id ?? null,
        submissionVersion: submission?.version ?? null,
        deadlineAt: activity.deadline_at,
        asOf: actor.now,
      };
      [record] = await this.rows(
        "INSERT INTO zhiban_followup.cases VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',1,$10,$10,$11,$11) RETURNING id,state,revision::text",
        [
          t,
          offering,
          v7(),
          enrollment.id,
          c.membershipId,
          c.activityId,
          c.version,
          activity.title,
          JSON.stringify(evidence),
          actor.membershipId,
          actor.now,
        ],
      );
    } else {
      const [current] = await this.rows(
        'SELECT id,state,revision::text FROM zhiban_followup.cases WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
        [t, offering, c.id],
      );
      requireAcademic(current, 'NOT_FOUND');
      requireAcademic(current.revision === c.revision, 'CONFLICT');
      from = String(current.state);
      requireAcademic(
        c.type === 'REOPEN_CASE' ? from === 'CLOSED' : from === 'OPEN',
        'INVALID_STATE',
      );
      const to = c.type === 'CLOSE_CASE' ? 'CLOSED' : 'OPEN';
      [record] = await this.rows(
        'UPDATE zhiban_followup.cases SET state=$4,revision=revision+1,updated_by=$5,updated_at=$6 WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 RETURNING id,state,revision::text',
        [t, offering, c.id, to, actor.membershipId, actor.now],
      );
    }
    const [event] = await this.rows(
      'INSERT INTO zhiban_followup.events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
      [
        t,
        offering,
        record.id,
        v7(),
        actor.membershipId,
        c.type,
        c.body,
        record.revision,
        from,
        record.state,
        actor.now,
      ],
    );
    const result = { ...record, eventId: event.id };
    await this.client.query(
      'INSERT INTO zhiban_followup.commands VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [t, key, actor.membershipId, offering, record.id, digest, JSON.stringify(result), actor.now],
    );
    return result;
  }
}
