import { describe, expect, it } from 'vitest';

import { administrativeClassImportMigration } from '@/lib/zhiban/db/migrations/031-administrative-class-import';
import {
  ADMINISTRATIVE_CLASS_HEADERS,
  executeAdministrativeClassImport,
  parseAdministrativeClassWorkbook,
  validateAdministrativeClassImport,
} from '@/lib/zhiban/ouc-import/administrative-class';
import { deleteAdministrativeClasses } from '@/lib/zhiban/academic';
import * as XLSX from 'xlsx';

describe('administrative class import', () => {
  it('extends classes with supplied OUC administrative attributes', () => {
    const sql = administrativeClassImportMigration.up.join('\n');
    for (const field of [
      'administrative_class',
      'expected_size',
      'student_category_code',
      'program_level_code',
      'branch_code',
      'study_center_code',
      'major_code',
      'training_plan_no',
    ])
      expect(sql).toContain(field);
  });

  it('parses the standard class workbook columns as identifiers', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [...ADMINISTRATIVE_CLASS_HEADERS],
        [
          '2026',
          '春季',
          '263300804012001',
          '26春台玉法学本',
          '李冬飞',
          26,
          '开放',
          '01',
          '2',
          '本科(专科起点)',
          '33008',
          '台州电大',
          '3300804',
          '玉环学院',
          '01203010100',
          '法学',
          '260301203010100',
        ],
      ]),
      'Sheet0',
    );
    const rows = parseAdministrativeClassWorkbook(
      XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      班级编码: '263300804012001',
      教学点代码: '3300804',
      专业代码: '01203010100',
    });
  });

  it('does not reuse the authorization-scope UUID parameter as text', () => {
    const source = executeAdministrativeClassImport.toString();
    expect(source).toContain('$1::uuid');
    expect(source).toContain('$5::text');
    expect(source).not.toContain('$1::text');
  });

  it('requires an active teacher user from the same teaching organization', () => {
    const validation = validateAdministrativeClassImport.toString();
    const execution = executeAdministrativeClassImport.toString();
    expect(validation).toContain('teacherKeys');
    expect(validation).toContain('请先建立用户');
    expect(execution).toContain('tp.real_name');
    expect(execution).toContain('COALESCE(a.primary_organization_id,tp.organization_id)');
    expect(execution).toContain('不存在或已停用');
  });

  it('detaches related data before confirmed administrative class deletion', () => {
    const source = deleteAdministrativeClasses.toString();
    expect(source).toContain('class_memberships');
    expect(source).toContain('course_offerings');
    expect(source).toContain('course_offering_classes');
    expect(source).toContain('DELETE FROM zhiban.class_memberships');
    expect(source).toContain('SET class_id=NULL');
    expect(source).toContain("scope_type='class'");
    expect(source).toContain('class.deleted');
  });
});
