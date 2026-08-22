import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const studentRoutes = [
  'app/api/zhiban/student/courses/[courseId]/tutor/route.ts',
  'app/api/zhiban/student/courses/[courseId]/coursework/route.ts',
  'app/api/zhiban/student/assessments/route.ts',
  'app/api/zhiban/student/risks/route.ts',
];

describe('student route permission scope', () => {
  it.each(studentRoutes)('%s accepts the self-scoped student course permission', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain("requireRequestGrantedPermission('course:read')");
    expect(source).not.toContain("requireRequestPermission('course:read')");
  });
});
