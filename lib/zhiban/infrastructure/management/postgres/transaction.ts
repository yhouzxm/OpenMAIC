import { managementAuditEvents } from '@/lib/zhiban/application/management/service';
import type { PoolClient } from 'pg';
import type {
  ManagementQuery,
  ManagementTransaction,
} from '@/lib/zhiban/application/management/service';
import {
  academicAdmin,
  requireAcademic,
  type AcademicActor,
} from '@/lib/zhiban/domain/academic/model';
export class ManagementPgTransaction implements ManagementTransaction {
  constructor(
    private readonly client: PoolClient,
    private readonly identity: PoolClient,
  ) {}
  private async teachers(actor: AcademicActor, q: ManagementQuery) {
    let course: string | null = q.courseId ?? null;
    let offerings: string[] = [];
    if (q.offering) {
      const row = (
        await this.client.query(
          'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
          [actor.tenantId, q.offering],
        )
      ).rows[0];
      requireAcademic(!!row, 'NOT_FOUND');
      course = row.course_id;
      offerings = [q.offering];
    } else if (course) {
      // Owner candidacy is metadata, never a teaching permission or scope conversion.
      offerings = (
        await this.client.query(
          'SELECT id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND course_id=$2 ORDER BY id LIMIT 2001',
          [actor.tenantId, course],
        )
      ).rows.map((r) => r.id);
      requireAcademic(offerings.length <= 2000, 'UNAVAILABLE');
    }
    const exact = /^[0-9a-f-]{36}$/.test(q.q);
    const profiles =
      q.q && !exact
        ? (
            await this.client.query<{ membership_id: string; display_name: string }>(
              `SELECT membership_id,display_name FROM zhiban_academic.people WHERE tenant_id=$1
       AND ($2::uuid IS NULL OR membership_id>$2) AND strpos(lower(display_name),lower($3))>0 ORDER BY membership_id LIMIT 201`,
              [actor.tenantId, q.after, q.q],
            )
          ).rows
        : null;
    if (profiles?.length === 0) return { rows: [], next: null };
    const candidates = profiles?.slice(0, 200) ?? null;
    const result = (
      await this.identity.query<{ id: string; membership_id: string; membership_status: string }>(
        `SELECT m.membership_id AS id,m.membership_id,m.status AS membership_status FROM zhiban_identity.memberships m
       WHERE m.tenant_id=$1 AND m.status='ACTIVE' AND ($2::uuid IS NULL OR m.membership_id>$2)
       AND ($4::uuid[] IS NULL OR m.membership_id=ANY($4)) AND ($5::uuid IS NULL OR m.membership_id=$5)
       AND EXISTS(SELECT 1 FROM zhiban_identity.role_grants g WHERE g.tenant_id=m.tenant_id AND g.membership_id=m.membership_id
         AND g.role_code='TEACHER' AND g.revoked_at IS NULL AND g.valid_from<=$3 AND (g.valid_until IS NULL OR g.valid_until>$3)
         AND ((g.scope_kind='TENANT' AND g.scope_id IS NULL) OR (g.scope_kind='COURSE' AND g.scope_id=$7::uuid) OR (g.scope_kind='CLASS' AND g.scope_id=ANY($8::uuid[]))))
       ORDER BY m.membership_id LIMIT $6`,
        [
          actor.tenantId,
          q.after,
          actor.now,
          candidates?.map((p) => p.membership_id) ?? null,
          exact ? q.q : null,
          q.limit + 1,
          course,
          offerings,
        ],
      )
    ).rows;
    const page = result.slice(0, q.limit);
    const names =
      profiles ??
      (page.length
        ? (
            await this.client.query<{ membership_id: string; display_name: string }>(
              'SELECT membership_id,display_name FROM zhiban_academic.people WHERE tenant_id=$1 AND membership_id=ANY($2::uuid[])',
              [actor.tenantId, page.map((row) => row.id)],
            )
          ).rows
        : []);
    const nameMap = new Map(names.map((p) => [p.membership_id, p.display_name]));
    return {
      rows: page.map((row) => ({ ...row, name: nameMap.get(row.id) ?? null })),
      next:
        result.length > q.limit
          ? page.at(-1)!.id
          : profiles && profiles.length > 200
            ? candidates!.at(-1)!.membership_id
            : null,
    };
  }
  async read(actor: AcademicActor, q: ManagementQuery) {
    requireAcademic(academicAdmin(actor), 'FORBIDDEN');
    const offering = async (id: string) => {
      const row = (
        await this.client.query(
          `SELECT o.id,o.code,o.name,o.course_id,o.term_id,o.course_version,o.capacity,o.status,o.revision,c.name AS course_name,t.name AS term_name,
        (SELECT count(*)::int FROM zhiban_academic.enrollments e WHERE e.tenant_id=o.tenant_id AND e.offering_id=o.id AND e.status='ACTIVE') AS enrolled_count
        FROM zhiban_academic.offerings o JOIN zhiban_academic.courses c ON c.tenant_id=o.tenant_id AND c.id=o.course_id JOIN zhiban_academic.terms t ON t.tenant_id=o.tenant_id AND t.id=o.term_id WHERE o.tenant_id=$1 AND o.id=$2`,
          [actor.tenantId, id],
        )
      ).rows[0];
      requireAcademic(!!row, 'NOT_FOUND');
      return row as Record<string, unknown>;
    };
    let detail: Record<string, unknown> | null = null;
    let rows: Record<string, unknown>[] = [];
    let classInfo: Record<string, unknown> | null = null;
    if (q.kind === 'class-members' || (q.kind === 'teachers' && q.classId)) {
      classInfo =
        (
          await this.client.query(
            `SELECT c.id,c.code,c.name,c.head_teacher_id,c.revision,p.display_name AS head_teacher_name
        FROM zhiban_academic.classes c LEFT JOIN zhiban_academic.people p ON p.tenant_id=c.tenant_id AND p.membership_id=c.head_teacher_id WHERE c.tenant_id=$1 AND c.id=$2`,
            [actor.tenantId, q.classId],
          )
        ).rows[0] ?? null;
      requireAcademic(!!classInfo, 'NOT_FOUND');
    }
    if (q.kind === 'history') {
      const anchor = q.after
        ? (
            await this.client.query(
              'SELECT occurred_at FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND id=$2',
              [actor.tenantId, q.after],
            )
          ).rows[0]
        : null;
      requireAcademic(!q.after || !!anchor, 'NOT_FOUND');
      const result = (
        await this.client.query(
          `SELECT a.id,a.actor_id,left(p.display_name,120) AS actor_name,a.event_type,a.occurred_at::text,
          d.target_id,d.object_code,d.object_name,m.member_id,left(subject.display_name,120) AS member_name
        FROM zhiban_academic.audit_events a
        LEFT JOIN zhiban_academic.people p ON p.tenant_id=a.tenant_id AND p.membership_id=a.actor_id
        CROSS JOIN LATERAL (SELECT
          CASE WHEN a.event_type IN ('EDIT_COURSE','PUBLISH_COURSE','ARCHIVE_COURSE','CLASS_HEAD_TEACHER','UPDATE_OFFERING','END_TEACHER','WITHDRAW','TRANSFER') THEN left(a.facts->'command'->>'id',36)
            WHEN a.event_type='CLASS_MEMBER' THEN left(a.facts->'command'->>'classId',36)
            WHEN a.event_type IN ('PREPARE_TEACHER','ASSIGN_TEACHER','ENROLL') THEN left(a.facts->'command'->>'offeringId',36) ELSE NULL END AS target_id,
          CASE WHEN a.event_type IN ('CREATE_TERM','CREATE_COURSE','CREATE_CLASS','CREATE_OFFERING') THEN left(a.facts->'command'->>'code',40) ELSE NULL END AS object_code,
          CASE WHEN a.event_type IN ('CREATE_TERM','CREATE_COURSE','EDIT_COURSE','CREATE_CLASS','CREATE_OFFERING','UPDATE_OFFERING') THEN left(a.facts->'command'->>'name',120) ELSE NULL END AS object_name,
          CASE WHEN a.event_type IN ('CLASS_MEMBER','ASSIGN_TEACHER','ENROLL') THEN a.facts->'command'->>'membershipId'
            WHEN a.event_type='CLASS_HEAD_TEACHER' THEN coalesce(a.facts->'command'->>'membershipId',a.facts->'before'->>'head_teacher_id')
            WHEN a.event_type IN ('CREATE_COURSE','EDIT_COURSE') THEN coalesce(a.facts->'command'->>'ownerMembershipId',a.facts->'before'->>'owner_membership_id')
            WHEN a.event_type IN ('END_TEACHER','WITHDRAW','TRANSFER') THEN a.facts->'before'->>'membership_id' ELSE NULL END AS member_ref
        ) d
        CROSS JOIN LATERAL (SELECT CASE WHEN lower(d.member_ref) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN lower(d.member_ref)::uuid ELSE NULL END AS member_id) m
        LEFT JOIN zhiban_academic.people subject ON subject.tenant_id=a.tenant_id AND subject.membership_id=m.member_id
        WHERE a.tenant_id=$1 AND a.event_type=ANY($2::text[])
          AND ($3='ALL' OR a.event_type=$3)
          AND ($4::bigint IS NULL OR a.occurred_at>=$4) AND ($5::bigint IS NULL OR a.occurred_at<$5)
          AND ($6::uuid IS NULL OR (a.occurred_at,a.id)<($7::bigint,$6::uuid))
          AND ($8='' OR a.id::text=$8 OR a.actor_id::text=$8 OR d.target_id=$8 OR m.member_id::text=$8
            OR strpos(lower(coalesce(subject.display_name,'')),lower($8))>0
            OR strpos(lower(coalesce(p.display_name,'')),lower($8))>0
            OR strpos(lower(coalesce(d.object_code,'')),lower($8))>0
            OR strpos(lower(coalesce(d.object_name,'')),lower($8))>0)
        ORDER BY a.occurred_at DESC,a.id DESC LIMIT $9`,
          [
            actor.tenantId,
            managementAuditEvents,
            q.event,
            q.from,
            q.through,
            q.after,
            anchor?.occurred_at ?? null,
            q.q,
            q.limit + 1,
          ],
        )
      ).rows;
      return {
        rows: result.slice(0, q.limit),
        offering: null,
        next: result.length > q.limit ? result[q.limit - 1].id : null,
      };
    }
    if (q.kind === 'owner-candidates') {
      if (q.purpose === 'EDIT_COURSE') {
        const course = (
          await this.client.query(
            'SELECT status FROM zhiban_academic.courses WHERE tenant_id=$1 AND id=$2',
            [actor.tenantId, q.courseId],
          )
        ).rows[0];
        requireAcademic(!!course, 'NOT_FOUND');
        requireAcademic(course.status !== 'ARCHIVED', 'INVALID_STATE');
      } else requireAcademic(q.purpose === 'CREATE_COURSE');
      return { ...(await this.teachers(actor, q)), offering: null };
    }
    if (q.kind === 'teachers') {
      if (q.offering) detail = await offering(q.offering);
      return { ...(await this.teachers(actor, q)), offering: detail, classInfo };
    }
    if (q.kind === 'assignments') {
      detail = await offering(q.offering!);
      rows = (
        await this.client.query(
          `SELECT a.id,a.offering_id,a.membership_id,a.status,a.valid_from,a.valid_until,a.revision,p.display_name AS name
        FROM zhiban_academic.assignments a LEFT JOIN zhiban_academic.people p ON p.tenant_id=a.tenant_id AND p.membership_id=a.membership_id
        WHERE a.tenant_id=$1 AND a.offering_id=$2 AND ($3::uuid IS NULL OR a.id>$3) AND ($4='ALL' OR a.status=$4)
        AND ($5='' OR strpos(lower(p.display_name),lower($5))>0 OR a.membership_id::text=$5) AND ($6::uuid IS NULL OR a.membership_id=$6)
        ORDER BY a.id LIMIT $7`,
          [actor.tenantId, q.offering, q.after, q.state, q.q, q.member, q.limit + 1],
        )
      ).rows;
    }
    if (q.kind === 'class-members') {
      rows = (
        await this.client.query(
          `SELECT a.id,a.class_id,a.membership_id,a.active,a.revision,p.display_name AS name
        FROM zhiban_academic.class_members a LEFT JOIN zhiban_academic.people p ON p.tenant_id=a.tenant_id AND p.membership_id=a.membership_id
        WHERE a.tenant_id=$1 AND a.class_id=$2 AND ($3::uuid IS NULL OR a.id>$3) AND ($4='ALL' OR a.active=($4='ACTIVE'))
        AND ($5='' OR strpos(lower(p.display_name),lower($5))>0 OR a.membership_id::text=$5) AND ($6::uuid IS NULL OR a.membership_id=$6)
        ORDER BY a.id LIMIT $7`,
          [actor.tenantId, q.classId, q.after, q.state, q.q, q.member, q.limit + 1],
        )
      ).rows;
    }
    // Literal substring search: user input never becomes SQL or a LIKE pattern.
    if (q.kind === 'offerings') {
      const source = q.source ? await offering(q.source) : null;
      rows = (
        await this.client.query(
          `SELECT o.id,o.code,o.name,o.course_id,o.term_id,o.course_version,o.capacity,o.status,o.revision,c.name AS course_name,t.name AS term_name,
        (SELECT count(*)::int FROM zhiban_academic.enrollments e WHERE e.tenant_id=o.tenant_id AND e.offering_id=o.id AND e.status='ACTIVE') AS enrolled_count
        FROM zhiban_academic.offerings o JOIN zhiban_academic.courses c ON c.tenant_id=o.tenant_id AND c.id=o.course_id JOIN zhiban_academic.terms t ON t.tenant_id=o.tenant_id AND t.id=o.term_id
        WHERE o.tenant_id=$1 AND ($2::uuid IS NULL OR o.id>$2) AND ($3='ALL' OR o.status=$3)
        AND ($4='' OR strpos(lower(o.name),lower($4))>0 OR strpos(lower(o.code),lower($4))>0 OR o.id::text=$4 OR strpos(lower(c.name),lower($4))>0)
        AND ($5::uuid IS NULL OR (o.id<>$5 AND o.course_id=$6 AND o.term_id=$7 AND o.status='OPEN'))
        ORDER BY o.id LIMIT $8`,
          [
            actor.tenantId,
            q.after,
            q.state,
            q.q,
            q.source,
            source?.course_id ?? null,
            source?.term_id ?? null,
            q.limit + 1,
          ],
        )
      ).rows;
    } else if (q.kind === 'enrollments') {
      detail = await offering(q.offering!);
      rows = (
        await this.client.query(
          `SELECT e.id,e.offering_id,e.membership_id,e.status,e.revision,e.valid_from,e.valid_until,p.display_name AS name
        FROM zhiban_academic.enrollments e LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.membership_id
        WHERE e.tenant_id=$1 AND e.offering_id=$2 AND ($3::uuid IS NULL OR e.id>$3) AND ($4='ALL' OR e.status=$4)
        AND ($5='' OR strpos(lower(p.display_name),lower($5))>0 OR e.membership_id::text=$5)
        AND ($6::uuid IS NULL OR e.membership_id=$6) ORDER BY e.id LIMIT $7`,
          [actor.tenantId, q.offering, q.after, q.state, q.q, q.member, q.limit + 1],
        )
      ).rows;
    }
    if (q.kind === 'courses' || q.kind === 'terms' || q.kind === 'classes') {
      // Closed source-code map: no user-provided table or projection identifiers.
      const projections = {
        courses:
          'id,code,name,description,owner_membership_id,(SELECT p.display_name FROM zhiban_academic.people p WHERE p.tenant_id=courses.tenant_id AND p.membership_id=courses.owner_membership_id) AS owner_name,status,published_version,revision',
        terms: 'id,code,name,starts_on::text,ends_on::text,revision',
        classes: 'id,code,name,head_teacher_id,revision',
      };
      rows = (
        await this.client.query(
          `SELECT ${projections[q.kind]} FROM zhiban_academic.${q.kind}
        WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id>$2)
        AND ($3='' OR strpos(lower(name),lower($3))>0 OR strpos(lower(code),lower($3))>0 OR id::text=$3)
        ${q.kind === 'courses' ? "AND ($4='ALL' OR status=$4)" : ''}
        ORDER BY id LIMIT $${q.kind === 'courses' ? 5 : 4}`,
          q.kind === 'courses'
            ? [actor.tenantId, q.after, q.q, q.state, q.limit + 1]
            : [actor.tenantId, q.after, q.q, q.limit + 1],
        )
      ).rows;
    }
    const more = rows.length > q.limit;
    rows = rows.slice(0, q.limit);
    return {
      rows,
      offering: detail,
      ...(classInfo ? { classInfo } : {}),
      next: more ? String(rows.at(-1)!.id) : null,
    };
  }
}
