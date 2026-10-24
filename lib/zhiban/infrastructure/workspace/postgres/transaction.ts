import type { PoolClient } from 'pg';
import type {
  WorkspaceQuery,
  WorkspaceTransaction,
} from '@/lib/zhiban/application/workspace/service';
import { academicStudent, type AcademicActor } from '@/lib/zhiban/domain/academic/model';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
export class WorkspacePgTransaction implements WorkspaceTransaction {
  constructor(private readonly client: PoolClient) {}
  async read(actor: AcademicActor, q: WorkspaceQuery) {
    let rows: Record<string, unknown>[];
    if (q.kind === 'teachers') {
      // Teaching relationship facts only, not colleagues' Identity grants or effective authorization.
      // The canonical access check locks the caller's current assignment and course before reading.
      await new LearningPgTransaction(this.client).access(actor, q.offering!, 'TEACHER');
      rows = (
        await this.client.query(
          `SELECT a.id,p.display_name AS name,a.valid_from
         FROM zhiban_academic.assignments a
         LEFT JOIN zhiban_academic.people p ON p.tenant_id=a.tenant_id AND p.membership_id=a.membership_id
         WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.status='ACTIVE' AND a.valid_from<=$3 AND a.valid_until IS NULL
         AND ($4::uuid IS NULL OR a.id>$4)
         AND ($5='' OR strpos(lower(p.display_name),lower($5))>0)
         ORDER BY a.id LIMIT $6`,
          [actor.tenantId, q.offering, actor.now, q.after, q.q, q.limit + 1],
        )
      ).rows;
    } else if (q.kind === 'roster') {
      // Reuse the canonical per-resource access/locking rule; a course-list row never grants access.
      await new LearningPgTransaction(this.client).access(actor, q.offering!, 'TEACHER');
      rows = (
        await this.client.query(
          `SELECT e.id,e.membership_id,p.display_name AS name FROM zhiban_academic.enrollments e
       LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.membership_id
       WHERE e.tenant_id=$1 AND e.offering_id=$2 AND e.status='ACTIVE' AND e.valid_from<=$3 AND e.valid_until IS NULL
       AND ($4::uuid IS NULL OR e.id>$4) AND ($5='' OR strpos(lower(p.display_name),lower($5))>0 OR e.membership_id::text=$5)
       ORDER BY e.id LIMIT $6`,
          [actor.tenantId, q.offering, actor.now, q.after, q.q, q.limit + 1],
        )
      ).rows;
    } else {
      const scopes = actor.grants
        .filter(
          (g) =>
            g.roleCode === 'TEACHER' &&
            g.validFrom <= actor.now &&
            (g.validUntil === null || g.validUntil > actor.now),
        )
        .map((g) => ({ kind: g.scopeKind, id: g.scopeId }));
      // Server-locked role facts only. Scope/relationship filtering happens before LIMIT.
      rows = (
        await this.client.query(
          `WITH visible AS (
       SELECT o.*,cv.name AS course_name,cv.description AS course_description,t.name AS term_name,
        (EXISTS(SELECT 1 FROM jsonb_to_recordset($4::jsonb) AS g(kind text,id uuid)
          WHERE (g.kind='TENANT' AND g.id IS NULL) OR (g.kind='COURSE' AND g.id=o.course_id) OR (g.kind='CLASS' AND g.id=o.id))
         AND EXISTS(SELECT 1 FROM zhiban_academic.assignments a WHERE a.tenant_id=o.tenant_id AND a.offering_id=o.id AND a.membership_id=$2 AND a.status='ACTIVE' AND a.valid_from<=$3 AND a.valid_until IS NULL)) AS teacher,
        ($5::boolean AND EXISTS(SELECT 1 FROM zhiban_academic.enrollments e WHERE e.tenant_id=o.tenant_id AND e.offering_id=o.id AND e.membership_id=$2 AND e.status='ACTIVE' AND e.valid_from<=$3 AND e.valid_until IS NULL)) AS student
       FROM zhiban_academic.offerings o JOIN zhiban_academic.courses c ON c.tenant_id=o.tenant_id AND c.id=o.course_id AND c.status<>'ARCHIVED'
       JOIN zhiban_academic.course_versions cv ON cv.tenant_id=o.tenant_id AND cv.id=o.course_id AND cv.version=o.course_version
       JOIN zhiban_academic.terms t ON t.tenant_id=o.tenant_id AND t.id=o.term_id
       WHERE o.tenant_id=$1 AND ($6::uuid IS NULL OR o.id>$6) AND ($7='ALL' OR o.status=$7)
       AND ($8='' OR strpos(lower(o.name),lower($8))>0 OR strpos(lower(o.code),lower($8))>0 OR strpos(lower(cv.name),lower($8))>0 OR strpos(lower(t.name),lower($8))>0 OR o.id::text=$8)
     ) SELECT v.id,v.code,v.name,v.capacity,v.status,v.revision::text,v.course_id,v.course_version,v.course_name,v.course_description,v.term_name,
       CASE WHEN v.teacher THEN 'TEACHER' ELSE 'STUDENT' END AS mode,
       (SELECT count(*)::int FROM zhiban_academic.enrollments e WHERE e.tenant_id=$1 AND e.offering_id=v.id AND e.status='ACTIVE') AS enrolled_count
       FROM visible v WHERE v.teacher OR v.student ORDER BY v.id LIMIT $9`,
          [
            actor.tenantId,
            actor.membershipId,
            actor.now,
            JSON.stringify(scopes),
            academicStudent(actor),
            q.after,
            q.state,
            q.q,
            q.limit + 1,
          ],
        )
      ).rows;
    }
    const more = rows.length > q.limit;
    rows = rows.slice(0, q.limit);
    return { rows, next: more ? String(rows.at(-1)!.id) : null };
  }
}
