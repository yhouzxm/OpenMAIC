import type { PoolClient } from 'pg';
import type { AcademicActor } from '../../../domain/academic/model';
import type {
  FollowupPage,
  FollowupQuery,
  FollowupRow,
} from '../../../application/analytics/followups';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
export async function readFollowups(
  client: PoolClient,
  actor: AcademicActor,
  offering: string,
  q: FollowupQuery,
  casesEnabled = false,
) {
  await new LearningPgTransaction(client).access(actor, offering, 'TEACHER');
  // One snapshot for roster, current versions, latest attempts/submissions and publication pointers.
  // Neither answers, private contacts, grade drafts nor generated risk labels enter this projection.
  const { rows } = await client.query<{
    rows: FollowupRow[];
    summary: FollowupPage['summary'];
    totalMatches: number;
  }>(
    `
    WITH activities AS MATERIALIZED (
      SELECT a.id,v.version,v.title,v.deadline_at FROM zhiban_learning.activities a
      JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version
      WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.status='PUBLISHED'
        AND NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions d WHERE d.tenant_id=a.tenant_id AND d.activity_id=a.id AND d.mode='PRACTICE')
    ), roster AS MATERIALIZED (
      SELECT e.id AS enrollment_id,e.membership_id,p.display_name FROM zhiban_academic.enrollments e
      LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.membership_id
      WHERE e.tenant_id=$1 AND e.offering_id=$2 AND e.status='ACTIVE' AND e.valid_from<=$3 AND e.valid_until IS NULL
    ), pending AS MATERIALIZED (
      SELECT v.id AS "activityId",v.version,v.title,v.deadline_at AS "deadlineAt",r.membership_id AS "membershipId",r.display_name AS "displayName",
        ${casesEnabled ? `c.id AS "caseId",c.state AS "caseState",c.revision::text AS "caseRevision",` : ''}
        a.id AS "attemptId",a.attempt_no AS "attemptNo",s.id AS "submissionId",s.version AS "submissionVersion",s.submitted_at AS "submittedAt",
        CASE WHEN s.id IS NOT NULL THEN 'AWAITING_GRADE' WHEN v.deadline_at IS NOT NULL AND v.deadline_at<=$3 THEN 'OVERDUE'
          WHEN a.id IS NULL THEN 'NOT_STARTED' ELSE 'IN_PROGRESS' END AS reason
      FROM activities v CROSS JOIN roster r
      ${casesEnabled ? `LEFT JOIN zhiban_followup.cases c ON c.tenant_id=$1 AND c.offering_id=$2 AND c.enrollment_id=r.enrollment_id AND c.activity_id=v.id AND c.activity_version=v.version` : ''}
      LEFT JOIN LATERAL (
        SELECT a.id,a.attempt_no FROM zhiban_learning.attempts a
        WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.activity_id=v.id AND a.activity_version=v.version AND a.membership_id=r.membership_id
        ORDER BY a.attempt_no DESC LIMIT 1
      ) a ON true
      LEFT JOIN LATERAL (SELECT s.id,s.version,s.submitted_at FROM zhiban_learning.submissions s WHERE s.tenant_id=$1 AND s.attempt_id=a.id ORDER BY s.version DESC LIMIT 1) s ON true
      WHERE ($4='' OR strpos(lower(v.title),lower($4))>0 OR strpos(lower(coalesce(r.display_name,'')),lower($4))>0 OR r.membership_id::text=$4)
        AND NOT EXISTS(SELECT 1 FROM zhiban_assessment.publications p WHERE p.tenant_id=$1 AND p.submission_id=s.id)
    ), matches AS MATERIALIZED (
      SELECT * FROM pending WHERE $5='ALL_PENDING' OR ($5='OVERDUE' AND reason='OVERDUE')
        OR ($5='NOT_STARTED' AND "attemptId" IS NULL)
        OR ($5='IN_PROGRESS' AND "attemptId" IS NOT NULL AND "submissionId" IS NULL)
        OR ($5='AWAITING_GRADE' AND reason='AWAITING_GRADE')
    ), page AS (
      SELECT * FROM matches WHERE $6::uuid IS NULL OR ("activityId","membershipId")>($6::uuid,$7::uuid)
      ORDER BY "activityId","membershipId" LIMIT $8
    ) SELECT
      coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY "activityId","membershipId") FROM page p),'[]') AS rows,
      (SELECT count(*)::int FROM matches) AS "totalMatches",
      (SELECT jsonb_build_object('pending',count(*)::int,'overdue',count(*) FILTER(WHERE reason='OVERDUE')::int,
        'notStarted',count(*) FILTER(WHERE "attemptId" IS NULL)::int,
        'inProgress',count(*) FILTER(WHERE "attemptId" IS NOT NULL AND "submissionId" IS NULL)::int,
        'awaitingGrade',count(*) FILTER(WHERE reason='AWAITING_GRADE')::int) FROM pending) AS summary
  `,
    [
      actor.tenantId,
      offering,
      actor.now,
      q.q,
      q.state,
      q.after?.[0] ?? null,
      q.after?.[1] ?? null,
      q.limit + 1,
    ],
  );
  return { mode: 'TEACHER' as const, asOf: actor.now, ...rows[0] };
}
