import { describe, expect, it } from 'vitest';
import { completeTeacherCourseSettingsMigration } from '@/lib/zhiban/db/migrations/008-complete-teacher-course-settings';

describe('complete teacher course settings schema', () => {
  const sql = completeTeacherCourseSettingsMigration.up.join('\n');

  it('stores the complete teacher policy set', () => {
    for (const column of [
      'starts_at', 'ends_at', 'pbl_projects', 'scene_rules', 'course_resources',
      'prompt_strategy', 'grading_policy', 'assignment_policy', 'warning_policy',
      'intervention_policy',
    ]) expect(sql).toContain(column);
  });

  it('constrains dates and JSON container types', () => {
    expect(sql).toContain('ends_at >= starts_at');
    expect(sql).toContain("jsonb_typeof(pbl_projects) = 'array'");
    expect(sql).toContain("jsonb_typeof(grading_policy) = 'object'");
  });
});
