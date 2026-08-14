import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { courseClassGroupingMigration } from '@/lib/zhiban/db/migrations/032-course-class-grouping';

describe('course class grouping', () => {
  it('links one course class to multiple administrative classes', () => {
    const sql = courseClassGroupingMigration.up.join('\n');
    expect(sql).toContain('course_offering_classes');
    expect(sql).toContain('ADD COLUMN name');
  });
  it('uses the teaching class number and name rule', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/zhiban/ouc-import/course-registration.ts'),
      'utf8',
    );
    expect(source).toContain("`${r['学习中心代码']}${r['课程ID']}01`");
    expect(source).toContain("`${r['学习中心名称']}01`");
    expect(source).toContain('course_offering_classes');
  });

  it('requires an active student user and an existing administrative class', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/zhiban/ouc-import/course-registration.ts'),
      'utf8',
    );
    expect(source).toContain('JOIN zhiban.accounts a ON a.id=sp.account_id');
    expect(source).toContain("a.account_type='student'");
    expect(source).toContain("a.status='active'");
    expect(source).toContain('学生用户不存在，请先建立用户');
    expect(source).toContain('未找到对应行政班，请先导入班级信息');
    expect(source).toContain('未找到唯一对应行政班');
    expect(source).toContain("value?.trim() ?? ''");
    expect(source).toContain("'学生入学学期'");
  });
});
