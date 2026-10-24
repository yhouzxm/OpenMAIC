import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import {
  personalSummary,
  type PersonalAttempt,
  type PersonalActivity,
  type PersonalSnapshot,
  type ProgressTransaction,
} from '../../../application/progress/service';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
export class ProgressPgTransaction implements ProgressTransaction {
  constructor(private readonly client: PoolClient) {}
  async read(actor: AcademicActor, offeringId: string): Promise<PersonalSnapshot> {
    const access = await new LearningPgTransaction(this.client).access(
      actor,
      offeringId,
      'STUDENT',
    );
    // One snapshot, server-derived learner only. No answer, draft score or classmate row is read.
    const { rows } = await this.client.query<{
      activities: Omit<PersonalActivity, 'latest'>[];
      history: PersonalAttempt[];
    }>(
      `
      WITH current_activities AS MATERIALIZED (
        SELECT a.id,v.version,v.title,v.deadline_at AS "deadlineAt"
        FROM zhiban_learning.activities a JOIN zhiban_learning.activity_versions v
          ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version
        WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.status='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions q WHERE q.tenant_id=a.tenant_id AND q.activity_id=a.id AND q.mode='PRACTICE')
        ORDER BY v.published_at DESC,a.id LIMIT 501
      ), own_attempts AS MATERIALIZED (
        SELECT a.id,a.activity_id,a.activity_version,a.attempt_no,a.started_at
        FROM zhiban_learning.attempts a
        WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.membership_id=$3 AND NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions q WHERE q.tenant_id=a.tenant_id AND q.activity_id=a.activity_id AND q.mode='PRACTICE')
        ORDER BY a.started_at DESC,a.id DESC LIMIT 501
      ), own_history AS (
        SELECT a.id,a.activity_id AS "activityId",a.activity_version AS "activityVersion",v.title,
          a.attempt_no AS "attemptNo",s.version AS "submissionVersion",s.submitted_at AS "submittedAt",
          p.version AS "gradeVersion",p.score_points AS "scorePoints",p.max_points AS "maxPoints",
          p.feedback,p.reason AS "correctionReason",p.published_at AS "publishedAt",a.started_at
        FROM own_attempts a JOIN zhiban_learning.activity_versions v
          ON v.tenant_id=$1 AND v.activity_id=a.activity_id AND v.version=a.activity_version
        LEFT JOIN LATERAL (
          SELECT s.id,s.version,s.submitted_at FROM zhiban_learning.submissions s
          WHERE s.tenant_id=$1 AND s.attempt_id=a.id ORDER BY s.version DESC LIMIT 1
        ) s ON true
        LEFT JOIN zhiban_assessment.grades g ON g.tenant_id=$1 AND g.submission_id=s.id
        LEFT JOIN LATERAL (
          SELECT p.version,p.score_points,p.max_points,p.feedback,p.reason,p.published_at
          FROM zhiban_assessment.publications p
          WHERE p.tenant_id=$1 AND p.grade_id=g.id AND p.submission_id=s.id
          ORDER BY p.version DESC LIMIT 1
        ) p ON true
      ) SELECT
        COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.title,c.id) FROM current_activities c),'[]') AS activities,
        COALESCE((SELECT jsonb_agg(to_jsonb(h)-'started_at' ORDER BY h.started_at DESC,h.id DESC) FROM own_history h),'[]') AS history`,
      [actor.tenantId, offeringId, actor.membershipId],
    );
    const data = rows[0];
    requireAcademic(data.activities.length <= 500 && data.history.length <= 500, 'UNAVAILABLE');
    const activities = data.activities.map((a) => ({
      ...a,
      latest:
        data.history
          .filter((h) => h.activityId === a.id && h.activityVersion === a.version)
          .sort((x, y) => y.attemptNo - x.attemptNo)[0] ?? null,
    }));
    return {
      mode: 'STUDENT',
      offering: { id: offeringId, title: String(access.offering.name) },
      asOf: actor.now,
      activities,
      history: data.history,
      summary: personalSummary(activities),
    };
  }
}
