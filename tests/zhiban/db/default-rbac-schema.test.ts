import { describe, expect, it } from 'vitest';

import { defaultRbacMigration } from '@/lib/zhiban/db/migrations/003-default-rbac';

describe('default RBAC migration', () => {
  it('grants account administration only to administrative roles', () => {
    const sql = defaultRbacMigration.up.join('\n');
    expect(sql).toMatch(/p\.code[\s\S]*'account:manage'[\s\S]*r\.code = 'institution_admin'/);
    expect(sql).toMatch(/p\.code[\s\S]*'account:read'[\s\S]*r\.code = 'teaching_admin'/);
    expect(sql).not.toMatch(/'account:manage'[\s\S]*r\.code = 'student'/);
    expect(sql).not.toMatch(/'account:manage'[\s\S]*r\.code = 'course_teacher'/);
  });

  it('has an explicit rollback for seeded mappings', () => {
    const sql = defaultRbacMigration.down.join('\n');
    expect(sql).toContain('DELETE FROM zhiban.role_permissions');
    expect(sql).toContain("'institution_admin'");
  });
});
