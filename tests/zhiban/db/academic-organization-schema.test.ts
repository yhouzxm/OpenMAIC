import { describe, expect, it } from 'vitest';

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
});
