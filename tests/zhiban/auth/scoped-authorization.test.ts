import { describe, expect, it } from 'vitest';

import { hasScopedPermission } from '@/lib/zhiban/rbac/service';
import type { AuthorizedPrincipal, ScopedGrant } from '@/lib/zhiban/rbac/types';

function principal(grant: ScopedGrant): AuthorizedPrincipal {
  return {
    id: 'account-1',
    tenantId: 'tenant-1',
    loginName: 'teacher',
    displayName: 'Teacher',
    accountType: 'teacher',
    mustChangePassword: false,
    roles: [grant.roleCode],
    permissions: [grant.permission],
    grants: [grant],
  };
}

describe('scoped RBAC authorization', () => {
  it('allows a course teacher only inside the assigned course', () => {
    const actor = principal({
      roleCode: 'course_teacher',
      permission: 'grade:read',
      scopeType: 'course',
      scopeId: 'course-1',
    });
    expect(hasScopedPermission(actor, 'grade:read', { courseIds: ['course-1'] })).toBe(true);
    expect(hasScopedPermission(actor, 'grade:read', { courseIds: ['course-2'] })).toBe(false);
  });

  it('limits self grants to the current account', () => {
    const actor = principal({
      roleCode: 'student',
      permission: 'grade:read',
      scopeType: 'self',
      scopeId: null,
    });
    expect(hasScopedPermission(actor, 'grade:read', { ownerAccountId: 'account-1' })).toBe(true);
    expect(hasScopedPermission(actor, 'grade:read', { ownerAccountId: 'account-2' })).toBe(false);
  });

  it('allows tenant grants without a narrower resource match', () => {
    const actor = principal({
      roleCode: 'institution_admin',
      permission: 'account:read',
      scopeType: 'tenant',
      scopeId: null,
    });
    expect(hasScopedPermission(actor, 'account:read', {})).toBe(true);
  });
});
