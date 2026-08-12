import { describe, expect, it } from 'vitest';
import { oucCourseRegistrationMigration } from '@/lib/zhiban/db/migrations/026-ouc-course-registration';

describe('OUC course registration migration', () => {
  it('extends the canonical academic model instead of duplicating it', () => {
    const sql = oucCourseRegistrationMigration.up.join('\n');
    for (const value of [
      'academic_programs',
      'ALTER TABLE zhiban.classes',
      'ALTER TABLE zhiban.courses',
      'ALTER TABLE zhiban.course_offerings',
      'ALTER TABLE zhiban.enrollments',
    ])
      expect(sql).toContain(value);
  });
  it('stores the supplied course and registration attributes', () => {
    const sql = oucCourseRegistrationMigration.up.join('\n');
    for (const value of [
      'contact_hours',
      'exam_unit',
      'course_type',
      'course_nature',
      'suggested_term',
      'study_type',
      'selection_count',
      'registered_at',
      'confirmation_status',
      'confirmed_at',
      'payment_status',
      'source_remark',
    ])
      expect(sql).toContain(value);
  });
  it('supports atomic import history and conflict-aware rollback', () => {
    const sql = oucCourseRegistrationMigration.up.join('\n');
    for (const value of [
      'academic_import_batches',
      'academic_import_rows',
      'academic_import_changes',
      'rollback_conflict',
      'before_data JSONB',
      'after_data JSONB',
      'after_version INTEGER',
      'FORCE ROW LEVEL SECURITY',
    ])
      expect(sql).toContain(value);
  });
});
