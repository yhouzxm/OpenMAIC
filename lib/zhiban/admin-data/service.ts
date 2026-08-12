import * as XLSX from 'xlsx';
import { randomUUID } from 'node:crypto';
import { hashLocalPassword } from '@/lib/zhiban/auth/password';
import { protectMobile } from '@/lib/zhiban/auth/pii';
import { hashLoginIdentifier, maskLoginIdentifier } from '@/lib/zhiban/auth/identifiers';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';

export type DirectoryFilters = {
  keyword?: string;
  status?: string;
  organization?: string;
  admissionTerm?: string;
  page?: number;
  pageSize?: number;
};
function paging(input: DirectoryFilters) {
  return {
    page: Math.max(1, input.page || 1),
    pageSize: Math.min(10_000, Math.max(10, input.pageSize || 20)),
  };
}
async function audit(
  c: ZhibanQueryable,
  p: AuthorizedPrincipal,
  action: string,
  id: string,
  metadata: Record<string, unknown> = {},
) {
  await c.query(
    `INSERT INTO zhiban.audit_log(tenant_id,actor_type,actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,'account',$2,$3,'account',$4,$5::jsonb)`,
    [p.tenantId, p.id, action, id, JSON.stringify(metadata)],
  );
}

export async function listDirectoryUsers(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  input: DirectoryFilters = {},
) {
  const { page, pageSize } = paging(input);
  return withZhibanTenant(pool, p.tenantId, async (c) => {
    const values = [
      p.tenantId,
      input.keyword || null,
      input.status || null,
      input.organization || null,
      pageSize,
      (page - 1) * pageSize,
    ];
    const where = `a.tenant_id=$1 AND a.deleted_at IS NULL AND ($2::text IS NULL OR a.login_name ILIKE '%'||$2||'%' OR a.display_name ILIKE '%'||$2||'%' OR a.mobile_last4=$2) AND ($3::text IS NULL OR a.status=$3) AND ($4::text IS NULL OR ou.external_id=$4 OR ou.name ILIKE '%'||$4||'%')`;
    const rows = await c.query(
      `SELECT a.id,a.login_name,a.display_name,a.account_type,a.status,a.mobile_last4,a.source_system,a.created_at,ou.external_id organization_code,ou.name organization_name,COALESCE(sp.identity_number_last4,tp.identity_number_last4) identity_last4 FROM zhiban.accounts a LEFT JOIN zhiban.organization_units ou ON ou.id=a.primary_organization_id LEFT JOIN zhiban.student_profiles sp ON sp.account_id=a.id LEFT JOIN zhiban.teacher_profiles tp ON tp.account_id=a.id WHERE ${where} ORDER BY a.created_at DESC LIMIT $5 OFFSET $6`,
      values,
    );
    const count = await c.query<{ count: number }>(
      `SELECT count(*)::int count FROM zhiban.accounts a LEFT JOIN zhiban.organization_units ou ON ou.id=a.primary_organization_id WHERE ${where}`,
      values.slice(0, 4),
    );
    return { rows: rows.rows, total: count.rows[0]?.count || 0, page, pageSize };
  });
}

export async function updateDirectoryUser(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  id: string,
  input: {
    displayName?: string;
    mobile?: string;
    status?: 'active' | 'disabled';
    password?: string;
  },
) {
  return withZhibanTenant(pool, p.tenantId, async (c) => {
    const found = (
      await c.query<{ id: string }>(
        `SELECT id FROM zhiban.accounts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [id, p.tenantId],
      )
    ).rows[0];
    if (!found) throw new Error('用户不存在');
    if (input.displayName)
      await c.query(
        `UPDATE zhiban.accounts SET display_name=$2,row_version=row_version+1,updated_at=now() WHERE id=$1`,
        [id, input.displayName],
      );
    if (input.status)
      await c.query(
        `UPDATE zhiban.accounts SET status=$2,row_version=row_version+1,updated_at=now() WHERE id=$1`,
        [id, input.status],
      );
    if (input.mobile) {
      const mobile = protectMobile(input.mobile);
      await c.query(
        `UPDATE zhiban.accounts SET mobile_encrypted=$2,mobile_lookup_hash=$3,mobile_last4=$4,mobile_verified_at=now(),row_version=row_version+1,updated_at=now() WHERE id=$1`,
        [id, mobile.encrypted, mobile.lookupHash, mobile.last4],
      );
      await c.query(
        `DELETE FROM zhiban.account_login_identifiers WHERE account_id=$1 AND identifier_type='mobile'`,
        [id],
      );
      await c.query(
        `INSERT INTO zhiban.account_login_identifiers(id,account_id,tenant_id,identifier_type,lookup_hash,display_mask,verified,source_system) VALUES($1,$2,$3,'mobile',$4,$5,true,'admin_update')`,
        [
          randomUUID(),
          id,
          p.tenantId,
          hashLoginIdentifier(input.mobile),
          maskLoginIdentifier('mobile', input.mobile),
        ],
      );
    }
    if (input.password) {
      await c.query(
        `UPDATE zhiban.password_credentials SET password_hash=$2,must_change=true,failed_attempts=0,locked_until=NULL,password_changed_at=now(),updated_at=now() WHERE account_id=$1`,
        [id, await hashLocalPassword(input.password)],
      );
      await c.query(
        `UPDATE zhiban.user_sessions SET revoked_at=now(),revoked_reason='administrator_password_reset' WHERE account_id=$1 AND revoked_at IS NULL`,
        [id],
      );
    }
    await audit(c, p, 'admin.account.updated', id, { fields: Object.keys(input) });
    return { id };
  });
}

export async function listDirectoryStudents(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  input: DirectoryFilters = {},
) {
  const { page, pageSize } = paging(input);
  return withZhibanTenant(pool, p.tenantId, async (c) => {
    const values = [
      p.tenantId,
      input.keyword || null,
      input.status || null,
      input.organization || null,
      input.admissionTerm || null,
      pageSize,
      (page - 1) * pageSize,
    ];
    const where = `sp.tenant_id=$1 AND ($2::text IS NULL OR sp.student_no ILIKE '%'||$2||'%' OR sp.real_name ILIKE '%'||$2||'%' OR sp.class_name ILIKE '%'||$2||'%') AND ($3::text IS NULL OR sp.study_status=$3 OR sp.registry_status_code=$3) AND ($4::text IS NULL OR ou.external_id=$4 OR ou.name ILIKE '%'||$4||'%') AND ($5::text IS NULL OR sp.admission_term=$5)`;
    const rows = await c.query(
      `SELECT sp.account_id id,sp.student_no,sp.real_name,sp.identity_number_last4,sp.admission_term,sp.study_status,sp.registry_status_code,sp.student_category_name,sp.program_level_name,sp.major_code,sp.major_name,sp.class_code,sp.class_name,sp.training_plan_no,a.mobile_last4,ou.external_id learning_center_code,ou.name learning_center_name FROM zhiban.student_profiles sp JOIN zhiban.accounts a ON a.id=sp.account_id LEFT JOIN zhiban.organization_units ou ON ou.id=sp.learning_center_organization_id WHERE ${where} ORDER BY sp.student_no LIMIT $6 OFFSET $7`,
      values,
    );
    const count = await c.query<{ count: number }>(
      `SELECT count(*)::int count FROM zhiban.student_profiles sp LEFT JOIN zhiban.organization_units ou ON ou.id=sp.learning_center_organization_id WHERE ${where}`,
      values.slice(0, 5),
    );
    return { rows: rows.rows, total: count.rows[0]?.count || 0, page, pageSize };
  });
}

export async function updateDirectoryStudent(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  id: string,
  input: {
    realName?: string;
    studyStatus?: 'active' | 'suspended' | 'graduated' | 'withdrawn';
    registryStatusCode?: string;
    studentCategoryName?: string;
    programLevelName?: string;
    majorCode?: string;
    majorName?: string;
    classCode?: string;
    className?: string;
    trainingPlanNo?: string;
  },
) {
  return withZhibanTenant(pool, p.tenantId, async (c) => {
    const found = (
      await c.query<{ account_id: string }>(
        `SELECT account_id FROM zhiban.student_profiles WHERE account_id=$1 AND tenant_id=$2 FOR UPDATE`,
        [id, p.tenantId],
      )
    ).rows[0];
    if (!found) throw new Error('学生不存在');
    await c.query(
      `UPDATE zhiban.student_profiles SET real_name=COALESCE($2,real_name),study_status=COALESCE($3,study_status),registry_status_code=COALESCE($4,registry_status_code),student_category_name=COALESCE($5,student_category_name),program_level_name=COALESCE($6,program_level_name),major_code=COALESCE($7,major_code),major_name=COALESCE($8,major_name),class_code=COALESCE($9,class_code),class_name=COALESCE($10,class_name),training_plan_no=COALESCE($11,training_plan_no),row_version=row_version+1,updated_at=now() WHERE account_id=$1`,
      [
        id,
        input.realName || null,
        input.studyStatus || null,
        input.registryStatusCode || null,
        input.studentCategoryName || null,
        input.programLevelName || null,
        input.majorCode || null,
        input.majorName || null,
        input.classCode || null,
        input.className || null,
        input.trainingPlanNo || null,
      ],
    );
    if (input.realName)
      await c.query(
        `UPDATE zhiban.accounts SET display_name=$2,row_version=row_version+1,updated_at=now() WHERE id=$1`,
        [id, input.realName],
      );
    await audit(c, p, 'admin.student.updated', id, { fields: Object.keys(input) });
    return { id };
  });
}

function workbook(headers: string[], rows: unknown[][], name: string) {
  const wb = XLSX.utils.book_new(),
    ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length * 2 + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, name);
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}
export async function exportDirectoryUsers(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  input: DirectoryFilters,
) {
  const result = await listDirectoryUsers(pool, p, { ...input, page: 1, pageSize: 10_000 });
  return workbook(
    [
      '所属机构',
      '姓名',
      '登录名',
      '身份',
      '手机号尾号',
      '证件号尾号',
      '注册来源',
      '状态',
      '创建时间',
    ],
    result.rows.map((r) => [
      r.organization_code || r.organization_name,
      r.display_name,
      r.login_name,
      r.account_type,
      r.mobile_last4 ? `****${r.mobile_last4}` : '',
      r.identity_last4 ? `**************${r.identity_last4}` : '',
      r.source_system,
      r.status,
      r.created_at,
    ]),
    '用户信息',
  );
}
export async function exportDirectoryStudents(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  input: DirectoryFilters,
) {
  const result = await listDirectoryStudents(pool, p, { ...input, page: 1, pageSize: 10_000 });
  return workbook(
    [
      '姓名',
      '学号',
      '证件号尾号',
      '入学年度学期',
      '学籍状态',
      '学生类别',
      '专业层次',
      '专业代码',
      '专业名称',
      '学习中心代码',
      '学习中心',
      '班级代码',
      '班级',
      '培养方案号',
      '手机号尾号',
    ],
    result.rows.map((r) => [
      r.real_name,
      r.student_no,
      r.identity_number_last4 ? `**************${r.identity_number_last4}` : '',
      r.admission_term,
      r.study_status,
      r.student_category_name,
      r.program_level_name,
      r.major_code,
      r.major_name,
      r.learning_center_code,
      r.learning_center_name,
      r.class_code,
      r.class_name,
      r.training_plan_no,
      r.mobile_last4 ? `****${r.mobile_last4}` : '',
    ]),
    '学生信息',
  );
}
