import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { studentCourseAccessMigration } from '@/lib/zhiban/db/migrations/033-student-course-access';

describe('student course access', () => {
  it('allows the student role at course scope and backfills active enrollments', () => {
    const sql = studentCourseAccessMigration.up.join('\n');

    expect(sql).toContain('role_scope_policies');
    expect(sql).toContain('authorization_scopes');
    expect(sql).toContain("code = 'student'");
    expect(sql).toContain("'course'");
    expect(sql).toContain('zhiban.enrollments');
    expect(sql).toContain('zhiban.course_offerings');
    expect(sql).toContain('zhiban.role_assignments');
  });

  it('grants and rolls back course access with each registration import', () => {
    const source = readFileSync(
      new URL('../../../lib/zhiban/ouc-import/course-registration.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("r.code='student'");
    expect(source).toContain("'student_course_role'");
    expect(source).toContain('DELETE FROM zhiban.role_assignments WHERE tenant_id=$1 AND id=$2');
  });
});
