import { describe, expect, it } from 'vitest';
import { teacherCourseSettingsMigration } from '@/lib/zhiban/db/migrations/007-teacher-course-settings';
describe('teacher course settings schema', () => {
  const sql = teacherCourseSettingsMigration.up.join('\n');
  it('stores course settings and immutable version snapshots', () => {
    expect(sql).toContain('CREATE TABLE zhiban.course_settings');
    expect(sql).toContain('CREATE TABLE zhiban.course_setting_versions');
    expect(sql).toContain('UNIQUE (course_id, version)');
  });
  it('constrains JSON, publication state, and tenant isolation', () => {
    expect(sql).toContain("publication_status IN ('draft', 'published')");
    expect(sql).toContain("jsonb_typeof(learning_objectives) = 'array'");
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(2);
  });
});
