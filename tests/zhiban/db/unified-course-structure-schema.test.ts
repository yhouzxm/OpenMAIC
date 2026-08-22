import { describe, expect, it } from 'vitest';
import { unifiedCourseStructureMigration } from '@/lib/zhiban/db/migrations/034-unified-course-structure';

describe('unified course structure schema', () => {
  it('defines modules, chapters, activities and immutable publication snapshots', () => {
    const sql = unifiedCourseStructureMigration.up.join('\n');
    expect(sql).toContain('CREATE TABLE zhiban.course_modules');
    expect(sql).toContain('CREATE TABLE zhiban.course_chapters');
    expect(sql).toContain('CREATE TABLE zhiban.course_activities');
    expect(sql).toContain('CREATE TABLE zhiban.course_design_versions');
    expect(sql).toContain("'classroom','pbl','assignment','quiz','discussion'");
    expect(sql).toContain('course_design_one_published_idx');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });
});
