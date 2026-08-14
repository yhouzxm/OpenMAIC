import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('course registration administrative class prerequisite', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'lib/zhiban/ouc-import/course-registration.ts'),
    'utf8',
  );

  it('validates against existing administrative classes', () => {
    expect(source).toContain("class_kind='administrative'");
    expect(source).toContain('未找到对应行政班，请先导入班级信息');
    expect(source).toContain('对应行政班不唯一，请先整理班级数据');
  });

  it('does not create classes during course registration execution', () => {
    expect(source).not.toContain('INSERT INTO zhiban.classes');
    expect(source).toContain('未找到唯一对应行政班，请先导入并整理班级信息');
  });
});
