import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  deleteAcademicCourse,
  deleteAcademicTerm,
  listAcademicOverview,
  updateAcademicCourse,
  updateAcademicTerm,
} from '@/lib/zhiban/academic';
import { academicOrganizationMigration } from '@/lib/zhiban/db/migrations/005-academic-organization';

describe('academic organization migration', () => {
  const sql = academicOrganizationMigration.up.join('\n');

  it('creates the complete class, course, offering, and enrollment structure', () => {
    for (const table of [
      'academic_terms',
      'classes',
      'courses',
      'course_offerings',
      'class_memberships',
      'teaching_assignments',
      'enrollments',
    ]) {
      expect(sql).toContain(`CREATE TABLE zhiban.${table}`);
    }
  });

  it('uses tenant composite foreign keys and forced row security', () => {
    expect(sql).toContain('REFERENCES zhiban.authorization_scopes(id, tenant_id)');
    expect(sql).toContain('REFERENCES zhiban.accounts(id, tenant_id)');
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(7);
  });

  it('adds class and enrollment permissions to administrative roles', () => {
    expect(sql).toContain("'class:manage'");
    expect(sql).toContain("'enrollment:manage'");
    expect(sql).toContain("('institution_admin', 'enrollment:manage')");
  });

  it('does not expose student details in the academic overview', () => {
    const service = listAcademicOverview.toString();
    const consoleSource = fs.readFileSync(
      path.join(process.cwd(), 'components/zhiban/academic-console.tsx'),
      'utf8',
    );
    expect(service).not.toContain('student_profiles');
    expect(service).not.toContain('student_name');
    expect(consoleSource).not.toContain('data.students');
    expect(consoleSource).not.toContain('data.enrollments');
    expect(service).toContain('COALESCE(c.owner_teacher_id,assigned.teacher_id)');
    expect(service).toContain('zhiban.teaching_assignments');
  });

  it('protects academic terms referenced by classes or offerings during deletion', () => {
    const source = deleteAcademicTerm.toString();
    expect(source).toContain('zhiban.classes');
    expect(source).toContain('zhiban.course_offerings');
    expect(source).toContain('FOR UPDATE');
    expect(source).toContain('academic_term.deleted');
    expect(source).toContain('关联行政班 ${term.class_count} 个、课程班 ${term.offering_count} 个');
  });

  it('supports audited updates and confirmed cascading course deletion', () => {
    expect(updateAcademicTerm.toString()).toContain('academic_term.updated');
    expect(updateAcademicCourse.toString()).toContain('course.updated');
    const deletion = deleteAcademicCourse.toString();
    for (const dependency of [
      'DELETE FROM zhiban.course_offerings',
      'course_offerings',
      'course_settings',
      'course_classrooms',
      'pbl_projects',
      'DELETE FROM zhiban.role_assignments',
    ])
      expect(deletion).toContain(dependency);
    expect(deletion).toContain('course.deleted');
  });
});
