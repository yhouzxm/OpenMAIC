import { FollowupCasesPg } from './cases';
import type { CaseCommand } from '../../../domain/followup/model';
import { readFollowups } from './followups';
import type { FollowupQuery } from '../../../application/analytics/followups';
import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import {
  summarize,
  type ActivitySelection,
  type AnalyticsActivity,
  type AnalyticsStudent,
  type AnalyticsSnapshot,
  type AnalyticsTransaction,
} from '../../../application/analytics/service';
import { LearningPgTransaction } from '../../learning/postgres/transaction';

export class AnalyticsPgTransaction implements AnalyticsTransaction {
  constructor(private readonly client: PoolClient) {}
  caseRead(
    actor: AcademicActor,
    offering: string,
    id: string | null,
    state: string,
    q: string,
    after: string | null,
  ) {
    return new FollowupCasesPg(this.client).read(actor, offering, id, state, q, after);
  }
  caseCommand(actor: AcademicActor, offering: string, command: CaseCommand, key: string) {
    return new FollowupCasesPg(this.client).execute(actor, offering, command, key);
  }
  followups(actor: AcademicActor, offering: string, query: FollowupQuery, casesEnabled = false) {
    return readFollowups(this.client, actor, offering, query, casesEnabled);
  }
  async read(
    actor: AcademicActor,
    offeringId: string,
    selection: ActivitySelection | null,
  ): Promise<AnalyticsSnapshot> {
    const access = await new LearningPgTransaction(this.client).access(
      actor,
      offeringId,
      'TEACHER',
    );
    // One statement gives all mutable publication pointers and roster a single PG snapshot.
    // No drafts, answers, feedback or Identity rows are read by this report.
    const { rows } = await this.client.query<{
      activities: AnalyticsActivity[];
      students: AnalyticsStudent[];
      selected: AnalyticsActivity | null;
    }>(
      `WITH available AS MATERIALIZED (
      SELECT a.id, v.version, v.title, v.published_at AS "publishedAt"
      FROM zhiban_learning.activities a JOIN zhiban_learning.activity_versions v
        ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version
      WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.status='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions q WHERE q.tenant_id=a.tenant_id AND q.activity_id=a.id AND q.mode='PRACTICE')
      ORDER BY v.published_at DESC, a.id LIMIT 501
    ), selected AS MATERIALIZED (
      SELECT * FROM available WHERE $4::uuid IS NULL OR (id=$4 AND version=$5)
      ORDER BY "publishedAt" DESC, id LIMIT 1
    ), roster AS MATERIALIZED (
      SELECT e.membership_id, p.display_name
      FROM zhiban_academic.enrollments e LEFT JOIN zhiban_academic.people p
        ON p.tenant_id=e.tenant_id AND p.membership_id=e.membership_id
      WHERE e.tenant_id=$1 AND e.offering_id=$2 AND e.status='ACTIVE'
        AND e.valid_from <= $3 AND e.valid_until IS NULL
      ORDER BY e.membership_id LIMIT 1001
    ), student_rows AS (
      SELECT r.membership_id AS "membershipId", r.display_name AS "displayName",
        a.attempt_no AS "attemptNo", s.version AS "submissionVersion", s.submitted_at AS "submittedAt",
        g.version AS "gradeVersion", g.score_points AS "scorePoints", g.max_points AS "maxPoints"
      FROM roster r
      LEFT JOIN LATERAL (
        SELECT a.id, a.attempt_no FROM zhiban_learning.attempts a JOIN selected v
          ON v.id=a.activity_id AND v.version=a.activity_version
        WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.membership_id=r.membership_id
        ORDER BY a.attempt_no DESC LIMIT 1
      ) a ON true
      LEFT JOIN LATERAL (
        SELECT s.id, s.version, s.submitted_at FROM zhiban_learning.submissions s
        WHERE s.tenant_id=$1 AND s.attempt_id=a.id ORDER BY s.version DESC LIMIT 1
      ) s ON true
      LEFT JOIN LATERAL (
        SELECT p.version, p.score_points, p.max_points FROM zhiban_assessment.publications p
        WHERE p.tenant_id=$1 AND p.submission_id=s.id ORDER BY p.version DESC LIMIT 1
      ) g ON true
    ) SELECT
      COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY "publishedAt" DESC,id) FROM available v),'[]') AS activities,
      (SELECT to_jsonb(v) FROM selected v) AS selected,
      COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY "membershipId") FROM student_rows s),'[]') AS students`,
      [
        actor.tenantId,
        offeringId,
        actor.now,
        selection?.activityId ?? null,
        selection?.version ?? null,
      ],
    );
    const data = rows[0];
    requireAcademic(data.activities.length <= 500 && data.students.length <= 1000, 'UNAVAILABLE');
    requireAcademic(selection === null || data.selected !== null, 'CONFLICT');
    // jsonb preserves epoch milliseconds (well below JS's safe integer limit).
    return {
      mode: 'TEACHER',
      offering: { id: offeringId, title: String(access.offering.name) },
      asOf: actor.now,
      activities: data.activities,
      selected: data.selected,
      students: data.students,
      summary: summarize(data.students, data.activities.length, data.selected !== null),
    };
  }
}
