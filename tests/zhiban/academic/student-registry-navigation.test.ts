import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('student registry information architecture', () => {
  const registry = fs.readFileSync(
    path.join(process.cwd(), 'components/zhiban/student-registry-console.tsx'),
    'utf8',
  );
  const academic = fs.readFileSync(
    path.join(process.cwd(), 'components/zhiban/academic-console.tsx'),
    'utf8',
  );
  it('groups student information and administrative classes under registry management', () => {
    expect(registry).toContain('学生信息管理');
    expect(registry).toContain('行政班级管理');
    expect(registry).toContain('AdministrativeClassConsole');
  });
  it('removes administrative class management from teaching management', () => {
    expect(academic).not.toContain('AdministrativeClassConsole');
    expect(academic).not.toContain('value="classes"');
  });
});
