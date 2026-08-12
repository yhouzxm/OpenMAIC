import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { openImport, sealImport } from './crypto';

type Row = Record<string, string> & { __row: string; __errors: string };
const HEADERS = [
  '学生入学学期',
  '选课年度学期',
  '学院名称',
  '学习中心名称',
  '学习中心代码',
  '专业层次',
  '专业',
  '学生类别',
  '学号',
  '姓名',
  '课程ID',
  '课程名称',
  '班主任工号',
  '班主任姓名',
  '班级名称',
  '学分',
  '学时',
  '考试单位',
  '课程类型',
  '课程性质',
  '建议开设学期',
  '修读类型',
  '选课次数',
  '注册时间',
  '注册操作人',
  '是否转报考',
  '选课状态',
  '是否确认',
  '确认时间',
  '确认操作人',
  '缴费状态',
  '备注',
];
const sha = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
function parse(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' }),
    m = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      raw: false,
      defval: '',
    });
  if ((m[0] ?? []).slice(0, HEADERS.length).map(String).join('|') !== HEADERS.join('|'))
    throw new Error('学生课程注册明细表头不符合模板');
  return m
    .slice(1)
    .filter((r) => r.some((v) => String(v).trim()))
    .map((r, i) =>
      Object.assign(Object.fromEntries(HEADERS.map((h, j) => [h, String(r[j] ?? '').trim()])), {
        __row: String(i + 2),
        __errors: '',
      }),
    ) as Row[];
}
export async function validateCourseRegistrationImport(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  input: { fileName: string; buffer: Buffer; defaultOrganizationId?: string },
) {
  const rows = parse(input.buffer),
    students = await withZhibanTenant(
      pool,
      p.tenantId,
      async (c) =>
        (
          await c.query<{ student_no: string }>(
            `SELECT student_no FROM zhiban.student_profiles WHERE tenant_id=$1`,
            [p.tenantId],
          )
        ).rows,
    ),
    studentSet = new Set(students.map((x) => x.student_no)),
    orgs = await pool.query<{ external_id: string }>(
      `SELECT external_id FROM zhiban.organization_units WHERE status='active'`,
    ),
    orgSet = new Set(orgs.rows.map((x) => x.external_id));
  for (const r of rows) {
    const e: string[] = [];
    for (const k of ['选课年度学期', '学习中心代码', '学号', '课程ID', '课程名称', '班级名称'])
      if (!r[k]) e.push(`${k}不能为空`);
    if (!studentSet.has(r['学号'])) e.push('学号尚未导入身份库');
    if (!orgSet.has(r['学习中心代码'])) e.push('学习中心代码不存在');
    if (!/^\d+(\.\d+)?$/.test(r['学分'])) e.push('学分格式无效');
    r.__errors = e.join('；');
  }
  const invalid = rows.filter((r) => r.__errors),
    id = randomUUID();
  await withZhibanTenant(pool, p.tenantId, async (c) => {
    await c.query(
      `INSERT INTO zhiban.academic_import_batches(id,tenant_id,created_by,import_type,file_name,file_sha256,default_organization_id,status,total_rows,valid_rows,invalid_rows,encrypted_payload,summary) VALUES($1,$2,$3,'course_registration',$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
      [
        id,
        p.tenantId,
        p.id,
        input.fileName,
        sha(input.buffer),
        input.defaultOrganizationId || null,
        invalid.length ? 'invalid' : 'validated',
        rows.length,
        rows.length - invalid.length,
        invalid.length,
        JSON.stringify(sealImport(rows)),
        JSON.stringify({ registrations: rows.length }),
      ],
    );
    for (const r of rows)
      await c.query(
        `INSERT INTO zhiban.academic_import_rows(tenant_id,batch_id,row_number,business_key,source_row_hash,encrypted_source,status,errors) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)`,
        [
          p.tenantId,
          id,
          Number(r.__row),
          [r['学习中心代码'], r['选课年度学期'], r['学号'], r['课程ID']].join('|'),
          sha(JSON.stringify(r)),
          JSON.stringify(sealImport(r)),
          r.__errors ? 'invalid' : 'valid',
          JSON.stringify(r.__errors ? [r.__errors] : []),
        ],
      );
  });
  return {
    batchId: id,
    totalRows: rows.length,
    validRows: rows.length - invalid.length,
    invalidRows: invalid.length,
    summary: { registrations: rows.length },
    rows: invalid.slice(0, 200).map((r) => ({
      rowNumber: Number(r.__row),
      key: `${r['学号']}|${r['课程ID']}`,
      errors: r.__errors.split('；'),
    })),
  };
}
function termDates(name: string) {
  const m = name.match(/(\d{4})(春季|秋季)/);
  if (!m) throw new Error(`无法识别学期：${name}`);
  const y = Number(m[1]);
  return m[2] === '春季'
    ? { start: `${y}-03-01`, end: `${y}-08-31` }
    : { start: `${y}-09-01`, end: `${y + 1}-02-28` };
}
async function change(
  c: ZhibanQueryable,
  p: AuthorizedPrincipal,
  batch: string,
  rowId: number | undefined,
  type: string,
  id: string,
  order: number,
) {
  await c.query(
    `INSERT INTO zhiban.academic_import_changes(tenant_id,batch_id,import_row_id,entity_type,entity_id,operation,after_version,dependency_order) VALUES($1,$2,$3,$4,$5,'insert',1,$6)`,
    [p.tenantId, batch, rowId ?? null, type, id, order],
  );
}
export async function executeCourseRegistrationImport(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  batchId: string,
) {
  return withZhibanTenant(pool, p.tenantId, async (c) => {
    const b = (
      await c.query<{ encrypted_payload: { encrypted: string }; status: string }>(
        `SELECT encrypted_payload,status FROM zhiban.academic_import_batches WHERE id=$1 FOR UPDATE`,
        [batchId],
      )
    ).rows[0];
    if (!b || b.status !== 'validated') throw new Error('批次不可执行');
    const rows = openImport<Row[]>(b.encrypted_payload);
    await c.query(
      `UPDATE zhiban.academic_import_batches SET status='running',confirmed_by=$2,confirmed_at=now() WHERE id=$1`,
      [batchId, p.id],
    );
    for (const r of rows) {
      const rowId = (
        await c.query<{ id: number }>(
          `SELECT id FROM zhiban.academic_import_rows WHERE batch_id=$1 AND row_number=$2`,
          [batchId, Number(r.__row)],
        )
      ).rows[0]?.id;
      const org = (
        await c.query<{ id: string }>(
          `SELECT id FROM zhiban.organization_units WHERE external_id=$1`,
          [r['学习中心代码']],
        )
      ).rows[0];
      const student = (
        await c.query<{ account_id: string }>(
          `SELECT account_id FROM zhiban.student_profiles WHERE tenant_id=$1 AND student_no=$2`,
          [p.tenantId, r['学号']],
        )
      ).rows[0];
      if (!org || !student) throw new Error(`第${r.__row}行机构或学生不存在`);
      const dates = termDates(r['选课年度学期']);
      let term = (
        await c.query<{ id: string }>(
          `SELECT id FROM zhiban.academic_terms WHERE tenant_id=$1 AND code=$2`,
          [p.tenantId, r['选课年度学期']],
        )
      ).rows[0];
      if (!term) {
        term = { id: randomUUID() };
        await c.query(
          `INSERT INTO zhiban.academic_terms(id,tenant_id,code,name,starts_on,ends_on,status) VALUES($1,$2,$3,$3,$4,$5,'active')`,
          [term.id, p.tenantId, r['选课年度学期'], dates.start, dates.end],
        );
        await change(c, p, batchId, rowId, 'academic_term', term.id, 10);
      }
      let program = (
        await c.query<{ id: string }>(
          `SELECT id FROM zhiban.academic_programs WHERE tenant_id=$1 AND organization_id=$2 AND name=$3 AND program_level=$4 AND student_category IS NOT DISTINCT FROM NULLIF($5,'')`,
          [p.tenantId, org.id, r['专业'], r['专业层次'], r['学生类别']],
        )
      ).rows[0];
      if (!program) {
        program = { id: randomUUID() };
        await c.query(
          `INSERT INTO zhiban.academic_programs(id,tenant_id,organization_id,name,program_level,student_category,source_row_hash) VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7)`,
          [
            program.id,
            p.tenantId,
            org.id,
            r['专业'],
            r['专业层次'],
            r['学生类别'],
            sha(JSON.stringify(r)),
          ],
        );
        await change(c, p, batchId, rowId, 'academic_program', program.id, 20);
      }
      const classCode = `OUC-${sha(`${r['学习中心代码']}|${r['学生入学学期']}|${r['班级名称']}`).slice(0, 24)}`;
      let klass = (
        await c.query<{ id: string }>(
          `SELECT id FROM zhiban.classes WHERE tenant_id=$1 AND code=$2`,
          [p.tenantId, classCode],
        )
      ).rows[0];
      if (!klass) {
        klass = { id: randomUUID() };
        await c.query(
          `INSERT INTO zhiban.authorization_scopes(id,tenant_id,scope_type,code,name,external_ref) VALUES($1,$2,'class',$3,$4,$3)`,
          [klass.id, p.tenantId, classCode, r['班级名称']],
        );
        const head = (
          await c.query<{ account_id: string }>(
            `SELECT account_id FROM zhiban.teacher_profiles WHERE tenant_id=$1 AND employee_no=$2`,
            [p.tenantId, r['班主任工号']],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO zhiban.classes(id,tenant_id,term_id,code,name,head_teacher_id,organization_id,program_id,admission_term_code,source_system,source_external_id,source_row_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ouchn',$4,$10)`,
          [
            klass.id,
            p.tenantId,
            term.id,
            classCode,
            r['班级名称'],
            head?.account_id ?? null,
            org.id,
            program.id,
            r['学生入学学期'],
            sha(JSON.stringify(r)),
          ],
        );
        if (head?.account_id)
          await c.query(
            `INSERT INTO zhiban.role_assignments(id,tenant_id,account_id,role_id,scope_type,scope_id,granted_by)
             SELECT $1,$2,$3,r.id,'class',$4,$5 FROM zhiban.roles r
              WHERE r.code='head_teacher' AND r.tenant_id IS NULL
             ON CONFLICT(account_id,role_id,scope_type,COALESCE(scope_id,'00000000-0000-0000-0000-000000000000'::uuid))
               WHERE revoked_at IS NULL DO NOTHING`,
            [randomUUID(), p.tenantId, head.account_id, klass.id, p.id],
          );
        await change(c, p, batchId, rowId, 'class', klass.id, 30);
      }
      let course = (
        await c.query<{ id: string }>(
          `SELECT id FROM zhiban.courses WHERE tenant_id=$1 AND (external_course_id=$2 OR code=$2)`,
          [p.tenantId, r['课程ID']],
        )
      ).rows[0];
      if (!course) {
        course = { id: randomUUID() };
        await c.query(
          `INSERT INTO zhiban.authorization_scopes(id,tenant_id,scope_type,code,name,external_ref) VALUES($1,$2,'course',$3,$4,$3)`,
          [course.id, p.tenantId, r['课程ID'], r['课程名称']],
        );
        await c.query(
          `INSERT INTO zhiban.courses(id,tenant_id,code,name,credits,external_course_id,contact_hours,exam_unit,course_type,course_nature,suggested_term,source_system,source_row_hash) VALUES($1,$2,$3,$4,$5,$3,$6,$7,$8,$9,$10,'ouchn',$11)`,
          [
            course.id,
            p.tenantId,
            r['课程ID'],
            r['课程名称'],
            Number(r['学分']),
            Number(r['学时']) || null,
            r['考试单位'],
            r['课程类型'],
            r['课程性质'],
            Number(r['建议开设学期']) || null,
            sha(JSON.stringify(r)),
          ],
        );
        await change(c, p, batchId, rowId, 'course', course.id, 40);
      }
      const offeringKey = [r['学习中心代码'], r['选课年度学期'], r['课程ID'], classCode].join('|'),
        offeringCode = `OUC-${sha(offeringKey).slice(0, 40)}`;
      let offering = (
        await c.query<{ id: string }>(
          `SELECT id FROM zhiban.course_offerings WHERE tenant_id=$1 AND code=$2`,
          [p.tenantId, offeringCode],
        )
      ).rows[0];
      if (!offering) {
        offering = { id: randomUUID() };
        await c.query(
          `INSERT INTO zhiban.course_offerings(id,tenant_id,course_id,term_id,class_id,code,status,organization_id,academic_year_term,source_system,source_external_id,source_row_hash) VALUES($1,$2,$3,$4,$5,$6,'in_progress',$7,$8,'ouchn',$9,$10)`,
          [
            offering.id,
            p.tenantId,
            course.id,
            term.id,
            klass.id,
            offeringCode,
            org.id,
            r['选课年度学期'],
            offeringKey,
            sha(JSON.stringify(r)),
          ],
        );
        await change(c, p, batchId, rowId, 'course_offering', offering.id, 50);
      }
      const sourceKey = [r['学习中心代码'], r['选课年度学期'], r['学号'], r['课程ID']].join('|');
      const existing = (
        await c.query<{ id: string }>(
          `SELECT id FROM zhiban.enrollments WHERE tenant_id=$1 AND source_system='ouchn' AND source_external_id=$2`,
          [p.tenantId, sourceKey],
        )
      ).rows[0];
      if (existing) {
        await c.query(`UPDATE zhiban.academic_import_rows SET status='skipped' WHERE id=$1`, [
          rowId,
        ]);
        continue;
      }
      const enrollmentId = randomUUID();
      await c.query(
        `INSERT INTO zhiban.enrollments(id,tenant_id,offering_id,student_id,status,source,created_by,study_type,selection_count,registered_at,registered_by_external,transfer_to_exam,source_status,confirmation_status,confirmed_at,confirmed_by_external,payment_status,source_remark,source_system,source_external_id,source_row_hash) VALUES($1,$2,$3,$4,'enrolled','import',$5,$6,$7,NULLIF($8,'')::timestamptz,$9,$10,$11,$12,NULLIF($13,'')::timestamptz,$14,$15,$16,'ouchn',$17,$18) ON CONFLICT(tenant_id,source_system,source_external_id) WHERE source_system IS NOT NULL AND source_external_id IS NOT NULL DO UPDATE SET study_type=EXCLUDED.study_type,selection_count=EXCLUDED.selection_count,registered_at=EXCLUDED.registered_at,registered_by_external=EXCLUDED.registered_by_external,transfer_to_exam=EXCLUDED.transfer_to_exam,source_status=EXCLUDED.source_status,confirmation_status=EXCLUDED.confirmation_status,confirmed_at=EXCLUDED.confirmed_at,confirmed_by_external=EXCLUDED.confirmed_by_external,payment_status=EXCLUDED.payment_status,source_remark=EXCLUDED.source_remark,source_row_hash=EXCLUDED.source_row_hash,row_version=zhiban.enrollments.row_version+1`,
        [
          enrollmentId,
          p.tenantId,
          offering.id,
          student.account_id,
          p.id,
          r['修读类型'],
          Number(r['选课次数']) || 1,
          r['注册时间'],
          r['注册操作人'],
          r['是否转报考'] === '是',
          r['选课状态'],
          r['是否确认'],
          r['确认时间'],
          r['确认操作人'],
          r['缴费状态'],
          r['备注'],
          sourceKey,
          sha(JSON.stringify(r)),
        ],
      );
      await change(c, p, batchId, rowId, 'enrollment', enrollmentId, 100);
      await c.query(`UPDATE zhiban.academic_import_rows SET status='created' WHERE id=$1`, [rowId]);
    }
    await c.query(
      `UPDATE zhiban.academic_import_batches SET status='completed',executed_at=now(),encrypted_payload='{}'::jsonb,updated_at=now() WHERE id=$1`,
      [batchId],
    );
    return { batchId, status: 'completed' };
  });
}
export async function rollbackCourseRegistrationImport(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  batchId: string,
) {
  return withZhibanTenant(pool, p.tenantId, async (c) => {
    const b = (
      await c.query<{ status: string }>(
        `SELECT status FROM zhiban.academic_import_batches WHERE id=$1 FOR UPDATE`,
        [batchId],
      )
    ).rows[0];
    if (!b || b.status !== 'completed') throw new Error('仅已完成批次可回滚');
    await c.query(`SAVEPOINT import_rollback`);
    await c.query(`UPDATE zhiban.academic_import_batches SET status='rolling_back' WHERE id=$1`, [
      batchId,
    ]);
    const changes = (
      await c.query<{ id: number; entity_type: string; entity_id: string }>(
        `SELECT id,entity_type,entity_id FROM zhiban.academic_import_changes WHERE batch_id=$1 ORDER BY dependency_order DESC,id DESC`,
        [batchId],
      )
    ).rows;
    for (const x of changes) {
      const table = (
        {
          enrollment: 'enrollments',
          course_offering: 'course_offerings',
          course: 'courses',
          class: 'classes',
          academic_program: 'academic_programs',
          academic_term: 'academic_terms',
        } as Record<string, string>
      )[x.entity_type];
      if (!table) continue;
      try {
        if (x.entity_type === 'class')
          await c.query(
            `DELETE FROM zhiban.role_assignments WHERE tenant_id=$1 AND scope_type='class' AND scope_id=$2`,
            [p.tenantId, x.entity_id],
          );
        await c.query(`DELETE FROM zhiban.${table} WHERE id=$1`, [x.entity_id]);
        if (x.entity_type === 'course' || x.entity_type === 'class')
          await c.query(`DELETE FROM zhiban.authorization_scopes WHERE id=$1`, [x.entity_id]);
        await c.query(
          `UPDATE zhiban.academic_import_changes SET rolled_back_at=now() WHERE id=$1`,
          [x.id],
        );
      } catch (error) {
        await c.query(`ROLLBACK TO SAVEPOINT import_rollback`);
        await c.query(
          `UPDATE zhiban.academic_import_batches SET status='rollback_conflict',error_message=$2 WHERE id=$1`,
          [batchId, error instanceof Error ? error.message : '回滚冲突'],
        );
        return { batchId, status: 'rollback_conflict' };
      }
    }
    await c.query(
      `UPDATE zhiban.academic_import_rows SET status='rolled_back' WHERE batch_id=$1 AND status='created'`,
      [batchId],
    );
    await c.query(
      `UPDATE zhiban.academic_import_batches SET status='rolled_back',rolled_back_by=$2,rolled_back_at=now(),updated_at=now() WHERE id=$1`,
      [batchId, p.id],
    );
    return { batchId, status: 'rolled_back' };
  });
}
export async function listCourseRegistrationBatches(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
) {
  return withZhibanTenant(
    pool,
    p.tenantId,
    async (c) =>
      (
        await c.query(
          `SELECT id,file_name,status,total_rows,valid_rows,invalid_rows,summary,error_message,executed_at,rolled_back_at,created_at FROM zhiban.academic_import_batches WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`,
          [p.tenantId],
        )
      ).rows,
  );
}
