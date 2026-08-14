import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
describe('admin responsibility split', () => {
  it('creates users only in user management', () => {
    expect(read('components/zhiban/directory-console.tsx')).toContain('新建用户');
    const permissions = read('components/zhiban/admin-console.tsx');
    expect(permissions).not.toContain('新建账号</Button>');
    expect(permissions).toContain("account.accountType === 'teacher'");
  });
  it('assigns teachers from course classes with organization filtering', () => {
    const source = read('components/zhiban/course-class-teacher-console.tsx');
    for (const value of ['安排教师', '是否本校：', '工号', '姓名', '学习中心', '每页10条记录'])
      expect(source).toContain(value);
  });
});
