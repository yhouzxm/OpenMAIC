import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  classId,
  classScope,
  courseId,
  courseScope,
  membershipId,
  permission,
  roleCode,
  roleGrantId,
  roleId,
  parseScope,
  selfScope,
  tenantScope,
  systemAdminGrantId,
  tenantId,
  userId,
  instant,
  type UserId,
  type TenantId,
  type ClassId,
  type CourseId,
} from '@/lib/zhiban/domain/identity';
import { expectError, uuid } from './fixtures';

describe('identity value objects', () => {
  it.each([
    userId,
    tenantId,
    membershipId,
    roleId,
    roleGrantId,
    systemAdminGrantId,
    classId,
    courseId,
  ])('accepts and normalizes UUIDv7 without generating identifiers', (parse) => {
    expect(parse(uuid(255).toUpperCase())).toBe(uuid(255));
  });
  it.each([
    '',
    '123',
    ' ' + uuid(1),
    uuid(1).replace('-7000-', '-4000-'),
    uuid(1).replace('-8000-', '-0000-'),
    null,
  ])('rejects malformed IDs %s', (input) => expectError(() => userId(input), 'INVALID_ID'));
  it('keeps identifier types distinct', () => {
    expectTypeOf<UserId>().not.toEqualTypeOf<TenantId>();
    expectTypeOf<ClassId>().not.toEqualTypeOf<CourseId>();
  });
  it('uses resource-specific typed scope factories', () => {
    const classReference = classId(uuid(1));
    const courseReference = courseId(uuid(2));
    expect(selfScope()).toEqual({ type: 'SELF', scopeId: null });
    expect(tenantScope()).toEqual({ type: 'TENANT', scopeId: null });
    expect(classScope(classReference)).toEqual({ type: 'CLASS', scopeId: classReference });
    expect(courseScope(courseReference)).toEqual({ type: 'COURSE', scopeId: courseReference });
    expectTypeOf<Parameters<typeof classScope>[0]>().toEqualTypeOf<ClassId>();
    expectTypeOf<Parameters<typeof courseScope>[0]>().toEqualTypeOf<CourseId>();
    expectTypeOf<
      CourseId extends Parameters<typeof classScope>[0] ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      ClassId extends Parameters<typeof courseScope>[0] ? true : false
    >().toEqualTypeOf<false>();
  });
  it.each(['SELF', 'TENANT'])('requires null for %s', (type) => {
    expect(parseScope(type, null)).toEqual({ type, scopeId: null });
    expectError(() => parseScope(type, uuid(1)), 'INVALID_SCOPE');
    expectError(() => parseScope(type, undefined), 'INVALID_SCOPE');
  });
  it.each(['CLASS', 'COURSE'])('requires an opaque ID for %s', (type) => {
    expect(parseScope(type, uuid(1))).toEqual({ type, scopeId: uuid(1) });
    expectError(() => parseScope(type, null), 'INVALID_SCOPE');
    expectError(() => parseScope(type, undefined), 'INVALID_SCOPE');
    expectError(() => parseScope(type, ''), 'INVALID_SCOPE');
    expectError(() => parseScope(type, 'invalid'), 'INVALID_ID');
  });
  it.each(['SYSTEM', 'ORGANIZATION', 'ACTIVITY', 'PROJECT_GROUP', '__proto__', 'self', undefined])(
    'rejects unknown scope %s without fallback',
    (type) => expectError(() => parseScope(type, null), 'INVALID_SCOPE'),
  );
  it.each([
    'tenant:manage',
    'membership:read',
    'membership:manage',
    'role:assign',
    'learning:view_self',
  ])('accepts a stable permission %s', (code) => expect(permission(code)).toBe(code));
  it.each([
    '',
    '*:*',
    'Tenant:manage',
    'tenant:manage:123',
    '/api/user',
    'teacher',
    'course:' + uuid(1),
    'class:read_12',
  ])('rejects dynamic or invalid permission %s', (code) =>
    expectError(() => permission(code), 'INVALID_PERMISSION'),
  );
  it.each(['SYSTEM_ADMIN', 'RISK_REVIEWER', 'RESEARCHER', 'CUSTOM', '__proto__'])(
    'rejects non-tenant role %s',
    (code) => expectError(() => roleCode(code), 'INVALID_ROLE'),
  );
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER])(
    'rejects an invalid instant %s',
    (at) => expectError(() => instant(at), 'INVALID_TIME'),
  );
});
