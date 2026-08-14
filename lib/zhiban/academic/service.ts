import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';

import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';

import type { AcademicOverview, AdministrativeClassRecord } from './types';

type AdministrativeClassRow = {
  id: string;
  admission_term: string | null;
  code: string;
  name: string;
  head_teacher_id: string | null;
  head_teacher_name: string | null;
  expected_size: number | null;
  member_count: number;
  student_category: string | null;
  branch_code: string | null;
  branch_name: string | null;
  study_center_code: string | null;
  study_center_name: string | null;
  major_code: string | null;
  major_name: string | null;
  training_plan_no: string | null;
};

export type AdministrativeClassFilters = {
  keyword?: string;
  admissionTerm?: string;
  major?: string;
  organization?: string;
  headTeacher?: string;
  page?: number;
  pageSize?: number;
};

export type AdministrativeClassInput = {
  code: string;
  name: string;
  admissionTerm: string;
  studyCenterCode: string;
  expectedSize?: number;
  studentCategory?: string;
  majorCode?: string;
  majorName?: string;
  trainingPlanNo?: string;
};

function admissionTermDates(value: string) {
  const match = value.match(/^(\d{4})(春|春季|秋|秋季)$/);
  if (!match) throw new Error('入学年度学期格式应为2026春或2026秋');
  const year = Number(match[1]),
    spring = match[2].startsWith('春');
  return {
    code: `${year}${spring ? '春' : '秋'}`,
    start: spring ? `${year}-03-01` : `${year}-09-01`,
    end: spring ? `${year}-08-31` : `${year + 1}-02-28`,
  };
}

export async function createAdministrativeClass(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: AdministrativeClassInput,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const termData = admissionTermDates(input.admissionTerm),
      organization = (
        await client.query<{ id: string; name: string }>(
          `SELECT id,name FROM zhiban.organization_units WHERE external_id=$1 AND status='active'`,
          [input.studyCenterCode],
        )
      ).rows[0];
    if (!organization) throw new Error('学习中心代码不存在');
    let term = (
      await client.query<{ id: string }>(
        `SELECT id FROM zhiban.academic_terms WHERE tenant_id=$1 AND code=$2`,
        [principal.tenantId, termData.code],
      )
    ).rows[0];
    if (!term) {
      term = { id: randomUUID() };
      await client.query(
        `INSERT INTO zhiban.academic_terms(id,tenant_id,code,name,starts_on,ends_on,status) VALUES($1,$2,$3,$3,$4,$5,'active')`,
        [term.id, principal.tenantId, termData.code, termData.start, termData.end],
      );
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.authorization_scopes(id,tenant_id,scope_type,code,name,external_ref) VALUES($1::uuid,$2::uuid,'class',$3,$4,$5::text)`,
      [id, principal.tenantId, input.code, input.name, id],
    );
    await client.query(
      `INSERT INTO zhiban.classes(id,tenant_id,term_id,code,name,capacity,expected_size,organization_id,admission_term_code,class_kind,study_center_code,study_center_name,student_category_name,major_code,major_name,training_plan_no,source_system) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,'administrative',$9,$10,NULLIF($11,''),NULLIF($12,''),NULLIF($13,''),NULLIF($14,''),'manual')`,
      [
        id,
        principal.tenantId,
        term.id,
        input.code,
        input.name,
        input.expectedSize ?? null,
        organization.id,
        termData.code,
        input.studyCenterCode,
        organization.name,
        input.studentCategory ?? '',
        input.majorCode ?? '',
        input.majorName ?? '',
        input.trainingPlanNo ?? '',
      ],
    );
    await audit(client, principal, 'class.created', 'class', id);
    return { id };
  });
}

export async function updateAdministrativeClass(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  id: string,
  input: AdministrativeClassInput,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const termData = admissionTermDates(input.admissionTerm),
      organization = (
        await client.query<{ id: string; name: string }>(
          `SELECT id,name FROM zhiban.organization_units WHERE external_id=$1 AND status='active'`,
          [input.studyCenterCode],
        )
      ).rows[0];
    if (!organization) throw new Error('学习中心代码不存在');
    let term = (
      await client.query<{ id: string }>(
        `SELECT id FROM zhiban.academic_terms WHERE tenant_id=$1 AND code=$2`,
        [principal.tenantId, termData.code],
      )
    ).rows[0];
    if (!term) {
      term = { id: randomUUID() };
      await client.query(
        `INSERT INTO zhiban.academic_terms(id,tenant_id,code,name,starts_on,ends_on,status) VALUES($1,$2,$3,$3,$4,$5,'active')`,
        [term.id, principal.tenantId, termData.code, termData.start, termData.end],
      );
    }
    const result = await client.query<{ id: string }>(
      `UPDATE zhiban.classes SET term_id=$3,code=$4,name=$5,capacity=$6,expected_size=$6,organization_id=$7,admission_term_code=$8,study_center_code=$9,study_center_name=$10,student_category_name=NULLIF($11,''),major_code=NULLIF($12,''),major_name=NULLIF($13,''),training_plan_no=NULLIF($14,''),row_version=row_version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND class_kind='administrative' RETURNING id`,
      [
        id,
        principal.tenantId,
        term.id,
        input.code,
        input.name,
        input.expectedSize ?? null,
        organization.id,
        termData.code,
        input.studyCenterCode,
        organization.name,
        input.studentCategory ?? '',
        input.majorCode ?? '',
        input.majorName ?? '',
        input.trainingPlanNo ?? '',
      ],
    );
    if (!result.rows[0]) throw new Error('行政班不存在');
    await client.query(
      `UPDATE zhiban.authorization_scopes SET code=$2,name=$3,updated_at=now() WHERE id=$1`,
      [id, input.code, input.name],
    );
    await audit(client, principal, 'class.updated', 'class', id);
    return { id };
  });
}

export async function deleteAdministrativeClasses(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  ids: string[],
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const classes = await client.query<{
      id: string;
      name: string;
      member_count: number;
      offering_count: number;
      course_class_count: number;
    }>(
      `SELECT c.id,c.name,
        (SELECT count(*)::int FROM zhiban.class_memberships cm WHERE cm.class_id=c.id) member_count,
        (SELECT count(*)::int FROM zhiban.course_offerings co WHERE co.class_id=c.id) offering_count,
        (SELECT count(*)::int FROM zhiban.course_offering_classes coc WHERE coc.class_id=c.id) course_class_count
       FROM zhiban.classes c
       WHERE c.id=ANY($1::uuid[]) AND c.tenant_id=$2 AND c.class_kind='administrative'
       FOR UPDATE`,
      [ids, principal.tenantId],
    );
    if (classes.rows.length !== ids.length) throw new Error('部分行政班不存在或无权删除');
    const detached = classes.rows.reduce(
      (result, row) => ({
        memberships: result.memberships + row.member_count,
        directOfferings: result.directOfferings + row.offering_count,
        courseClassLinks: result.courseClassLinks + row.course_class_count,
      }),
      { memberships: 0, directOfferings: 0, courseClassLinks: 0 },
    );
    await client.query(
      `DELETE FROM zhiban.class_memberships
       WHERE tenant_id=$2::uuid AND class_id=ANY($1::uuid[])`,
      [ids, principal.tenantId],
    );
    await client.query(
      `DELETE FROM zhiban.course_offering_classes
       WHERE tenant_id=$2::uuid AND class_id=ANY($1::uuid[])`,
      [ids, principal.tenantId],
    );
    await client.query(
      `UPDATE zhiban.course_offerings SET class_id=NULL,updated_at=now()
       WHERE tenant_id=$2::uuid AND class_id=ANY($1::uuid[])`,
      [ids, principal.tenantId],
    );
    await client.query(
      `UPDATE zhiban.role_assignments SET revoked_at=now()
       WHERE tenant_id=$2 AND scope_type='class' AND scope_id=ANY($1::uuid[]) AND revoked_at IS NULL`,
      [ids, principal.tenantId],
    );
    await client.query(
      `DELETE FROM zhiban.classes WHERE id=ANY($1::uuid[]) AND tenant_id=$2 AND class_kind='administrative'`,
      [ids, principal.tenantId],
    );
    await client.query(
      `DELETE FROM zhiban.authorization_scopes WHERE id=ANY($1::uuid[]) AND tenant_id=$2 AND scope_type='class'`,
      [ids, principal.tenantId],
    );
    for (const row of classes.rows)
      await audit(client, principal, 'class.deleted', 'class', row.id);
    return { deleted: classes.rows.length, ids, detached };
  });
}

export async function getAdministrativeClass(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  id: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const row = (
      await client.query<{
        id: string;
        code: string;
        name: string;
        admission_term_code: string | null;
        study_center_code: string | null;
        expected_size: number | null;
        capacity: number | null;
        member_count: number;
        student_category_name: string | null;
        major_code: string | null;
        major_name: string | null;
        training_plan_no: string | null;
      }>(
        `SELECT c.id,c.code,c.name,c.admission_term_code,c.study_center_code,c.expected_size,c.capacity,
          count(cm.id) FILTER(WHERE cm.status='active')::int member_count,c.student_category_name,
          c.major_code,c.major_name,c.training_plan_no
         FROM zhiban.classes c LEFT JOIN zhiban.class_memberships cm ON cm.class_id=c.id
         WHERE c.id=$1 AND c.tenant_id=$2 AND c.class_kind='administrative' GROUP BY c.id`,
        [id, principal.tenantId],
      )
    ).rows[0];
    if (!row) throw new Error('行政班不存在');
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      admissionTerm: row.admission_term_code,
      studyCenterCode: row.study_center_code,
      expectedSize: row.expected_size ?? row.capacity,
      memberCount: row.member_count,
      studentCategory: row.student_category_name,
      majorCode: row.major_code,
      majorName: row.major_name,
      trainingPlanNo: row.training_plan_no,
    };
  });
}

export async function exportAdministrativeClasses(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: AdministrativeClassFilters,
) {
  const result = await listAdministrativeClasses(pool, principal, {
    ...input,
    page: 1,
    pageSize: 10000,
  });
  const workbook = XLSX.utils.book_new(),
    sheet = XLSX.utils.aoa_to_sheet([
      [
        '入学年度学期',
        '班级编码',
        '班级名称',
        '班主任',
        '班级人数',
        '学生类别',
        '所属学院',
        '所属学习中心',
        '专业代码',
        '专业名称',
      ],
      ...result.rows.map((row) => [
        row.admissionTerm,
        row.code,
        row.name,
        row.headTeacherName ?? '',
        row.expectedSize ?? row.memberCount,
        row.studentCategory ?? '',
        row.branchName ?? '',
        row.studyCenterName ?? '',
        row.majorCode ?? '',
        row.majorName ?? '',
      ]),
    ]);
  XLSX.utils.book_append_sheet(workbook, sheet, '行政班级');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

export async function listAdministrativeClasses(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: AdministrativeClassFilters = {},
) {
  const page = Math.max(1, input.page || 1),
    pageSize = Math.min(10_000, Math.max(10, input.pageSize || 10));
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const values = [
      principal.tenantId,
      input.keyword || null,
      input.admissionTerm || null,
      input.major || null,
      input.organization || null,
      input.headTeacher || null,
      pageSize,
      (page - 1) * pageSize,
    ];
    const where = `c.tenant_id=$1 AND c.class_kind='administrative' AND c.status='active'
      AND ($2::text IS NULL OR c.code ILIKE '%'||$2||'%' OR c.name ILIKE '%'||$2||'%')
      AND ($3::text IS NULL OR c.admission_term_code=$3)
      AND ($4::text IS NULL OR c.major_code=$4 OR c.major_name=$4)
      AND ($5::text IS NULL OR c.branch_code=$5 OR c.study_center_code=$5)
      AND ($6::text IS NULL OR a.display_name ILIKE '%'||$6||'%')`;
    const rows = await client.query<AdministrativeClassRow>(
      `SELECT c.id,c.admission_term_code admission_term,c.code,c.name,c.head_teacher_id,a.display_name head_teacher_name,c.expected_size,count(cm.id) FILTER(WHERE cm.status='active')::int member_count,c.student_category_name student_category,c.branch_code,c.branch_name,c.study_center_code,c.study_center_name,c.major_code,c.major_name,c.training_plan_no FROM zhiban.classes c LEFT JOIN zhiban.accounts a ON a.id=c.head_teacher_id LEFT JOIN zhiban.class_memberships cm ON cm.class_id=c.id WHERE ${where} GROUP BY c.id,a.display_name ORDER BY c.admission_term_code DESC,c.code LIMIT $7 OFFSET $8`,
      values,
    );
    const total = await client.query<{ count: number }>(
      `SELECT count(*)::int count FROM zhiban.classes c LEFT JOIN zhiban.accounts a ON a.id=c.head_teacher_id WHERE ${where}`,
      values.slice(0, 6),
    );
    return {
      rows: rows.rows.map(
        (row): AdministrativeClassRecord => ({
          id: row.id,
          admissionTerm: row.admission_term,
          code: row.code,
          name: row.name,
          headTeacherId: row.head_teacher_id,
          headTeacherName: row.head_teacher_name,
          expectedSize: row.expected_size,
          memberCount: row.member_count,
          studentCategory: row.student_category,
          branchCode: row.branch_code,
          branchName: row.branch_name,
          studyCenterCode: row.study_center_code,
          studyCenterName: row.study_center_name,
          majorCode: row.major_code,
          majorName: row.major_name,
          trainingPlanNo: row.training_plan_no,
        }),
      ),
      total: total.rows[0]?.count || 0,
      page,
      pageSize,
    };
  });
}

export async function setAdministrativeClassHeadTeacher(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  classId: string,
  teacherId: string | null,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const klass = (
      await client.query<{ head_teacher_id: string | null }>(
        `SELECT head_teacher_id FROM zhiban.classes WHERE id=$1 AND tenant_id=$2 AND class_kind='administrative' AND status='active' FOR UPDATE`,
        [classId, principal.tenantId],
      )
    ).rows[0];
    if (!klass) throw new Error('行政班不存在');
    if (teacherId) {
      const teacher = (
        await client.query<{ id: string }>(
          `SELECT a.id FROM zhiban.accounts a JOIN zhiban.teacher_profiles tp ON tp.account_id=a.id WHERE a.id=$1 AND a.tenant_id=$2 AND a.status='active'`,
          [teacherId, principal.tenantId],
        )
      ).rows[0];
      if (!teacher) throw new Error('教师账号不存在或已停用');
    }
    await client.query(
      `UPDATE zhiban.classes SET head_teacher_id=$3,row_version=row_version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [classId, principal.tenantId, teacherId],
    );
    await client.query(
      `UPDATE zhiban.role_assignments ra SET revoked_at=now()
       WHERE ra.tenant_id=$1 AND ra.scope_type='class' AND ra.scope_id=$2
         AND ra.revoked_at IS NULL
         AND ra.role_id IN(SELECT id FROM zhiban.roles WHERE code='head_teacher')`,
      [principal.tenantId, classId],
    );
    if (teacherId)
      await ensureScopedRole(client, principal, teacherId, 'head_teacher', 'class', classId);
    await audit(
      client,
      principal,
      teacherId ? 'class.head_teacher.assigned' : 'class.head_teacher.removed',
      'class',
      classId,
    );
    return { id: classId, headTeacherId: teacherId };
  });
}

export async function listAdministrativeClassTeachers(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: {
    classIds: string[];
    employeeNo?: string;
    teacherName?: string;
    sameSchool: boolean;
    page?: number;
  },
) {
  const page = Math.max(1, input.page || 1),
    pageSize = 10;
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const classes = await client.query<{ id: string; organization_id: string | null }>(
      `SELECT id,organization_id FROM zhiban.classes WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND class_kind='administrative' AND status='active'`,
      [principal.tenantId, input.classIds],
    );
    if (classes.rows.length !== input.classIds.length) throw new Error('所选行政班不存在或已停用');
    const organizations = new Set(classes.rows.map((row) => row.organization_id));
    if (organizations.size !== 1) throw new Error('所选行政班属于不同学习中心，请分开安排班主任');
    const organizationId = classes.rows[0]?.organization_id ?? null;
    const values = [
      principal.tenantId,
      input.employeeNo || null,
      input.teacherName || null,
      organizationId,
      input.sameSchool,
      pageSize,
      (page - 1) * pageSize,
    ];
    const where = `a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL
      AND ($2::text IS NULL OR tp.employee_no ILIKE '%'||$2||'%')
      AND ($3::text IS NULL OR a.display_name ILIKE '%'||$3||'%')
      AND (($5::boolean=true AND tp.organization_id IS NOT DISTINCT FROM $4::uuid)
        OR ($5::boolean=false AND tp.organization_id IS DISTINCT FROM $4::uuid))`;
    const rows = await client.query<{
      id: string;
      display_name: string;
      identifier: string;
      organization_id: string | null;
      organization_code: string | null;
      organization_name: string | null;
    }>(
      `SELECT a.id,a.display_name,tp.employee_no identifier,tp.organization_id,ou.external_id organization_code,ou.name organization_name FROM zhiban.accounts a JOIN zhiban.teacher_profiles tp ON tp.account_id=a.id LEFT JOIN zhiban.organization_units ou ON ou.id=tp.organization_id WHERE ${where} ORDER BY tp.employee_no,a.display_name LIMIT $6 OFFSET $7`,
      values,
    );
    const total = await client.query<{ count: number }>(
      `SELECT count(*)::int count FROM zhiban.accounts a JOIN zhiban.teacher_profiles tp ON tp.account_id=a.id WHERE ${where}`,
      values.slice(0, 5),
    );
    return {
      rows: rows.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        identifier: row.identifier,
        organizationId: row.organization_id,
        organizationCode: row.organization_code,
        organizationName: row.organization_name,
      })),
      total: total.rows[0]?.count || 0,
      page,
      pageSize,
      organizationId,
    };
  });
}

export async function listCourseClassTeachers(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: {
    offeringIds: string[];
    employeeNo?: string;
    teacherName?: string;
    sameSchool: boolean;
    page?: number;
  },
) {
  const page = Math.max(1, input.page || 1),
    pageSize = 10;
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const offerings = await client.query<{ id: string; organization_id: string | null }>(
      `SELECT id,organization_id FROM zhiban.course_offerings WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,
      [principal.tenantId, input.offeringIds],
    );
    if (offerings.rows.length !== input.offeringIds.length) throw new Error('所选课程班不存在');
    const organizations = new Set(offerings.rows.map((row) => row.organization_id));
    if (organizations.size !== 1) throw new Error('所选课程班属于不同学习中心，请分开安排教师');
    const organizationId = offerings.rows[0]?.organization_id ?? null,
      values = [
        principal.tenantId,
        input.employeeNo || null,
        input.teacherName || null,
        organizationId,
        input.sameSchool,
        pageSize,
        (page - 1) * pageSize,
      ],
      where = `a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL AND ($2::text IS NULL OR tp.employee_no ILIKE '%'||$2||'%') AND ($3::text IS NULL OR a.display_name ILIKE '%'||$3||'%') AND (($5::boolean=true AND tp.organization_id IS NOT DISTINCT FROM $4::uuid) OR ($5::boolean=false AND tp.organization_id IS DISTINCT FROM $4::uuid))`;
    const rows = await client.query<{
        id: string;
        display_name: string;
        identifier: string;
        organization_name: string | null;
        organization_code: string | null;
      }>(
        `SELECT a.id,a.display_name,tp.employee_no identifier,ou.name organization_name,ou.external_id organization_code FROM zhiban.accounts a JOIN zhiban.teacher_profiles tp ON tp.account_id=a.id LEFT JOIN zhiban.organization_units ou ON ou.id=tp.organization_id WHERE ${where} ORDER BY tp.employee_no LIMIT $6 OFFSET $7`,
        values,
      ),
      total = await client.query<{ count: number }>(
        `SELECT count(*)::int count FROM zhiban.accounts a JOIN zhiban.teacher_profiles tp ON tp.account_id=a.id WHERE ${where}`,
        values.slice(0, 5),
      );
    return {
      rows: rows.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        identifier: row.identifier,
        organizationName: row.organization_name,
        organizationCode: row.organization_code,
      })),
      total: total.rows[0]?.count || 0,
      page,
      pageSize,
    };
  });
}

export async function assignCourseClassTeacher(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  offeringIds: string[],
  teacherId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const teacher = (
      await client.query<{ id: string }>(
        `SELECT a.id FROM zhiban.accounts a JOIN zhiban.teacher_profiles tp ON tp.account_id=a.id WHERE a.id=$1 AND a.tenant_id=$2 AND a.status='active'`,
        [teacherId, principal.tenantId],
      )
    ).rows[0];
    if (!teacher) throw new Error('教师不存在或已停用');
    for (const offeringId of offeringIds) {
      const offering = (
        await client.query<{ course_id: string }>(
          `SELECT course_id FROM zhiban.course_offerings WHERE id=$1 AND tenant_id=$2`,
          [offeringId, principal.tenantId],
        )
      ).rows[0];
      if (!offering) throw new Error('课程班不存在');
      await client.query(
        `INSERT INTO zhiban.teaching_assignments(id,tenant_id,offering_id,teacher_id,teaching_role) VALUES($1,$2,$3,$4,'primary') ON CONFLICT(offering_id,teacher_id,teaching_role) DO NOTHING`,
        [randomUUID(), principal.tenantId, offeringId, teacherId],
      );
      await ensureScopedRole(
        client,
        principal,
        teacherId,
        'course_teacher',
        'course',
        offering.course_id,
      );
      await audit(
        client,
        principal,
        'course_class.teacher.assigned',
        'course_offering',
        offeringId,
      );
    }
    return { offeringIds, teacherId };
  });
}

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
    const [terms, classes, courses, offerings, teachers] = await Promise.all([
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
        `SELECT c.id,c.code,c.name,c.credits::text,
             COALESCE(c.owner_teacher_id,assigned.teacher_id) owner_teacher_id,
             COALESCE(a.display_name,assigned.teacher_name) owner_teacher_name,c.status
           FROM zhiban.courses c
           LEFT JOIN zhiban.accounts a ON a.id=c.owner_teacher_id
           LEFT JOIN LATERAL (
             SELECT ta.teacher_id,teacher.display_name teacher_name
             FROM zhiban.course_offerings offering
             JOIN zhiban.teaching_assignments ta ON ta.offering_id=offering.id
             JOIN zhiban.accounts teacher ON teacher.id=ta.teacher_id
             WHERE offering.course_id=c.id
             ORDER BY CASE WHEN ta.teaching_role='primary' THEN 0 ELSE 1 END,ta.assigned_at,ta.teacher_id
             LIMIT 1
           ) assigned ON true
           WHERE c.tenant_id=$1 ORDER BY c.created_at DESC`,
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
          offering_name: string | null;
          capacity: number | null;
          enrolled_count: string;
          status: string;
        }
      >(
        `SELECT o.id, o.course_id, c.name AS course_name, o.term_id, t.name AS term_name, o.class_id, cl.name AS class_name, o.code,o.name offering_name, o.capacity, count(e.id) FILTER (WHERE e.status = 'enrolled')::text AS enrolled_count, o.status FROM zhiban.course_offerings o JOIN zhiban.courses c ON c.id = o.course_id JOIN zhiban.academic_terms t ON t.id = o.term_id LEFT JOIN zhiban.classes cl ON cl.id = o.class_id LEFT JOIN zhiban.enrollments e ON e.offering_id = o.id WHERE o.tenant_id = $1 GROUP BY o.id, c.name, t.name, cl.name ORDER BY o.created_at DESC`,
        [principal.tenantId],
      ),
      client.query<
        Record<string, unknown> & { id: string; display_name: string; identifier: string }
      >(
        `SELECT a.id, a.display_name, tp.employee_no AS identifier FROM zhiban.accounts a JOIN zhiban.teacher_profiles tp ON tp.account_id = a.id WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL ORDER BY a.display_name`,
        [principal.tenantId],
      ),
    ]);
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
        name: r.offering_name,
        capacity: r.capacity,
        enrolledCount: Number(r.enrolled_count),
        status: r.status,
      })),
      teachers: teachers.rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        identifier: r.identifier,
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

export async function deleteAcademicTerm(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  termId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const term = (
      await client.query<{ id: string; name: string; class_count: number; offering_count: number }>(
        `SELECT t.id,t.name,
          (SELECT count(*)::int FROM zhiban.classes c WHERE c.term_id=t.id) class_count,
          (SELECT count(*)::int FROM zhiban.course_offerings o WHERE o.term_id=t.id) offering_count
         FROM zhiban.academic_terms t
         WHERE t.id=$1::uuid AND t.tenant_id=$2::uuid
         FOR UPDATE`,
        [termId, principal.tenantId],
      )
    ).rows[0];
    if (!term) throw new Error('学期不存在或无权删除');
    if (term.class_count > 0 || term.offering_count > 0)
      throw new Error(
        `学期“${term.name}”当前关联行政班 ${term.class_count} 个、课程班 ${term.offering_count} 个，不能直接删除；请先删除或迁移这些关联数据`,
      );
    await client.query(
      `DELETE FROM zhiban.academic_terms WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [termId, principal.tenantId],
    );
    await audit(client, principal, 'academic_term.deleted', 'academic_term', termId);
    return { id: termId };
  });
}

export async function updateAcademicTerm(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  termId: string,
  input: { code: string; name: string; startsOn: string; endsOn: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const updated = await client.query<{ id: string }>(
      `UPDATE zhiban.academic_terms
       SET code=$3::text,name=$4::text,starts_on=$5::date,ends_on=$6::date,updated_at=now()
       WHERE id=$1::uuid AND tenant_id=$2::uuid RETURNING id`,
      [termId, principal.tenantId, input.code, input.name, input.startsOn, input.endsOn],
    );
    if (!updated.rows[0]) throw new Error('学期不存在或无权修改');
    await audit(client, principal, 'academic_term.updated', 'academic_term', termId);
    return { id: termId };
  });
}

export async function updateAcademicCourse(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { code: string; name: string; credits?: number; ownerTeacherId?: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const updated = await client.query<{ id: string }>(
      `UPDATE zhiban.courses
       SET code=$3::text,name=$4::text,credits=$5::numeric,owner_teacher_id=$6::uuid,updated_at=now()
       WHERE id=$1::uuid AND tenant_id=$2::uuid RETURNING id`,
      [
        courseId,
        principal.tenantId,
        input.code,
        input.name,
        input.credits ?? null,
        input.ownerTeacherId ?? null,
      ],
    );
    if (!updated.rows[0]) throw new Error('课程不存在或无权修改');
    await client.query(
      `UPDATE zhiban.authorization_scopes SET code=$3::text,name=$4::text,updated_at=now()
       WHERE id=$1::uuid AND tenant_id=$2::uuid AND scope_type='course'`,
      [courseId, principal.tenantId, input.code, input.name],
    );
    await audit(client, principal, 'course.updated', 'course', courseId);
    return { id: courseId };
  });
}

export async function deleteAcademicCourse(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const course = (
      await client.query<{
        id: string;
        name: string;
        offering_count: number;
        enrollment_count: number;
        settings_count: number;
        classroom_count: number;
        project_count: number;
      }>(
        `SELECT c.id,c.name,
          (SELECT count(*)::int FROM zhiban.course_offerings o WHERE o.course_id=c.id) offering_count,
          (SELECT count(*)::int FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE o.course_id=c.id) enrollment_count,
          (SELECT count(*)::int FROM zhiban.course_settings s WHERE s.course_id=c.id) settings_count,
          (SELECT count(*)::int FROM zhiban.course_classrooms cc WHERE cc.course_id=c.id) classroom_count,
          (SELECT count(*)::int FROM zhiban.pbl_projects p WHERE p.course_id=c.id) project_count
         FROM zhiban.courses c
         WHERE c.id=$1::uuid AND c.tenant_id=$2::uuid FOR UPDATE`,
        [courseId, principal.tenantId],
      )
    ).rows[0];
    if (!course) throw new Error('课程不存在或无权删除');
    await client.query(
      `DELETE FROM zhiban.course_offerings WHERE course_id=$1::uuid AND tenant_id=$2::uuid`,
      [courseId, principal.tenantId],
    );
    await client.query(
      `DELETE FROM zhiban.role_assignments
       WHERE tenant_id=$2::uuid AND scope_type='course' AND scope_id=$1::uuid`,
      [courseId, principal.tenantId],
    );
    await client.query(`DELETE FROM zhiban.courses WHERE id=$1::uuid AND tenant_id=$2::uuid`, [
      courseId,
      principal.tenantId,
    ]);
    await client.query(
      `DELETE FROM zhiban.authorization_scopes
       WHERE id=$1::uuid AND tenant_id=$2::uuid AND scope_type='course'`,
      [courseId, principal.tenantId],
    );
    await audit(client, principal, 'course.deleted', 'course', courseId);
    return {
      id: courseId,
      deleted: {
        offerings: course.offering_count,
        enrollments: course.enrollment_count,
        settings: course.settings_count,
        classrooms: course.classroom_count,
        projects: course.project_count,
      },
    };
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
