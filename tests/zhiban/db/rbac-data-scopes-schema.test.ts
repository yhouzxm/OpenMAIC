import { describe, expect, it } from 'vitest';

import { rbacDataScopesMigration } from '@/lib/zhiban/db/migrations/004-rbac-data-scopes';

describe('RBAC data scopes migration', () => {
  const up = rbacDataScopesMigration.up.join('\n');

  it('creates tenant-isolated scope catalog and role policies', () => {
    expect(up).toContain('CREATE TABLE zhiban.authorization_scopes');
    expect(up).toContain('CREATE TABLE zhiban.role_scope_policies');
    expect(up).toContain('FORCE ROW LEVEL SECURITY');
    expect(up).toContain("('head_teacher', 'class')");
    expect(up).toContain("('course_teacher', 'course')");
  });

  it('enforces role and concrete scope validity in the database', () => {
    expect(up).toContain('validate_role_assignment_scope');
    expect(up).toContain('authorization scope is missing, archived, or has the wrong type');
    expect(up).toContain('role_assignment_scope_guard');
  });
});
