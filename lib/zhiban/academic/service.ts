import { randomUUID } from 'node:crypto';

import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';

import type { AcademicOverview } from './types';

async function audit(
  queryable: ZhibanQueryable,
  principal: AuthorizedPrincipal,
  action: string,
  resourceType: string,
  resourceId: string,
) {
  await queryable.query(
    `INSERT INTO zhiban.audit_log
      (tenant_id, actor_type, actor_account_id, action, resource_type, resource_id)
     VALUES ($1, 'account', $2, $3, $4, $5)`,
    [principal.tenantId, principal.id, action, resourceType, resourceId],
  );
}

export async function listAcademicOverview(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
): Promise<AcademicOverview> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const [terms, classes, courses, offerings, students, teachers, enrollments] = await Promise.all(
      [
        client.query<
          Record<string, unknown> & {
            id: string;
            code: string;
            name: string;
            starts_on: string;
            ends_on: string;
            status: string;
          }
        >(
          `SELECT id, code, name, starts_on, ends_on, status FROM zhiban.academic_terms WHERE tenant_id = $1 ORDER BY starts_on DESC`,
          [principal.tenantId],
        ),
        client.query<
          Record<string, unknown> & {
            id: string;
            term_id: string;
            code: string;
            name: string;
            head_teacher_id: string | null;
            head_teacher_name: string | null;
            member_count: string;
            status: string;
          }
        >(
          `SELECT c.id, c.term_id, c.code, c.name, c.head_teacher_id, a.display_name AS head_teacher_name, count(cm.id)::text AS member_count, c.status FROM zhiban.classes c LEFT JOIN zhiban.accounts a ON a.id = c.head_teacher_id LEFT JOIN zhiban.class_memberships cm ON cm.class_id = c.id AND cm.status = 'active' WHERE c.tenant_id = $1 GROUP BY c.id, a.display_name ORDER BY c.created_at DESC`,
          [principal.tenantId],
        ),
        client.query<
          Record<string, unknown> & {
            id: string;
            code: string;
            name: string;
            credits: string | null;
            owner_teacher_id: string | null;
            owner_teacher_name: string | null;
            status: string;
          }
        >(
          `SELECT c.id, c.code, c.name, c.credits::text, c.owner_teacher_id, a.display_name AS owner_teacher_name, c.status FROM zhiban.courses c LEFT JOIN zhiban.accounts a ON a.id = c.owner_teacher_id WHERE c.tenant_id = $1 ORDER BY c.created_at DESC`,
          [principal.tenantId],
        ),
        client.query<
          Record<string, unknown> & {
            id: string;
            course_id: string;
            course_name: string;
            term_id: string;
            term_name: string;
            class_id: string | null;
            class_name: string | null;
            code: string;
            capacity: number | null;
            enrolled_count: string;
            status: string;
          }
        >(
          `SELECT o.id, o.course_id, c.name AS course_name, o.term_id, t.name AS term_name, o.class_id, cl.name AS class_name, o.code, o.capacity, count(e.id) FILTER (WHERE e.status = 'enrolled')::text AS enrolled_count, o.status FROM zhiban.course_offerings o JOIN zhiban.courses c ON c.id = o.course_id JOIN zhiban.academic_terms t ON t.id = o.term_id LEFT JOIN zhiban.classes cl ON cl.id = o.class_id LEFT JOIN zhiban.enrollments e ON e.offering_id = o.id WHERE o.tenant_id = $1 GROUP BY o.id, c.name, t.name, cl.name ORDER BY o.created_at DESC`,
          [principal.tenantId],
        ),
        client.query<
          Record<string, unknown> & { id: string; display_name: string; identifier: string }
        >(
          `SELECT a.id, a.display_name, sp.student_no AS identifier FROM zhiban.accounts a JOIN zhiban.student_profiles sp ON sp.account_id = a.id WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL ORDER BY a.display_name`,
          [principal.tenantId],
        ),
        client.query<
          Record<string, unknown> & { id: string; display_name: string; identifier: string }
        >(
          `SELECT a.id, a.display_name, tp.employee_no AS identifier FROM zhiban.accounts a JOIN zhiban.teacher_profiles tp ON tp.account_id = a.id WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL ORDER BY a.display_name`,
          [principal.tenantId],
        ),
        client.query<
          Record<string, unknown> & {
            id: string;
            offering_id: string;
            offering_code: string;
            student_id: string;
            student_name: string;
            student_no: string;
            status: string;
            source: string;
          }
        >(
          `SELECT e.id, e.offering_id, o.code AS offering_code, e.student_id, a.display_name AS student_name, sp.student_no, e.status, e.source FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id = e.offering_id JOIN zhiban.accounts a ON a.id = e.student_id JOIN zhiban.student_profiles sp ON sp.account_id = e.student_id WHERE e.tenant_id = $1 ORDER BY e.enrolled_at DESC`,
          [principal.tenantId],
        ),
      ],
    );
    return {
      terms: terms.rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        startsOn: String(r.starts_on),
        endsOn: String(r.ends_on),
        status: r.status,
      })),
      classes: classes.rows.map((r) => ({
        id: r.id,
        termId: r.term_id,
        code: r.code,
        name: r.name,
        headTeacherId: r.head_teacher_id,
        headTeacherName: r.head_teacher_name,
        memberCount: Number(r.member_count),
        status: r.status,
      })),
      courses: courses.rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        credits: r.credits === null ? null : Number(r.credits),
        ownerTeacherId: r.owner_teacher_id,
        ownerTeacherName: r.owner_teacher_name,
        status: r.status,
      })),
      offerings: offerings.rows.map((r) => ({
        id: r.id,
        courseId: r.course_id,
        courseName: r.course_name,
        termId: r.term_id,
        termName: r.term_name,
        classId: r.class_id,
        className: r.class_name,
        code: r.code,
        capacity: r.capacity,
        enrolledCount: Number(r.enrolled_count),
        status: r.status,
      })),
      students: students.rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        identifier: r.identifier,
      })),
      teachers: teachers.rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        identifier: r.identifier,
      })),
      enrollments: enrollments.rows.map((r) => ({
        id: r.id,
        offeringId: r.offering_id,
        offeringCode: r.offering_code,
        studentId: r.student_id,
        studentName: r.student_name,
        studentNo: r.student_no,
        status: r.status,
        source: r.source,
      })),
    };
  });
}

export async function createAcademicTerm(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: { code: string; name: string; startsOn: string; endsOn: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.academic_terms (id, tenant_id, code, name, starts_on, ends_on) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, principal.tenantId, input.code, input.name, input.startsOn, input.endsOn],
    );
    await audit(client, principal, 'academic_term.created', 'academic_term', id);
    return { id };
  });
}

async function ensureScopedRole(
  queryable: ZhibanQueryable,
  principal: AuthorizedPrincipal,
  accountId: string,
  roleCode: 'head_teacher' | 'course_teacher',
  scopeType: 'class' | 'course',
  scopeId: string,
) {
  await queryable.query(
    `INSERT INTO zhiban.role_assignments (id, tenant_id, account_id, role_id, scope_type, scope_id, granted_by) SELECT $1,$2,$3,r.id,$4,$5,$6 FROM zhiban.roles r WHERE r.code=$7 AND r.tenant_id IS NULL ON CONFLICT DO NOTHING`,
    [randomUUID(), principal.tenantId, accountId, scopeType, scopeId, principal.id, roleCode],
  );
}

export async function createAcademicClass(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: { termId: string; code: string; name: string; headTeacherId?: string; capacity?: number },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const proposedId = randomUUID();
    const scope = await client.query<{ id: string }>(
      `INSERT INTO zhiban.authorization_scopes (id, tenant_id, scope_type, code, name, external_ref)
       VALUES ($1,$2,'class',$3,$4,$1::text)
       ON CONFLICT (tenant_id, scope_type, code) DO UPDATE
         SET name = EXCLUDED.name, external_ref = zhiban.authorization_scopes.id::text,
             status = 'active', updated_at = now()
       RETURNING id`,
      [proposedId, principal.tenantId, input.code, input.name],
    );
    const id = scope.rows[0]?.id ?? proposedId;
    const created = await client.query<{ head_teacher_id: string | null }>(
      `INSERT INTO zhiban.classes (id, tenant_id, term_id, code, name, head_teacher_id, capacity) SELECT $1,$2,$3,$4,$5,a.id,$7 FROM (SELECT 1) seed LEFT JOIN zhiban.accounts a ON a.id=$6 AND a.tenant_id=$2 AND a.account_type='teacher' RETURNING head_teacher_id`,
      [
        id,
        principal.tenantId,
        input.termId,
        input.code,
        input.name,
        input.headTeacherId ?? null,
        input.capacity ?? null,
      ],
    );
    if (input.headTeacherId && !created.rows[0]?.head_teacher_id)
      throw new Error('Head teacher account not found');
    if (input.headTeacherId)
      await ensureScopedRole(client, principal, input.headTeacherId, 'head_teacher', 'class', id);
    await audit(client, principal, 'class.created', 'class', id);
    return { id };
  });
}

export async function createAcademicCourse(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: {
    code: string;
    name: string;
    description?: string;
    credits?: number;
    ownerTeacherId?: string;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const proposedId = randomUUID();
    const scope = await client.query<{ id: string }>(
      `INSERT INTO zhiban.authorization_scopes (id, tenant_id, scope_type, code, name, external_ref)
       VALUES ($1,$2,'course',$3,$4,$1::text)
       ON CONFLICT (tenant_id, scope_type, code) DO UPDATE
         SET name = EXCLUDED.name, external_ref = zhiban.authorization_scopes.id::text,
             status = 'active', updated_at = now()
       RETURNING id`,
      [proposedId, principal.tenantId, input.code, input.name],
    );
    const id = scope.rows[0]?.id ?? proposedId;
    const created = await client.query<{ owner_teacher_id: string | null }>(
      `INSERT INTO zhiban.courses (id, tenant_id, code, name, description, credits, owner_teacher_id) SELECT $1,$2,$3,$4,$5,$6,a.id FROM (SELECT 1) seed LEFT JOIN zhiban.accounts a ON a.id=$7 AND a.tenant_id=$2 AND a.account_type='teacher' RETURNING owner_teacher_id`,
      [
        id,
        principal.tenantId,
        input.code,
        input.name,
        input.description ?? null,
        input.credits ?? null,
        input.ownerTeacherId ?? null,
      ],
    );
    if (input.ownerTeacherId && !created.rows[0]?.owner_teacher_id)
      throw new Error('Course owner account not found');
    if (input.ownerTeacherId)
      await ensureScopedRole(
        client,
        principal,
        input.ownerTeacherId,
        'course_teacher',
        'course',
        id,
      );
    await audit(client, principal, 'course.created', 'course', id);
    return { id };
  });
}

export async function createCourseOffering(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: {
    courseId: string;
    termId: string;
    classId?: string;
    code: string;
    capacity?: number;
    teacherId?: string;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.course_offerings (id, tenant_id, course_id, term_id, class_id, code, capacity, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'open')`,
      [
        id,
        principal.tenantId,
        input.courseId,
        input.termId,
        input.classId ?? null,
        input.code,
        input.capacity ?? null,
      ],
    );
    if (input.teacherId) {
      const teacher = await client.query<{ teacher_id: string }>(
        `INSERT INTO zhiban.teaching_assignments (id, tenant_id, offering_id, teacher_id)
         SELECT $1,$2,$3,a.id FROM zhiban.accounts a
         WHERE a.id=$4 AND a.tenant_id=$2 AND a.account_type='teacher' RETURNING teacher_id`,
        [randomUUID(), principal.tenantId, id, input.teacherId],
      );
      if (!teacher.rows[0]) throw new Error('Course teacher account not found');
      await ensureScopedRole(
        client,
        principal,
        input.teacherId,
        'course_teacher',
        'course',
        input.courseId,
      );
    }
    await audit(client, principal, 'course_offering.created', 'course_offering', id);
    return { id };
  });
}

export async function addClassMember(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: { classId: string; studentId: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const id = randomUUID();
    const result = await client.query<{ id: string }>(
      `INSERT INTO zhiban.class_memberships (id, tenant_id, class_id, student_id) SELECT $1,$2,$3,a.id FROM zhiban.accounts a WHERE a.id=$4 AND a.tenant_id=$2 AND a.account_type='student' RETURNING id`,
      [id, principal.tenantId, input.classId, input.studentId],
    );
    if (!result.rows[0]) throw new Error('Student account not found');
    await audit(client, principal, 'class_member.added', 'class', input.classId);
    return { id };
  });
}

export async function enrollStudent(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: { offeringId: string; studentId: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const id = randomUUID();
    const result = await client.query<{ id: string }>(
      `INSERT INTO zhiban.enrollments (id, tenant_id, offering_id, student_id, created_by) SELECT $1,$2,o.id,a.id,$5 FROM zhiban.course_offerings o JOIN zhiban.accounts a ON a.id=$4 AND a.tenant_id=$2 AND a.account_type='student' WHERE o.id=$3 AND o.tenant_id=$2 AND o.status IN ('open','in_progress') AND (o.capacity IS NULL OR (SELECT count(*) FROM zhiban.enrollments e WHERE e.offering_id=o.id AND e.status='enrolled') < o.capacity) RETURNING id`,
      [id, principal.tenantId, input.offeringId, input.studentId, principal.id],
    );
    if (!result.rows[0]) throw new Error('Offering unavailable, full, or student invalid');
    await audit(client, principal, 'enrollment.created', 'enrollment', id);
    return { id };
  });
}
