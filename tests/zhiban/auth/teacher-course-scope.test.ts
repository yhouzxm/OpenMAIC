import { describe, expect, it } from 'vitest';
import { hasScopedPermission } from '@/lib/zhiban/rbac/service';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac/types';
const teacher: AuthorizedPrincipal = {
  id: 'teacher',
  tenantId: 'tenant',
  loginName: 't',
  displayName: 'T',
  accountType: 'teacher',
  mustChangePassword: false,
  roles: ['course_teacher'],
  permissions: ['course:manage'],
  grants: [
    {
      roleCode: 'course_teacher',
      permission: 'course:manage',
      scopeType: 'course',
      scopeId: 'course-a',
    },
  ],
};
describe('teacher course settings scope', () => {
  it('allows updates only for assigned courses', () => {
    expect(hasScopedPermission(teacher, 'course:manage', { courseIds: ['course-a'] })).toBe(true);
    expect(hasScopedPermission(teacher, 'course:manage', { courseIds: ['course-b'] })).toBe(false);
    expect(hasScopedPermission(teacher, 'course:manage')).toBe(false);
  });
});
