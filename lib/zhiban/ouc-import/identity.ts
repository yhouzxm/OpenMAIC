import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { hashLocalPassword } from '@/lib/zhiban/auth/password';
import {
  hashLoginIdentifier,
  maskLoginIdentifier,
  type LoginIdentifierType,
} from '@/lib/zhiban/auth/identifiers';
import { protectMobile } from '@/lib/zhiban/auth/pii';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { openImport, protectIdentityNumber, sealImport } from './crypto';

type Row = Record<string, string> & { __row: string; __errors: string };
type Payload = {
  users: Row[];
  students: Row[];
  unmatchedPolicy: 'reject' | 'student' | 'teacher' | 'administrator';
};
const USERS = [
  '所属机构',
  '姓名',
  '登录名',
  '手机号',
  '邮箱',
  '证件类型',
  '证件号码',
  '身份',
  '状态',
  '创建时间',
];
const STUDENTS = [
  '学号',
  '姓名',
  '入学年度学期',
  '学籍状态代码',
  '学籍状态',
  '学生类别代码',
  '学生类别',
  '分部代码',
  '分部',
  '学院代码',
  '学院',
  '学习中心代码',
  '学习中心',
  '班级代码',
  '班级名称',
  '班主任名称',
  '专业层次代码',
  '专业层次',
  '专业名称代码',
  '专业名称',
  '培养方案号',
];
const sha = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
function parse(buffer: Buffer, headers: string[]) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: true }),
    sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
  const actual = (matrix[0] ?? []).slice(0, headers.length).map(String);
  if (actual.join('|') !== headers.join('|'))
    throw new Error(`Excel表头不符合国开模板：${headers[0]}`);
  return matrix
    .slice(1)
    .filter((r) => r.some((v) => String(v).trim()))
    .map((r, i) =>
      Object.assign(Object.fromEntries(headers.map((h, j) => [h, String(r[j] ?? '').trim()])), {
        __row: String(i + 2),
        __errors: '',
      }),
    ) as Row[];
}
function errors(user: Row, student?: Row) {
  const e: string[] = [];
  if (!user['姓名'] || !user['登录名']) e.push('姓名和登录名不能为空');
  if (!/^1\d{10}$/.test(user['手机号'])) e.push('手机号必须为11位真实号码');
  if (user['邮箱'] && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user['邮箱'])) e.push('邮箱格式无效');
  if (!/^\d{17}[0-9Xx]$/.test(user['证件号码'])) e.push('身份证号必须为18位真实号码');
  if (student && user['登录名'] !== student['学号']) e.push('学生登录名必须与学号一致');
  return e;
}
export async function validateOucIdentityImport(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  input: {
    usersName?: string;
    users?: Buffer;
    studentsName?: string;
    students?: Buffer;
    defaultOrganizationId: string;
    unmatchedPolicy: 'reject' | 'student' | 'teacher' | 'administrator';
  },
) {
  if (!input.users && !input.students) throw new Error('至少需要一个导入文件');
  const users = input.users ? parse(input.users, USERS) : [],
    students = input.students ? parse(input.students, STUDENTS) : [],
    byNo = new Map(students.map((r) => [r['学号'], r]));
  const orgs = await pool.query<{ external_id: string; name: string }>(
      `SELECT external_id,name FROM zhiban.organization_units WHERE status='active'`,
    ),
    orgSet = new Set(orgs.rows.map((r) => r.external_id)),
    orgNames = new Set(orgs.rows.map((r) => r.name));
  const existingAccounts = await withZhibanTenant(pool, p.tenantId, async (c) =>
    c.query<{ login_name: string }>(
      `SELECT login_name FROM zhiban.accounts WHERE tenant_id=$1 AND deleted_at IS NULL`,
      [p.tenantId],
    ),
  );
  const existingLogins = new Set(existingAccounts.rows.map((r) => r.login_name.toLowerCase()));
  for (const s of students) {
    const e: string[] = [];
    if (!s['学号'] || !s['学习中心代码'] || !s['班级代码'])
      e.push('学号、学习中心代码和班级代码不能为空');
    if (!input.users && s['学号'] && !existingLogins.has(s['学号'].toLowerCase()))
      e.push('学生账号不存在，请先导入用户数据');
    for (const k of ['分部代码', '学院代码', '学习中心代码'])
      if (!orgSet.has(s[k])) e.push(`${k}不存在于机构树`);
    s.__errors = e.join('；');
  }
  for (const u of users) {
    const s = byNo.get(u['登录名']);
    const e = errors(u, s);
    if (!orgSet.has(u['所属机构']) && !orgNames.has(u['所属机构']))
      e.push('所属机构必须填写有效的机构代码或机构名称');
    if (!['学生', '教师', '管理员'].includes(u['身份'])) e.push('身份必须为学生、教师或管理员');
    if (existingLogins.has(u['登录名'].toLowerCase()))
      e.push('账号已存在；为保证整批可回滚，本导入不覆盖既有账号');
    if (!s && input.unmatchedPolicy === 'reject')
      e.push('未匹配学生信息，必须指定教师或管理员策略');
    u.__errors = e.join('；');
  }
  const all = [...users, ...students],
    invalid = all.filter((r) => r.__errors);
  const id = randomUUID();
  await withZhibanTenant(pool, p.tenantId, async (c) => {
    await c.query(
      `INSERT INTO zhiban.identity_import_batches(id,tenant_id,created_by,users_file_name,users_file_sha256,students_file_name,students_file_sha256,default_organization_id,unmatched_account_policy,status,total_rows,valid_rows,invalid_rows,encrypted_payload,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb)`,
      [
        id,
        p.tenantId,
        p.id,
        input.usersName ?? '__student_only__',
        sha(input.users ?? ''),
        input.studentsName ?? null,
        input.students ? sha(input.students) : null,
        input.defaultOrganizationId || null,
        'reject',
        invalid.length ? 'invalid' : 'validated',
        all.length,
        all.length - invalid.length,
        invalid.length,
        JSON.stringify(sealImport({ users, students, unmatchedPolicy: 'reject' })),
        JSON.stringify({ users: users.length, students: students.length }),
      ],
    );
    for (const [kind, rows] of [
      ['users', users],
      ['students', students],
    ] as const)
      for (const r of rows)
        await c.query(
          `INSERT INTO zhiban.identity_import_rows(tenant_id,batch_id,source_file,row_number,business_key,source_row_hash,encrypted_source,status,errors) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)`,
          [
            p.tenantId,
            id,
            kind,
            Number(r.__row),
            r[kind === 'users' ? '登录名' : '学号'],
            sha(JSON.stringify(r)),
            JSON.stringify(sealImport(r)),
            r.__errors ? 'invalid' : 'valid',
            JSON.stringify(r.__errors ? [r.__errors] : []),
          ],
        );
  });
  return {
    batchId: id,
    totalRows: all.length,
    validRows: all.length - invalid.length,
    invalidRows: invalid.length,
    summary: { users: users.length, students: students.length },
    rows: invalid.slice(0, 200).map((r) => ({
      rowNumber: Number(r.__row),
      key: r['登录名'] || r['学号'],
      errors: r.__errors.split('；'),
    })),
  };
}
async function addIdentifier(
  c: ZhibanQueryable,
  tenantId: string,
  accountId: string,
  type: LoginIdentifierType,
  value: string,
  verified = true,
) {
  await c.query(
    `INSERT INTO zhiban.account_login_identifiers(id,account_id,tenant_id,identifier_type,lookup_hash,display_mask,verified,source_system) VALUES($1,$2,$3,$4,$5,$6,$7,'ouchn') ON CONFLICT(lookup_hash) DO UPDATE SET account_id=EXCLUDED.account_id,tenant_id=EXCLUDED.tenant_id,status='active',verified=EXCLUDED.verified,updated_at=now()`,
    [
      randomUUID(),
      accountId,
      tenantId,
      type,
      hashLoginIdentifier(value),
      maskLoginIdentifier(type, value),
      verified,
    ],
  );
}
async function ensureImportedAccountAccess(
  c: ZhibanQueryable,
  p: AuthorizedPrincipal,
  accountId: string,
  organizationId: string,
  accountType: 'student' | 'teacher' | 'admin',
) {
  await c.query(
    `INSERT INTO zhiban.tenant_organization_bindings(tenant_id,organization_id,is_primary)
     VALUES($1,$2,false) ON CONFLICT DO NOTHING`,
    [p.tenantId, organizationId],
  );
  await c.query(
    `INSERT INTO zhiban.account_organization_memberships(id,tenant_id,account_id,organization_id,membership_type,status)
     VALUES($1,$2,$3,$4,'primary','active')
     ON CONFLICT(tenant_id,account_id,organization_id,membership_type)
     DO UPDATE SET status='active',updated_at=now()`,
    [randomUUID(), p.tenantId, accountId, organizationId],
  );
  if (accountType === 'teacher') return;
  const roleCode = accountType === 'student' ? 'student' : 'institution_admin';
  const scopeType = accountType === 'student' ? 'self' : 'organization';
  await c.query(
    `INSERT INTO zhiban.role_assignments(id,tenant_id,account_id,role_id,scope_type,scope_id,granted_by)
     SELECT $1,$2,$3,r.id,$4,CASE WHEN $4='organization' THEN $5::uuid ELSE NULL END,$6
       FROM zhiban.roles r WHERE r.code=$7 AND r.tenant_id IS NULL
     ON CONFLICT(account_id,role_id,scope_type,COALESCE(scope_id,'00000000-0000-0000-0000-000000000000'::uuid))
       WHERE revoked_at IS NULL DO NOTHING`,
    [randomUUID(), p.tenantId, accountId, scopeType, organizationId, p.id, roleCode],
  );
}

export async function executeOucIdentityImport(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  batchId: string,
) {
  return withZhibanTenant(pool, p.tenantId, async (c) => {
    const b = (
      await c.query<{
        encrypted_payload: { encrypted: string };
        status: string;
        default_organization_id: string;
        unmatched_account_policy: 'reject' | 'teacher' | 'administrator';
      }>(
        `SELECT encrypted_payload,status,default_organization_id,unmatched_account_policy FROM zhiban.identity_import_batches WHERE id=$1 FOR UPDATE`,
        [batchId],
      )
    ).rows[0];
    if (!b || b.status !== 'validated') throw new Error('批次不可执行');
    const data = openImport<Payload>(b.encrypted_payload),
      students = new Map(data.students.map((r) => [r['学号'], r]));
    await c.query(
      `UPDATE zhiban.identity_import_batches SET status='running',confirmed_by=$2,confirmed_at=now() WHERE id=$1`,
      [batchId, p.id],
    );
    for (const u of data.users) {
      const s = students.get(u['登录名']);
      const type = u['身份'] === '学生' ? 'student' : u['身份'] === '管理员' ? 'admin' : 'teacher';
      const idDoc = protectIdentityNumber(u['证件号码']),
        mobile = protectMobile(u['手机号']);
      const existing = (
        await c.query<{ id: string }>(
          `SELECT id FROM zhiban.accounts WHERE tenant_id=$1 AND lower(login_name)=lower($2) AND deleted_at IS NULL`,
          [p.tenantId, u['登录名']],
        )
      ).rows[0]?.id;
      if (existing) throw new Error(`账号已存在，批次未写入：${u['登录名']}`);
      const accountId = existing ?? randomUUID();
      const orgCode = u['所属机构'] || s?.['学习中心代码'];
      const org = (
        await c.query<{ id: string }>(
          `SELECT id FROM zhiban.organization_units
            WHERE status='active' AND (external_id=$1 OR name=$1)
            ORDER BY CASE WHEN external_id=$1 THEN 0 ELSE 1 END LIMIT 1`,
          [orgCode],
        )
      ).rows[0];
      if (!org) throw new Error(`机构不存在：${orgCode}`);
      if (!existing) {
        await c.query(
          `INSERT INTO zhiban.accounts(id,tenant_id,login_name,display_name,account_type,status,mobile_encrypted,mobile_lookup_hash,mobile_last4,mobile_verified_at,primary_organization_id,source_system,source_external_id,source_created_at) VALUES($1,$2,$3,$4,$5,'active',$6,$7,$8,now(),$9,'ouchn',$3,NULLIF($10,'')::timestamptz)`,
          [
            accountId,
            p.tenantId,
            u['登录名'],
            u['姓名'],
            type,
            mobile.encrypted,
            mobile.lookupHash,
            mobile.last4,
            org.id,
            u['创建时间'],
          ],
        );
        await c.query(
          `INSERT INTO zhiban.password_credentials(account_id,password_hash,must_change) VALUES($1,$2,true)`,
          [accountId, await hashLocalPassword(`Ouchn@${idDoc.birthDate.replaceAll('-', '')}`)],
        );
      } else
        await c.query(
          `UPDATE zhiban.accounts SET display_name=$2,mobile_encrypted=$3,mobile_lookup_hash=$4,mobile_last4=$5,mobile_verified_at=now(),primary_organization_id=$6,row_version=row_version+1,updated_at=now() WHERE id=$1`,
          [accountId, u['姓名'], mobile.encrypted, mobile.lookupHash, mobile.last4, org.id],
        );
      if (type === 'student' && s)
        await c.query(
          `INSERT INTO zhiban.student_profiles(account_id,tenant_id,student_no,real_name,birth_date,identity_document_type,identity_number_encrypted,identity_number_lookup_hash,identity_number_last4,admission_term,registry_status_code,student_category_code,student_category_name,branch_organization_id,college_organization_id,learning_center_organization_id,class_code,class_name,head_teacher_name,program_level_code,program_level_name,major_code,major_name,training_plan_no,extension) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,(SELECT id FROM zhiban.organization_units WHERE external_id=$14),(SELECT id FROM zhiban.organization_units WHERE external_id=$15),(SELECT id FROM zhiban.organization_units WHERE external_id=$16),$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb) ON CONFLICT(account_id) DO UPDATE SET real_name=EXCLUDED.real_name,birth_date=EXCLUDED.birth_date,identity_number_encrypted=EXCLUDED.identity_number_encrypted,identity_number_lookup_hash=EXCLUDED.identity_number_lookup_hash,identity_number_last4=EXCLUDED.identity_number_last4,admission_term=EXCLUDED.admission_term,registry_status_code=EXCLUDED.registry_status_code,student_category_code=EXCLUDED.student_category_code,student_category_name=EXCLUDED.student_category_name,branch_organization_id=EXCLUDED.branch_organization_id,college_organization_id=EXCLUDED.college_organization_id,learning_center_organization_id=EXCLUDED.learning_center_organization_id,class_code=EXCLUDED.class_code,class_name=EXCLUDED.class_name,head_teacher_name=EXCLUDED.head_teacher_name,program_level_code=EXCLUDED.program_level_code,program_level_name=EXCLUDED.program_level_name,major_code=EXCLUDED.major_code,major_name=EXCLUDED.major_name,training_plan_no=EXCLUDED.training_plan_no,row_version=zhiban.student_profiles.row_version+1,updated_at=now()`,
          [
            accountId,
            p.tenantId,
            s['学号'],
            u['姓名'],
            idDoc.birthDate,
            u['证件类型'],
            idDoc.encrypted,
            idDoc.lookupHash,
            idDoc.last4,
            s['入学年度学期'],
            s['学籍状态代码'],
            s['学生类别代码'],
            s['学生类别'],
            s['分部代码'],
            s['学院代码'],
            s['学习中心代码'],
            s['班级代码'],
            s['班级名称'],
            s['班主任名称'],
            s['专业层次代码'],
            s['专业层次'],
            s['专业名称代码'],
            s['专业名称'],
            s['培养方案号'],
            JSON.stringify({ email: u['邮箱'] }),
          ],
        );
      else if (type === 'student')
        await c.query(
          `INSERT INTO zhiban.student_profiles(account_id,tenant_id,student_no,real_name,birth_date,identity_document_type,identity_number_encrypted,identity_number_lookup_hash,identity_number_last4,learning_center_organization_id,extension)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
           ON CONFLICT(account_id) DO UPDATE SET real_name=EXCLUDED.real_name,birth_date=EXCLUDED.birth_date,
             identity_document_type=EXCLUDED.identity_document_type,identity_number_encrypted=EXCLUDED.identity_number_encrypted,
             identity_number_lookup_hash=EXCLUDED.identity_number_lookup_hash,identity_number_last4=EXCLUDED.identity_number_last4,
             learning_center_organization_id=EXCLUDED.learning_center_organization_id,extension=EXCLUDED.extension,
             row_version=zhiban.student_profiles.row_version+1,updated_at=now()`,
          [
            accountId,
            p.tenantId,
            u['登录名'],
            u['姓名'],
            idDoc.birthDate,
            u['证件类型'],
            idDoc.encrypted,
            idDoc.lookupHash,
            idDoc.last4,
            org.id,
            JSON.stringify({ email: u['邮箱'] }),
          ],
        );
      else if (type === 'teacher')
        await c.query(
          `INSERT INTO zhiban.teacher_profiles(account_id,tenant_id,employee_no,real_name,birth_date,identity_document_type,identity_number_encrypted,identity_number_lookup_hash,identity_number_last4,organization_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(account_id) DO UPDATE SET real_name=EXCLUDED.real_name,birth_date=EXCLUDED.birth_date,identity_number_encrypted=EXCLUDED.identity_number_encrypted,identity_number_lookup_hash=EXCLUDED.identity_number_lookup_hash,identity_number_last4=EXCLUDED.identity_number_last4,organization_id=EXCLUDED.organization_id,row_version=zhiban.teacher_profiles.row_version+1,updated_at=now()`,
          [
            accountId,
            p.tenantId,
            u['登录名'],
            u['姓名'],
            idDoc.birthDate,
            u['证件类型'],
            idDoc.encrypted,
            idDoc.lookupHash,
            idDoc.last4,
            org.id,
          ],
        );
      else
        await c.query(
          `INSERT INTO zhiban.admin_profiles(account_id,tenant_id,admin_level,default_data_scope,organization_id,organization_level) SELECT $1,$2,'institution','tenant',$3,organization_level FROM zhiban.organization_units WHERE id=$3 ON CONFLICT(account_id) DO UPDATE SET organization_id=EXCLUDED.organization_id,organization_level=EXCLUDED.organization_level,row_version=zhiban.admin_profiles.row_version+1,updated_at=now()`,
          [accountId, p.tenantId, org.id],
        );
      await ensureImportedAccountAccess(c, p, accountId, org.id, type);
      await addIdentifier(c, p.tenantId, accountId, 'login_name', u['登录名']);
      await addIdentifier(c, p.tenantId, accountId, 'mobile', u['手机号']);
      await addIdentifier(
        c,
        p.tenantId,
        accountId,
        type === 'student' ? 'student_no' : type === 'teacher' ? 'employee_no' : 'admin_account',
        u['登录名'],
      );
      if (!existing)
        await c.query(
          `INSERT INTO zhiban.identity_import_changes(tenant_id,batch_id,entity_type,entity_id,operation,after_version,dependency_order) VALUES($1,$2,'account',$3,'insert',1,100)`,
          [p.tenantId, batchId, accountId],
        );
    }
    const importedUserNos = new Set(data.users.map((u) => u['登录名']));
    for (const s of data.students.filter((row) => !importedUserNos.has(row['学号']))) {
      const account = (
        await c.query<{ id: string; account_type: string }>(
          `SELECT id,account_type FROM zhiban.accounts WHERE tenant_id=$1 AND lower(login_name)=lower($2) AND deleted_at IS NULL`,
          [p.tenantId, s['学号']],
        )
      ).rows[0];
      if (!account) throw new Error(`学生账号不存在，请先导入用户数据：${s['学号']}`);
      const beforeProfile = (
        await c.query<{ data: Record<string, unknown> }>(
          `SELECT to_jsonb(sp) AS data FROM zhiban.student_profiles sp WHERE account_id=$1`,
          [account.id],
        )
      ).rows[0]?.data;
      await c.query(
        `INSERT INTO zhiban.identity_import_changes(tenant_id,batch_id,entity_type,entity_id,operation,before_data,dependency_order)
         VALUES($1,$2,'account',$3,'update',$4::jsonb,10)`,
        [p.tenantId, batchId, account.id, JSON.stringify({ account_type: account.account_type })],
      );
      await c.query(
        `INSERT INTO zhiban.identity_import_changes(tenant_id,batch_id,entity_type,entity_id,operation,before_data,dependency_order)
         VALUES($1,$2,'student_profile',$3,$4,$5::jsonb,20)`,
        [
          p.tenantId,
          batchId,
          account.id,
          beforeProfile ? 'update' : 'insert',
          beforeProfile ? JSON.stringify(beforeProfile) : null,
        ],
      );
      await c.query(
        `UPDATE zhiban.accounts SET account_type='student',updated_at=now() WHERE id=$1`,
        [account.id],
      );
      await c.query(
        `INSERT INTO zhiban.student_profiles(account_id,tenant_id,student_no,real_name,admission_term,registry_status_code,student_category_code,student_category_name,
          branch_organization_id,college_organization_id,learning_center_organization_id,class_code,class_name,head_teacher_name,program_level_code,program_level_name,major_code,major_name,training_plan_no)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,(SELECT id FROM zhiban.organization_units WHERE external_id=$9),(SELECT id FROM zhiban.organization_units WHERE external_id=$10),
          (SELECT id FROM zhiban.organization_units WHERE external_id=$11),$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT(account_id) DO UPDATE SET student_no=EXCLUDED.student_no,real_name=EXCLUDED.real_name,admission_term=EXCLUDED.admission_term,
          registry_status_code=EXCLUDED.registry_status_code,student_category_code=EXCLUDED.student_category_code,student_category_name=EXCLUDED.student_category_name,
          branch_organization_id=EXCLUDED.branch_organization_id,college_organization_id=EXCLUDED.college_organization_id,
          learning_center_organization_id=EXCLUDED.learning_center_organization_id,class_code=EXCLUDED.class_code,class_name=EXCLUDED.class_name,
          head_teacher_name=EXCLUDED.head_teacher_name,program_level_code=EXCLUDED.program_level_code,program_level_name=EXCLUDED.program_level_name,
          major_code=EXCLUDED.major_code,major_name=EXCLUDED.major_name,training_plan_no=EXCLUDED.training_plan_no,
          row_version=zhiban.student_profiles.row_version+1,updated_at=now()`,
        [
          account.id,
          p.tenantId,
          s['学号'],
          s['姓名'],
          s['入学年度学期'],
          s['学籍状态代码'],
          s['学生类别代码'],
          s['学生类别'],
          s['分部代码'],
          s['学院代码'],
          s['学习中心代码'],
          s['班级代码'],
          s['班级名称'],
          s['班主任名称'],
          s['专业层次代码'],
          s['专业层次'],
          s['专业名称代码'],
          s['专业名称'],
          s['培养方案号'],
        ],
      );
      const studentOrg = (
        await c.query<{ id: string }>(
          `SELECT id FROM zhiban.organization_units WHERE external_id=$1 AND status='active'`,
          [s['学习中心代码']],
        )
      ).rows[0];
      if (!studentOrg) throw new Error(`学习中心不存在：${s['学习中心代码']}`);
      await ensureImportedAccountAccess(c, p, account.id, studentOrg.id, 'student');
      await addIdentifier(c, p.tenantId, account.id, 'student_no', s['学号']);
    }
    await c.query(
      `UPDATE zhiban.identity_import_rows SET status=CASE WHEN status='valid' THEN 'created' ELSE status END WHERE batch_id=$1`,
      [batchId],
    );
    await c.query(
      `UPDATE zhiban.identity_import_batches SET status='completed',executed_at=now(),encrypted_payload='{}'::jsonb,updated_at=now() WHERE id=$1`,
      [batchId],
    );
    return { batchId, status: 'completed' };
  });
}
export async function rollbackOucIdentityImport(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  batchId: string,
) {
  return withZhibanTenant(pool, p.tenantId, async (c) => {
    const b = (
      await c.query<{ status: string }>(
        `SELECT status FROM zhiban.identity_import_batches WHERE id=$1 FOR UPDATE`,
        [batchId],
      )
    ).rows[0];
    if (!b || b.status !== 'completed') throw new Error('仅已完成批次可回滚');
    await c.query(`SAVEPOINT import_rollback`);
    await c.query(`UPDATE zhiban.identity_import_batches SET status='rolling_back' WHERE id=$1`, [
      batchId,
    ]);
    const changes = (
      await c.query<{ id: number; entity_type: string; entity_id: string; operation: string }>(
        `SELECT id,entity_type,entity_id,operation FROM zhiban.identity_import_changes WHERE batch_id=$1 ORDER BY dependency_order DESC,id DESC`,
        [batchId],
      )
    ).rows;
    for (const x of changes) {
      if (x.operation === 'update') {
        const before = (
          await c.query<{ before_data: Record<string, unknown> }>(
            `SELECT before_data FROM zhiban.identity_import_changes WHERE id=$1`,
            [x.id],
          )
        ).rows[0]?.before_data;
        if (x.entity_type === 'student_profile' && before) {
          await c.query(`DELETE FROM zhiban.student_profiles WHERE account_id=$1`, [x.entity_id]);
          await c.query(
            `INSERT INTO zhiban.student_profiles SELECT * FROM jsonb_populate_record(NULL::zhiban.student_profiles,$1::jsonb)`,
            [JSON.stringify(before)],
          );
        } else if (x.entity_type === 'account' && before)
          await c.query(`UPDATE zhiban.accounts SET account_type=$2,updated_at=now() WHERE id=$1`, [
            x.entity_id,
            before.account_type,
          ]);
      } else if (x.entity_type === 'student_profile')
        await c.query(`DELETE FROM zhiban.student_profiles WHERE account_id=$1`, [x.entity_id]);
      else {
        const deleted = await c.query<{ id: string }>(
          `DELETE FROM zhiban.accounts WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM zhiban.enrollments WHERE student_id=$1) RETURNING id`,
          [x.entity_id],
        );
        if (!deleted.rows.length) {
          await c.query(`ROLLBACK TO SAVEPOINT import_rollback`);
          await c.query(
            `UPDATE zhiban.identity_import_batches SET status='rollback_conflict',error_message='账号已被课程注册或后续业务引用，未执行任何删除',updated_at=now() WHERE id=$1`,
            [batchId],
          );
          return { batchId, status: 'rollback_conflict' };
        }
      }
      await c.query(`UPDATE zhiban.identity_import_changes SET rolled_back_at=now() WHERE id=$1`, [
        x.id,
      ]);
    }
    await c.query(
      `UPDATE zhiban.identity_import_rows SET status='rolled_back' WHERE batch_id=$1 AND status IN('created','updated')`,
      [batchId],
    );
    await c.query(
      `UPDATE zhiban.identity_import_batches SET status='rolled_back',rolled_back_by=$2,rolled_back_at=now(),updated_at=now() WHERE id=$1`,
      [batchId, p.id],
    );
    return { batchId, status: 'rolled_back' };
  });
}
export async function listOucIdentityBatches(pool: ZhibanDatabasePool, p: AuthorizedPrincipal) {
  return withZhibanTenant(
    pool,
    p.tenantId,
    async (c) =>
      (
        await c.query(
          `SELECT id,users_file_name,students_file_name,status,total_rows,valid_rows,invalid_rows,summary,error_message,executed_at,rolled_back_at,created_at FROM zhiban.identity_import_batches WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`,
          [p.tenantId],
        )
      ).rows,
  );
}
