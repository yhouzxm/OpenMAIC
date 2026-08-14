import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';

import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';

import { openImport, sealImport } from './crypto';

type Row = Record<string, string> & { __row: string; __errors: string };
export const ADMINISTRATIVE_CLASS_HEADERS = [
  '入学年度',
  '学期',
  '班级编码',
  '班级名称',
  '班主任',
  '班级人数',
  '学生类别',
  '学生类别代码',
  '专业层次代码',
  '专业层次',
  '分校代码',
  '所属学院',
  '教学点代码',
  '所属学习中心',
  '专业代码',
  '专业名称',
  '培养方案号',
] as const;
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export function parseAdministrativeClassWorkbook(buffer: Buffer): Row[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    raw: false,
    defval: '',
  });
  const actual = (matrix[0] ?? []).slice(0, ADMINISTRATIVE_CLASS_HEADERS.length).map(String);
  if (actual.join('|') !== ADMINISTRATIVE_CLASS_HEADERS.join('|'))
    throw new Error('班级信息表头不符合标准模板');
  return matrix
    .slice(1)
    .filter((row) => row.some((value) => String(value).trim()))
    .map(
      (row, index) =>
        Object.assign(
          Object.fromEntries(
            ADMINISTRATIVE_CLASS_HEADERS.map((header, column) => [
              header,
              String(row[column] ?? '').trim(),
            ]),
          ),
          { __row: String(index + 2), __errors: '' },
        ) as Row,
    );
}

function termCode(row: Row) {
  return `${row['入学年度']}${row['学期']}`;
}
function termDates(row: Row) {
  const year = Number(row['入学年度']);
  return row['学期'] === '春季'
    ? { startsOn: `${year}-03-01`, endsOn: `${year}-08-31` }
    : { startsOn: `${year}-09-01`, endsOn: `${year + 1}-02-28` };
}

export async function validateAdministrativeClassImport(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: { fileName: string; buffer: Buffer },
) {
  const rows = parseAdministrativeClassWorkbook(input.buffer);
  const organizations = await pool.query<{ external_id: string }>(
    `SELECT external_id FROM zhiban.organization_units WHERE status='active'`,
  );
  const organizationCodes = new Set(organizations.rows.map((row) => row.external_id));
  const teachers = await withZhibanTenant(pool, principal.tenantId, async (client) =>
    client.query<{ real_name: string; organization_code: string | null }>(
      `SELECT tp.real_name,ou.external_id organization_code
       FROM zhiban.teacher_profiles tp
       JOIN zhiban.accounts a ON a.id=tp.account_id AND a.tenant_id=tp.tenant_id
       LEFT JOIN zhiban.organization_units ou
         ON ou.id=COALESCE(a.primary_organization_id,tp.organization_id)
       WHERE tp.tenant_id=$1 AND a.account_type='teacher' AND a.status='active'
         AND a.deleted_at IS NULL`,
      [principal.tenantId],
    ),
  );
  const teacherKeys = new Set(
    teachers.rows.map((teacher) => `${teacher.organization_code ?? ''}\u0000${teacher.real_name}`),
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const errors: string[] = [];
    for (const field of [
      '入学年度',
      '学期',
      '班级编码',
      '班级名称',
      '教学点代码',
      '专业代码',
      '专业名称',
    ])
      if (!row[field]) errors.push(`${field}不能为空`);
    if (!/^\d{4}$/.test(row['入学年度'])) errors.push('入学年度应为4位年份');
    if (!['春季', '秋季'].includes(row['学期'])) errors.push('学期只能填写春季或秋季');
    if (row['班级人数'] && (!/^\d+$/.test(row['班级人数']) || Number(row['班级人数']) < 0))
      errors.push('班级人数必须为非负整数');
    if (row['教学点代码'] && !organizationCodes.has(row['教学点代码']))
      errors.push('教学点代码不存在于机构树');
    if (row['分校代码'] && !organizationCodes.has(row['分校代码']))
      errors.push('分校代码不存在于机构树');
    if (row['班主任'] && !teacherKeys.has(`${row['教学点代码']}\u0000${row['班主任']}`))
      errors.push(`班主任“${row['班主任']}”尚未建立为该教学点的教师用户，请先建立用户`);
    if (seen.has(row['班级编码'])) errors.push('文件内班级编码重复');
    seen.add(row['班级编码']);
    row.__errors = errors.join('；');
  }
  const invalid = rows.filter((row) => row.__errors);
  const batchId = randomUUID();
  await withZhibanTenant(pool, principal.tenantId, async (client) => {
    await client.query(
      `INSERT INTO zhiban.academic_import_batches(id,tenant_id,created_by,import_type,file_name,file_sha256,status,total_rows,valid_rows,invalid_rows,encrypted_payload,summary)
       VALUES($1,$2,$3,'administrative_class',$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)`,
      [
        batchId,
        principal.tenantId,
        principal.id,
        input.fileName,
        sha(input.buffer),
        invalid.length ? 'invalid' : 'validated',
        rows.length,
        rows.length - invalid.length,
        invalid.length,
        JSON.stringify(sealImport(rows)),
        JSON.stringify({ classes: rows.length }),
      ],
    );
    for (const row of rows)
      await client.query(
        `INSERT INTO zhiban.academic_import_rows(tenant_id,batch_id,row_number,business_key,source_row_hash,encrypted_source,status,errors)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)`,
        [
          principal.tenantId,
          batchId,
          Number(row.__row),
          row['班级编码'],
          sha(JSON.stringify(row)),
          JSON.stringify(sealImport(row)),
          row.__errors ? 'invalid' : 'valid',
          JSON.stringify(row.__errors ? [row.__errors] : []),
        ],
      );
  });
  return {
    batchId,
    totalRows: rows.length,
    validRows: rows.length - invalid.length,
    invalidRows: invalid.length,
    summary: { classes: rows.length },
    rows: invalid.slice(0, 200).map((row) => ({
      rowNumber: Number(row.__row),
      key: row['班级编码'],
      errors: row.__errors.split('；'),
    })),
  };
}

async function recordChange(
  client: ZhibanQueryable,
  principal: AuthorizedPrincipal,
  batchId: string,
  rowId: number,
  entityType: string,
  entityId: string,
  operation: 'insert' | 'update',
  beforeData: object | null,
  afterVersion: number,
  order: number,
) {
  await client.query(
    `INSERT INTO zhiban.academic_import_changes(tenant_id,batch_id,import_row_id,entity_type,entity_id,operation,before_data,after_version,dependency_order)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      principal.tenantId,
      batchId,
      rowId,
      entityType,
      entityId,
      operation,
      beforeData ? JSON.stringify(beforeData) : null,
      afterVersion,
      order,
    ],
  );
}

export async function executeAdministrativeClassImport(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  batchId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const batch = (
      await client.query<{ encrypted_payload: { encrypted: string }; status: string }>(
        `SELECT encrypted_payload,status FROM zhiban.academic_import_batches WHERE id=$1 AND import_type='administrative_class' FOR UPDATE`,
        [batchId],
      )
    ).rows[0];
    if (!batch || batch.status !== 'validated') throw new Error('批次不可执行');
    const rows = openImport<Row[]>(batch.encrypted_payload);
    await client.query(
      `UPDATE zhiban.academic_import_batches SET status='running',confirmed_by=$2,confirmed_at=now(),updated_at=now() WHERE id=$1`,
      [batchId, principal.id],
    );
    for (const row of rows) {
      const rowId = (
        await client.query<{ id: number }>(
          `SELECT id FROM zhiban.academic_import_rows WHERE batch_id=$1 AND row_number=$2`,
          [batchId, Number(row.__row)],
        )
      ).rows[0]?.id;
      if (!rowId) throw new Error(`第${row.__row}行导入记录不存在`);
      const organization = (
        await client.query<{ id: string }>(
          `SELECT id FROM zhiban.organization_units WHERE external_id=$1 AND status='active'`,
          [row['教学点代码']],
        )
      ).rows[0];
      if (!organization) throw new Error(`第${row.__row}行教学点不存在`);
      const dates = termDates(row),
        code = termCode(row);
      let term = (
        await client.query<{ id: string }>(
          `SELECT id FROM zhiban.academic_terms WHERE tenant_id=$1 AND code=$2`,
          [principal.tenantId, code],
        )
      ).rows[0];
      if (!term) {
        term = { id: randomUUID() };
        await client.query(
          `INSERT INTO zhiban.academic_terms(id,tenant_id,code,name,starts_on,ends_on,status) VALUES($1,$2,$3,$3,$4,$5,'active')`,
          [term.id, principal.tenantId, code, dates.startsOn, dates.endsOn],
        );
        await recordChange(
          client,
          principal,
          batchId,
          rowId,
          'academic_term',
          term.id,
          'insert',
          null,
          1,
          10,
        );
      }
      let program = (
        await client.query<{ id: string }>(
          `SELECT id FROM zhiban.academic_programs WHERE tenant_id=$1 AND organization_id=$2 AND code IS NOT DISTINCT FROM NULLIF($3,'') AND name=$4 AND program_level=$5 AND student_category IS NOT DISTINCT FROM NULLIF($6,'')`,
          [
            principal.tenantId,
            organization.id,
            row['专业代码'],
            row['专业名称'],
            row['专业层次'],
            row['学生类别'],
          ],
        )
      ).rows[0];
      if (!program) {
        program = { id: randomUUID() };
        await client.query(
          `INSERT INTO zhiban.academic_programs(id,tenant_id,organization_id,code,name,program_level,student_category,source_system,source_row_hash) VALUES($1,$2,$3,NULLIF($4,''),$5,$6,NULLIF($7,''),'ouchn',$8)`,
          [
            program.id,
            principal.tenantId,
            organization.id,
            row['专业代码'],
            row['专业名称'],
            row['专业层次'],
            row['学生类别'],
            sha(JSON.stringify(row)),
          ],
        );
        await recordChange(
          client,
          principal,
          batchId,
          rowId,
          'academic_program',
          program.id,
          'insert',
          null,
          1,
          20,
        );
      }
      const hash = sha(JSON.stringify(row));
      const existing = (
        await client.query<Record<string, unknown> & { id: string; row_version: number }>(
          `SELECT * FROM zhiban.classes WHERE tenant_id=$1 AND code=$2 FOR UPDATE`,
          [principal.tenantId, row['班级编码']],
        )
      ).rows[0];
      const head = row['班主任']
        ? (
            await client.query<{ account_id: string }>(
              `SELECT tp.account_id FROM zhiban.teacher_profiles tp
               JOIN zhiban.accounts a ON a.id=tp.account_id AND a.tenant_id=tp.tenant_id
               WHERE tp.tenant_id=$1 AND tp.real_name=$2
                 AND COALESCE(a.primary_organization_id,tp.organization_id)=$3::uuid
                 AND a.account_type='teacher' AND a.status='active' AND a.deleted_at IS NULL
               ORDER BY a.created_at LIMIT 1`,
              [principal.tenantId, row['班主任'], organization.id],
            )
          ).rows[0]
        : undefined;
      if (row['班主任'] && !head)
        throw new Error(`第${row.__row}行班主任“${row['班主任']}”不存在或已停用，请先建立教师用户`);
      const classValues = [
        term.id,
        row['班级名称'],
        head?.account_id ?? null,
        Number(row['班级人数']) || null,
        organization.id,
        program.id,
        code,
        row['学生类别代码'],
        row['学生类别'],
        row['专业层次代码'],
        row['专业层次'],
        row['分校代码'],
        row['所属学院'],
        row['教学点代码'],
        row['所属学习中心'],
        row['专业代码'],
        row['专业名称'],
        row['培养方案号'],
        row['班主任'],
        hash,
      ];
      if (!existing) {
        const id = randomUUID();
        await client.query(
          `INSERT INTO zhiban.authorization_scopes(id,tenant_id,scope_type,code,name,external_ref) VALUES($1::uuid,$2::uuid,'class',$3,$4,$5::text)`,
          [id, principal.tenantId, row['班级编码'], row['班级名称'], id],
        );
        await client.query(
          `INSERT INTO zhiban.classes(id,tenant_id,term_id,code,name,head_teacher_id,capacity,expected_size,organization_id,program_id,admission_term_code,class_kind,student_category_code,student_category_name,program_level_code,program_level_name,branch_code,branch_name,study_center_code,study_center_name,major_code,major_name,training_plan_no,head_teacher_source_name,source_system,source_external_id,source_row_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,'administrative',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'ouchn',$4,$23)`,
          [id, principal.tenantId, term.id, row['班级编码'], ...classValues.slice(1)],
        );
        await recordChange(client, principal, batchId, rowId, 'class', id, 'insert', null, 1, 30);
      } else {
        const before = { ...existing };
        delete before.updated_at;
        const version = existing.row_version + 1;
        await client.query(
          `UPDATE zhiban.classes SET term_id=$3,name=$4,head_teacher_id=$5,capacity=$6,expected_size=$6,organization_id=$7,program_id=$8,admission_term_code=$9,class_kind='administrative',student_category_code=$10,student_category_name=$11,program_level_code=$12,program_level_name=$13,branch_code=$14,branch_name=$15,study_center_code=$16,study_center_name=$17,major_code=$18,major_name=$19,training_plan_no=$20,head_teacher_source_name=$21,source_system='ouchn',source_external_id=$2,source_row_hash=$22,row_version=$23,updated_at=now() WHERE tenant_id=$1 AND code=$2`,
          [principal.tenantId, row['班级编码'], ...classValues, version],
        );
        await recordChange(
          client,
          principal,
          batchId,
          rowId,
          'class',
          existing.id,
          'update',
          before,
          version,
          30,
        );
      }
      await client.query(`UPDATE zhiban.academic_import_rows SET status=$2 WHERE id=$1`, [
        rowId,
        existing ? 'updated' : 'created',
      ]);
    }
    await client.query(
      `UPDATE zhiban.academic_import_batches SET status='completed',executed_at=now(),encrypted_payload='{}'::jsonb,updated_at=now() WHERE id=$1`,
      [batchId],
    );
    return { batchId, status: 'completed' };
  });
}

export async function listAdministrativeClassBatches(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
) {
  return withZhibanTenant(
    pool,
    principal.tenantId,
    async (client) =>
      (
        await client.query(
          `SELECT id,file_name,status,total_rows,valid_rows,invalid_rows,summary,error_message,executed_at,rolled_back_at,created_at FROM zhiban.academic_import_batches WHERE tenant_id=$1 AND import_type='administrative_class' ORDER BY created_at DESC LIMIT 50`,
          [principal.tenantId],
        )
      ).rows,
  );
}

export async function rollbackAdministrativeClassImport(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  batchId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const batch = (
      await client.query<{ status: string }>(
        `SELECT status FROM zhiban.academic_import_batches WHERE id=$1 AND import_type='administrative_class' FOR UPDATE`,
        [batchId],
      )
    ).rows[0];
    if (!batch || batch.status !== 'completed') throw new Error('仅已完成批次可回滚');
    await client.query(
      `UPDATE zhiban.academic_import_batches SET status='rolling_back',updated_at=now() WHERE id=$1`,
      [batchId],
    );
    const changes = (
      await client.query<{
        id: number;
        entity_type: string;
        entity_id: string;
        operation: string;
        before_data: Record<string, unknown> | null;
        after_version: number | null;
      }>(
        `SELECT id,entity_type,entity_id,operation,before_data,after_version FROM zhiban.academic_import_changes WHERE batch_id=$1 ORDER BY dependency_order DESC,id DESC`,
        [batchId],
      )
    ).rows;
    for (const change of changes) {
      if (change.entity_type === 'class' && change.operation === 'update') {
        const current = (
          await client.query<{ row_version: number }>(
            `SELECT row_version FROM zhiban.classes WHERE id=$1`,
            [change.entity_id],
          )
        ).rows[0];
        if (!current || current.row_version !== change.after_version)
          throw new Error('班级已被后续修改，无法安全回滚');
        const before = change.before_data ?? {};
        const keys = [
          'term_id',
          'name',
          'head_teacher_id',
          'capacity',
          'expected_size',
          'organization_id',
          'program_id',
          'admission_term_code',
          'class_kind',
          'student_category_code',
          'student_category_name',
          'program_level_code',
          'program_level_name',
          'branch_code',
          'branch_name',
          'study_center_code',
          'study_center_name',
          'major_code',
          'major_name',
          'training_plan_no',
          'head_teacher_source_name',
          'source_system',
          'source_external_id',
          'source_row_hash',
          'row_version',
        ];
        await client.query(
          `UPDATE zhiban.classes SET ${keys.map((key, index) => `${key}=$${index + 2}`).join(',')},updated_at=now() WHERE id=$1`,
          [change.entity_id, ...keys.map((key) => before[key] ?? null)],
        );
      } else {
        const table = (
          {
            class: 'classes',
            academic_program: 'academic_programs',
            academic_term: 'academic_terms',
          } as Record<string, string>
        )[change.entity_type];
        if (!table) continue;
        if (change.entity_type === 'class')
          await client.query(
            `DELETE FROM zhiban.role_assignments WHERE tenant_id=$1 AND scope_type='class' AND scope_id=$2`,
            [principal.tenantId, change.entity_id],
          );
        await client.query(`DELETE FROM zhiban.${table} WHERE id=$1`, [change.entity_id]);
        if (change.entity_type === 'class')
          await client.query(`DELETE FROM zhiban.authorization_scopes WHERE id=$1`, [
            change.entity_id,
          ]);
      }
      await client.query(
        `UPDATE zhiban.academic_import_changes SET rolled_back_at=now() WHERE id=$1`,
        [change.id],
      );
    }
    await client.query(
      `UPDATE zhiban.academic_import_rows SET status='rolled_back' WHERE batch_id=$1 AND status IN ('created','updated')`,
      [batchId],
    );
    await client.query(
      `UPDATE zhiban.academic_import_batches SET status='rolled_back',rolled_back_by=$2,rolled_back_at=now(),updated_at=now() WHERE id=$1`,
      [batchId, principal.id],
    );
    return { batchId, status: 'rolled_back' };
  });
}
