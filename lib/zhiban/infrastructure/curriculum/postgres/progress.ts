import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '@/lib/zhiban/domain/academic/model';
import {
  validateRules,
  publishedThreshold,
  type CompletionRule,
} from '@/lib/zhiban/domain/progress/rules';
export async function progressBarrier(client: PoolClient, actor: AcademicActor, offering: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `progress:${actor.tenantId}:${offering}`,
  ]);
}
type Unit = { kind: string; target: string; progress?: CompletionRule };
export async function progressSnapshot(client: PoolClient, actor: AcademicActor, offering: string) {
  const row = (
    await client.query(
      'SELECT publication_no,published FROM zhiban_curriculum.outlines WHERE tenant_id=$1 AND offering_id=$2',
      [actor.tenantId, offering],
    )
  ).rows[0];
  const units: Unit[] = (row?.published ?? []).flatMap((c: { units: Unit[] }) => c.units),
    rules = validateRules(units);
  if (!rules.size)
    return {
      publicationNo: row?.publication_no ?? 0,
      configured: false,
      required: 0,
      satisfied: 0,
      rows: [] as {
        activityId: string;
        complete: boolean;
        stale: boolean;
        blockedBy: string[];
        required: boolean;
        submissionId: string | null;
        gradePublicationId: string | null;
      }[],
    };
  const facts = (
    await client.query(
      `SELECT a.id,a.status,a.published_version,t.id AS attempt_id,s.id AS submission_id,g.id AS grade_id,g.score_points,g.max_points
 FROM zhiban_learning.activities a
 LEFT JOIN zhiban_academic.enrollments e ON e.tenant_id=a.tenant_id AND e.offering_id=a.offering_id AND e.membership_id=$3 AND e.status='ACTIVE' AND e.valid_from<=$4 AND e.valid_until IS NULL
 LEFT JOIN LATERAL(SELECT id FROM zhiban_learning.attempts WHERE tenant_id=a.tenant_id AND offering_id=a.offering_id AND membership_id=$3 AND enrollment_id=e.id AND started_at>=e.valid_from AND activity_id=a.id AND activity_version=a.published_version ORDER BY attempt_no DESC LIMIT 1)t ON true
 LEFT JOIN LATERAL(SELECT id FROM zhiban_learning.submissions WHERE tenant_id=a.tenant_id AND attempt_id=t.id ORDER BY version DESC LIMIT 1)s ON true
 LEFT JOIN LATERAL(SELECT id,score_points,max_points FROM zhiban_assessment.publications WHERE tenant_id=a.tenant_id AND submission_id=s.id ORDER BY version DESC LIMIT 1)g ON true
 WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=ANY($5::uuid[])`,
      [actor.tenantId, offering, actor.membershipId, actor.now, [...rules.keys()]],
    )
  ).rows;
  const rows = [...rules].map(([id, r]) => {
    const f = facts.find((f) => f.id === id),
      stale = !f || f.status !== 'PUBLISHED' || Number(f.published_version) !== r.version;
    return {
      activityId: id,
      complete:
        !stale &&
        !!f.submission_id &&
        (r.kind === 'SUBMITTED' ||
          (!!f.grade_id && publishedThreshold(f.score_points, f.max_points, r.thresholdBps))),
      stale,
      blockedBy: [] as string[],
      required: r.required,
      submissionId: stale ? null : (f.submission_id ?? null),
      gradePublicationId: stale ? null : (f.grade_id ?? null),
    };
  });
  for (const r of rows)
    r.blockedBy = rules
      .get(r.activityId)!
      .requires.filter((id) => !rows.find((x) => x.activityId === id)?.complete);
  return {
    publicationNo: row.publication_no,
    configured: true,
    required: rows.filter((r) => r.required).length,
    satisfied: rows.filter((r) => r.required && r.complete).length,
    rows,
  };
}
export async function requireProgress(
  client: PoolClient,
  actor: AcademicActor,
  offering: string,
  target: string,
) {
  const value = await progressSnapshot(client, actor, offering),
    row = value.rows.find((r) => r.activityId === target);
  requireAcademic(!row || (!row.stale && !row.blockedBy.length), 'PROGRESS_BLOCKED');
  return { publicationNo: value.publicationNo, evidence: row ?? null, evaluated: value.rows };
}
