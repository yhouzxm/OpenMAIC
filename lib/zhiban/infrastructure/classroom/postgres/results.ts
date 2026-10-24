import type { PoolClient } from 'pg';
import type { AcademicActor } from '../../../domain/academic/model';
import { LearningPgTransaction } from '../../learning/postgres/transaction';

// One statement snapshot, one row per dispatch. Only immutable published scores leave this query.
export async function classroomResults(
  client: PoolClient,
  actor: AcademicActor,
  offering: string,
  page: number,
) {
  const { mode } = await new LearningPgTransaction(client).access(actor, offering);
  const teacher = mode === 'TEACHER';
  const { rows } = await client.query(
    `
    SELECT d.id,d.session_id,d.kind,d.target_id,d.target_version,d.title,d.state,
      s.title AS classroom_title,s.state AS classroom_state,
      facts.entered,facts.submitted,facts.published,facts.own
    FROM zhiban_classroom.dispatches d
    JOIN zhiban_classroom.sessions s ON s.tenant_id=d.tenant_id AND s.id=d.session_id AND s.offering_id=d.offering_id
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS entered,count(sub.id)::int AS submitted,count(pub.id)::int AS published,
        ${teacher ? 'NULL::jsonb' : "coalesce(jsonb_agg(jsonb_build_object('attemptId',a.id,'submissionId',sub.id,'submissionVersion',sub.version,'score',pub.score_points,'maxPoints',pub.max_points,'gradeVersion',pub.version,'enteredAt',e.entered_at))->0,'null'::jsonb)"} AS own
      FROM zhiban_classroom.entries e
      LEFT JOIN LATERAL (
        SELECT audit.facts#>>'{result,attemptId}' AS attempt_id
        FROM zhiban_academic.audit_events audit
        WHERE audit.tenant_id=e.tenant_id AND audit.actor_id=e.membership_id
          AND audit.event_type='CLASSROOM_ENTER_TASK' AND audit.facts#>>'{result,dispatchId}'=e.dispatch_id::text
        ORDER BY audit.occurred_at,audit.id LIMIT 1
      ) binding ON true
      LEFT JOIN zhiban_learning.attempts a ON a.tenant_id=e.tenant_id AND a.id::text=binding.attempt_id
        AND a.membership_id=e.membership_id AND a.offering_id=d.offering_id
        AND d.kind='ACTIVITY' AND a.activity_id=d.target_id AND a.activity_version::text=d.target_version
      LEFT JOIN LATERAL (
        SELECT z.id,z.version FROM zhiban_learning.submissions z WHERE z.tenant_id=a.tenant_id AND z.attempt_id=a.id
        ORDER BY z.version DESC LIMIT 1
      ) sub ON true
      LEFT JOIN LATERAL (
        SELECT g.id,g.score_points,g.max_points,g.version FROM zhiban_assessment.publications g
        WHERE g.tenant_id=a.tenant_id AND g.submission_id=sub.id ORDER BY g.version DESC LIMIT 1
      ) pub ON true
      WHERE e.tenant_id=d.tenant_id AND e.dispatch_id=d.id ${teacher ? '' : 'AND e.membership_id=$3'}
    ) facts
    WHERE d.tenant_id=$1 AND d.offering_id=$2 ${teacher ? 'AND $3::uuid IS NOT NULL' : 'AND facts.entered>0'}
    ORDER BY d.created_at DESC,d.id DESC LIMIT 21 OFFSET $4
  `,
    [actor.tenantId, offering, actor.membershipId, page * 20],
  );
  return { mode, page, hasMore: rows.length > 20, rows: rows.slice(0, 20) };
}
