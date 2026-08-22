import { describe, expect, it } from 'vitest';
import { courseActivityGovernanceMigration } from '@/lib/zhiban/db/migrations/035-course-activity-governance';

describe('course activity governance schema', () => {
  it('protects dependencies and learner progress with tenant isolation', () => {
    const sql = courseActivityGovernanceMigration.up.join('\n');
    expect(sql).toContain('CREATE TABLE zhiban.course_activity_dependencies');
    expect(sql).toContain('CREATE TABLE zhiban.student_activity_progress');
    expect(sql).toContain('prerequisite_activity_id');
    expect(sql).toContain("status IN('not_started','in_progress','completed')");
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });
});
