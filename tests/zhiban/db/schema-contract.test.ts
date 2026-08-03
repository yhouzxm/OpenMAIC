import { describe, expect, it } from 'vitest';

import { initialIdentityMigration } from '@/lib/zhiban/db/migrations/001-initial-identity';

const schema = initialIdentityMigration.up.join('\n');

describe('Zhiban initial schema contract', () => {
  it.each([
    'tenants',
    'accounts',
    'password_credentials',
    'student_profiles',
    'teacher_profiles',
    'admin_profiles',
    'roles',
    'permissions',
    'role_permissions',
    'role_assignments',
    'service_principals',
    'audit_log',
  ])('creates zhiban.%s without changing public OpenMAIC tables', (table) => {
    expect(schema).toContain(`zhiban.${table}`);
    expect(schema).not.toMatch(/ALTER TABLE (document_|runtime_)/);
  });

  it('pins tenant ownership, scoped identity uniqueness, and password hashing constraints', () => {
    expect(schema).toContain('REFERENCES zhiban.tenants(id) ON DELETE RESTRICT');
    expect(schema).toContain('student_profiles_tenant_no_uq');
    expect(schema).toContain('teacher_profiles_tenant_employee_uq');
    expect(schema).toContain("CHECK (algorithm = 'argon2id')");
    expect(schema).toContain('accounts_tenant_login_active_uq');
  });

  it('enables RLS on every table that directly carries tenant data', () => {
    for (const table of [
      'tenants',
      'accounts',
      'student_profiles',
      'teacher_profiles',
      'admin_profiles',
      'roles',
      'role_assignments',
      'service_principals',
      'audit_log',
      'password_credentials',
    ]) {
      expect(schema).toContain(`ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(schema).toContain("current_setting('zhiban.tenant_id', true)");
  });

  it('makes audit rows append-only and rollback strictly zhiban-scoped', () => {
    expect(schema).toContain('CREATE TRIGGER audit_log_append_only');
    expect(schema).toContain("RAISE EXCEPTION 'zhiban.audit_log is append-only'");
    expect(initialIdentityMigration.down).toEqual(['DROP SCHEMA IF EXISTS zhiban CASCADE']);
  });

  it('seeds stable system roles and the initial permission catalog', () => {
    for (const role of [
      'student',
      'head_teacher',
      'course_teacher',
      'risk_reviewer',
      'teaching_admin',
      'institution_admin',
      'system_admin',
      'researcher',
    ]) {
      expect(schema).toContain(`'${role}'`);
    }
    expect(schema).toContain("'course:manage'");
    expect(schema).toContain("'grade:publish'");
    expect(schema).toContain("'research:export'");
  });
});
