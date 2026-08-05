import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';

import { hashLocalPassword } from '@/lib/zhiban/auth/password';
import { protectMobile } from '@/lib/zhiban/auth/pii';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';

import { parseImportWorkbook, type ImportRow, type ParsedImport } from './parser';

function importKey() {
  const encoded = process.env.ZHIBAN_PII_KEY;
  if (!encoded) throw new Error('ZHIBAN_PII_KEY is required for encrypted import staging');
  const master = Buffer.from(encoded, 'base64');
  if (master.length !== 32) throw new Error('ZHIBAN_PII_KEY must be a base64 encoded 32-byte key');
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'zhiban-import-payload', 32));
}

function sealPayload(payload: ParsedImport) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', importKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { encrypted: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64') };
}

function openPayload(payload: { encrypted: string }): ParsedImport {
  const packed = Buffer.from(payload.encrypted, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', importKey(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8'),
  ) as ParsedImport;
}

export async function validateImport(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  fileName: string,
  buffer: Buffer,
  mode: 'skip' | 'update',
) {
  const parsed = await parseImportWorkbook(buffer);
  const jobId = randomUUID();
  await withZhibanTenant(pool, principal.tenantId, async (client) => {
    await client.query(
      `INSERT INTO zhiban.import_jobs (id,tenant_id,created_by,file_name,status,mode,total_rows,valid_rows,invalid_rows,payload,summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)`,
      [
        jobId,
        principal.tenantId,
        principal.id,
        fileName,
        parsed.invalidRows ? 'invalid' : 'validated',
        mode,
        parsed.totalRows,
        parsed.validRows,
        parsed.invalidRows,
        JSON.stringify(sealPayload(parsed)),
        JSON.stringify(parsed.summary),
      ],
    );
    for (const row of parsed.rows)
      await client.query(
        `INSERT INTO zhiban.import_rows (tenant_id,job_id,sheet_name,row_number,row_key,status,errors) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          principal.tenantId,
          jobId,
          row.sheet,
          row.rowNumber,
          row.key,
          row.errors.length ? 'invalid' : 'valid',
          JSON.stringify(row.errors),
        ],
      );
  });
  return { jobId, ...parsed, rows: parsed.rows.filter((row) => row.errors.length).slice(0, 200) };
}

async function idBy(queryable: ZhibanQueryable, sql: string, values: unknown[]) {
  const result = await queryable.query<{ id: string }>(sql, values);
  return result.rows[0]?.id;
}

async function importAccount(
  client: ZhibanQueryable,
  tenantId: string,
  row: ImportRow,
  accountType: 'student' | 'teacher',
  mode: 'skip' | 'update',
) {
  const identifier = String(row.values[accountType === 'student' ? '学号*' : '工号*']);
  const profile = accountType === 'student' ? 'student_profiles' : 'teacher_profiles';
  const column = accountType === 'student' ? 'student_no' : 'employee_no';
  const existing = await idBy(
    client,
    `SELECT account_id AS id FROM zhiban.${profile} WHERE tenant_id=$1 AND ${column}=$2`,
    [tenantId, identifier],
  );
  if (existing) {
    if (mode === 'update')
      await client.query(
        `UPDATE zhiban.accounts SET display_name=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2`,
        [existing, tenantId, String(row.values['姓名*'])],
      );
    return existing;
  }
  const id = randomUUID();
  const mobileText = String(row.values['手机号'] ?? '');
  const mobile = mobileText ? protectMobile(mobileText) : undefined;
  await client.query(
    `INSERT INTO zhiban.accounts (id,tenant_id,login_name,display_name,account_type,status,mobile_encrypted,mobile_lookup_hash,mobile_last4) VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8)`,
    [
      id,
      tenantId,
      String(row.values['登录账号*']),
      String(row.values['姓名*']),
      accountType,
      mobile?.encrypted ?? null,
      mobile?.lookupHash ?? null,
      mobile?.last4 ?? null,
    ],
  );
  const password = String(row.values['初始密码*']);
  await client.query(
    `INSERT INTO zhiban.password_credentials (account_id,password_hash) VALUES ($1,$2)`,
    [id, await hashLocalPassword(password)],
  );
  await client.query(
    `INSERT INTO zhiban.${profile} (account_id,tenant_id,${column},real_name) VALUES ($1,$2,$3,$4)`,
    [id, tenantId, identifier, String(row.values['姓名*'])],
  );
  if (accountType === 'student')
    await client.query(
      `INSERT INTO zhiban.role_assignments (id,tenant_id,account_id,role_id,scope_type) SELECT $1,$2,$3,id,'self' FROM zhiban.roles WHERE code='student' AND tenant_id IS NULL`,
      [randomUUID(), tenantId, id],
    );
  return id;
}

async function executeRows(
  client: ZhibanQueryable,
  principal: AuthorizedPrincipal,
  parsed: ParsedImport,
  mode: 'skip' | 'update',
) {
  const rows = (sheet: string) => parsed.rows.filter((row) => row.sheet === sheet);
  const studentIds = new Map<string, string>();
  const teacherIds = new Map<string, string>();
  const assignScopedRole = async (
    accountId: string,
    roleCode: string,
    scopeType: 'class' | 'course',
    scopeId: string,
  ) =>
    client.query(
      `INSERT INTO zhiban.role_assignments (id,tenant_id,account_id,role_id,scope_type,scope_id,granted_by) SELECT $1,$2,$3,id,$4,$5,$6 FROM zhiban.roles WHERE code=$7 AND tenant_id IS NULL ON CONFLICT DO NOTHING`,
      [randomUUID(), principal.tenantId, accountId, scopeType, scopeId, principal.id, roleCode],
    );
  for (const row of rows('教师'))
    teacherIds.set(row.key, await importAccount(client, principal.tenantId, row, 'teacher', mode));
  for (const row of rows('学生'))
    studentIds.set(row.key, await importAccount(client, principal.tenantId, row, 'student', mode));
  const termIds = new Map<string, string>();
  for (const row of rows('学期')) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.academic_terms (id,tenant_id,code,name,starts_on,ends_on) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,code) DO UPDATE SET name=EXCLUDED.name,starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on,updated_at=now()`,
      [
        id,
        principal.tenantId,
        row.key,
        row.values['名称*'],
        row.values['开始日期*'],
        row.values['结束日期*'],
      ],
    );
    termIds.set(
      row.key,
      (await idBy(client, `SELECT id FROM zhiban.academic_terms WHERE tenant_id=$1 AND code=$2`, [
        principal.tenantId,
        row.key,
      ]))!,
    );
  }
  const classIds = new Map<string, string>();
  for (const row of rows('班级')) {
    const existing = await idBy(
      client,
      `SELECT id FROM zhiban.authorization_scopes WHERE tenant_id=$1 AND scope_type='class' AND code=$2`,
      [principal.tenantId, row.key],
    );
    const id = existing ?? randomUUID();
    if (!existing)
      await client.query(
        `INSERT INTO zhiban.authorization_scopes (id,tenant_id,scope_type,code,name) VALUES ($1,$2,'class',$3,$4)`,
        [id, principal.tenantId, row.key, row.values['名称*']],
      );
    const teacherId = teacherIds.get(String(row.values['班主任工号'])) ?? null;
    await client.query(
      `INSERT INTO zhiban.classes (id,tenant_id,term_id,code,name,head_teacher_id,capacity) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id,code) DO UPDATE SET name=EXCLUDED.name,term_id=EXCLUDED.term_id,head_teacher_id=EXCLUDED.head_teacher_id,capacity=EXCLUDED.capacity,updated_at=now()`,
      [
        id,
        principal.tenantId,
        termIds.get(String(row.values['学期编码*'])),
        row.key,
        row.values['名称*'],
        teacherId,
        Number(row.values['人数上限']) || null,
      ],
    );
    classIds.set(row.key, id);
    if (teacherId) await assignScopedRole(teacherId, 'head_teacher', 'class', id);
  }
  for (const row of rows('学生')) {
    const classId = classIds.get(String(row.values['班级编码']));
    if (classId)
      await client.query(
        `INSERT INTO zhiban.class_memberships (id,tenant_id,class_id,student_id) VALUES ($1,$2,$3,$4) ON CONFLICT (class_id,student_id) DO NOTHING`,
        [randomUUID(), principal.tenantId, classId, studentIds.get(row.key)],
      );
  }
  const courseIds = new Map<string, string>();
  for (const row of rows('课程')) {
    const existing = await idBy(
      client,
      `SELECT id FROM zhiban.authorization_scopes WHERE tenant_id=$1 AND scope_type='course' AND code=$2`,
      [principal.tenantId, row.key],
    );
    const id = existing ?? randomUUID();
    if (!existing)
      await client.query(
        `INSERT INTO zhiban.authorization_scopes (id,tenant_id,scope_type,code,name) VALUES ($1,$2,'course',$3,$4)`,
        [id, principal.tenantId, row.key, row.values['名称*']],
      );
    const owner = teacherIds.get(String(row.values['负责人教师工号'])) ?? null;
    await client.query(
      `INSERT INTO zhiban.courses (id,tenant_id,code,name,credits,owner_teacher_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,code) DO UPDATE SET name=EXCLUDED.name,credits=EXCLUDED.credits,owner_teacher_id=EXCLUDED.owner_teacher_id,updated_at=now()`,
      [
        id,
        principal.tenantId,
        row.key,
        row.values['名称*'],
        Number(row.values['学分']) || null,
        owner,
      ],
    );
    courseIds.set(row.key, id);
    if (owner) await assignScopedRole(owner, 'course_teacher', 'course', id);
  }
  const offeringIds = new Map<string, string>();
  for (const row of rows('开课班')) {
    const id = randomUUID();
    const courseId = courseIds.get(String(row.values['课程编码*']))!;
    await client.query(
      `INSERT INTO zhiban.course_offerings (id,tenant_id,course_id,term_id,class_id,code,capacity,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'open') ON CONFLICT (tenant_id,code) DO UPDATE SET course_id=EXCLUDED.course_id,term_id=EXCLUDED.term_id,class_id=EXCLUDED.class_id,capacity=EXCLUDED.capacity,updated_at=now()`,
      [
        id,
        principal.tenantId,
        courseId,
        termIds.get(String(row.values['学期编码*'])),
        classIds.get(String(row.values['班级编码'])) ?? null,
        row.key,
        Number(row.values['容量']) || null,
      ],
    );
    const offeringId = (await idBy(
      client,
      `SELECT id FROM zhiban.course_offerings WHERE tenant_id=$1 AND code=$2`,
      [principal.tenantId, row.key],
    ))!;
    offeringIds.set(row.key, offeringId);
    const teacher = teacherIds.get(String(row.values['任课教师工号']));
    if (teacher) {
      await client.query(
        `INSERT INTO zhiban.teaching_assignments (id,tenant_id,offering_id,teacher_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [randomUUID(), principal.tenantId, offeringId, teacher],
      );
      await assignScopedRole(teacher, 'course_teacher', 'course', courseId);
    }
  }
  for (const row of rows('选课'))
    await client.query(
      `INSERT INTO zhiban.enrollments (id,tenant_id,offering_id,student_id,source,created_by) VALUES ($1,$2,$3,$4,'import',$5) ON CONFLICT (offering_id,student_id) DO NOTHING`,
      [
        randomUUID(),
        principal.tenantId,
        offeringIds.get(String(row.values['开课编码*'])),
        studentIds.get(String(row.values['学生学号*'])),
        principal.id,
      ],
    );
}

export async function executeImport(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  jobId: string,
) {
  try {
    return await withZhibanTenant(pool, principal.tenantId, async (client) => {
      const result = await client.query<
        Record<string, unknown> & {
          payload: { encrypted: string };
          mode: 'skip' | 'update';
          status: string;
        }
      >(
        `SELECT payload,mode,status FROM zhiban.import_jobs WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [jobId, principal.tenantId],
      );
      const job = result.rows[0];
      if (!job || job.status !== 'validated')
        throw new Error('Import job is missing or not executable');
      const parsed = openPayload(job.payload);
      await client.query(`UPDATE zhiban.import_jobs SET status='running' WHERE id=$1`, [jobId]);
      await executeRows(client, principal, parsed, job.mode);
      await client.query(
        `UPDATE zhiban.import_jobs SET status='completed',executed_at=now(),payload='{}'::jsonb WHERE id=$1`,
        [jobId],
      );
      await client.query(
        `UPDATE zhiban.import_rows SET status='created' WHERE job_id=$1 AND status='valid'`,
        [jobId],
      );
      await client.query(
        `INSERT INTO zhiban.audit_log (tenant_id,actor_type,actor_account_id,action,resource_type,resource_id,metadata) VALUES ($1,'account',$2,'bulk_import.completed','import_job',$3,$4::jsonb)`,
        [principal.tenantId, principal.id, jobId, JSON.stringify({ totalRows: parsed.totalRows })],
      );
      return { jobId, status: 'completed' };
    });
  } catch (error) {
    await withZhibanTenant(pool, principal.tenantId, (client) =>
      client.query(`UPDATE zhiban.import_jobs SET status='failed',error_message=$2 WHERE id=$1`, [
        jobId,
        error instanceof Error ? error.message : 'Import failed',
      ]),
    );
    throw error;
  }
}

export async function listImportJobs(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal) {
  return withZhibanTenant(
    pool,
    principal.tenantId,
    async (client) =>
      (
        await client.query(
          `SELECT id,file_name,status,mode,total_rows,valid_rows,invalid_rows,summary,error_message,executed_at,created_at FROM zhiban.import_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`,
          [principal.tenantId],
        )
      ).rows,
  );
}
