import { describe, expect, it } from 'vitest';
import {
  User,
  Tenant,
  Role,
  permission,
  roleId,
  SystemAdminGrant,
  systemAdminGrantId,
} from '@/lib/zhiban/domain/identity';
import { AFTER, BEFORE, NOW, USER, TENANT, active, command, expectError, uuid } from './fixtures';

describe('User and Tenant aggregates', () => {
  it('creates a global active User with immutable audit fields', () => {
    const user = User.create(USER, NOW);
    expect(user).toMatchObject({ id: USER, status: 'ACTIVE', createdAt: NOW, updatedAt: NOW });
    expect(Object.keys(user)).not.toEqual(expect.arrayContaining(['tenantId', 'role']));
    expect(Reflect.set(user, 'status', 'DISABLED')).toBe(false);
  });
  it('disables and explicitly restores User, preserving the original object', () => {
    const user = User.create(USER, NOW);
    const disabled = user.disable(AFTER, 'review');
    expect(disabled).toMatchObject({
      status: 'DISABLED',
      disabledAt: AFTER,
      disabledReason: 'review',
    });
    expect(user.status).toBe('ACTIVE');
    expect(disabled.restore(AFTER)).toMatchObject({
      status: 'ACTIVE',
      disabledAt: null,
      disabledReason: null,
    });
    expectError(() => user.restore(NOW), 'INVALID_STATE_TRANSITION');
    expectError(() => disabled.disable(AFTER, 'again'), 'INVALID_STATE_TRANSITION');
    expectError(() => user.disable(BEFORE, 'reason'), 'INVALID_TIME');
    expectError(() => user.disable(NOW, '  '), 'INVALID_ENTITY');
  });
  it('supports active/disabled/archived Tenant, keeping code stable', () => {
    const tenant = Tenant.create(TENANT, 'school_1', 'School', NOW);
    const disabled = tenant.disable(AFTER, 'review');
    expect(disabled.status).toBe('DISABLED');
    const restored = disabled.restore(AFTER);
    expect(restored.status).toBe('ACTIVE');
    const archived = restored.archive(AFTER);
    expect(archived.status).toBe('ARCHIVED');
    expect(archived.code).toBe('school_1');
    expectError(() => archived.restore(AFTER), 'INVALID_STATE_TRANSITION');
    expectError(() => archived.disable(AFTER, 'reason'), 'INVALID_STATE_TRANSITION');
    expectError(() => Tenant.create(TENANT, '', 'School', NOW), 'INVALID_ENTITY');
    expectError(() => Tenant.create(TENANT, 'school', ' ', NOW), 'INVALID_ENTITY');
  });
  it('Tenant restoration does not restore a disabled Membership or revoke history', () => {
    const membership = active();
    const revoked = membership.revokeGrant({
      ...command(membership),
      grantId: membership.roleGrants[0].id,
    });
    const disabled = revoked.disable({ ...command(revoked), reason: 'review' });
    Tenant.create(TENANT, 'school', 'School', NOW).disable(NOW, 'review').restore(AFTER);
    expect(disabled.status).toBe('DISABLED');
    expect(disabled.roleGrants[0].isRevoked).toBe(true);
    expect(disabled.effectiveGrantsAt(AFTER)).toEqual([]);
  });
  it('Role owns a defensive permission collection, without a global permission matrix', () => {
    const permissions = [permission('membership:read')];
    const role = Role.create(roleId(uuid(9)), 'TEACHER', permissions);
    permissions.push(permission('role:assign'));
    expect(role.permissions).toEqual([permission('membership:read')]);
    expect(Object.isFrozen(role.permissions)).toBe(true);
    expect(Reflect.set(role, 'code', 'SYSTEM_ADMIN')).toBe(false);
  });
});

describe('SystemAdminGrant', () => {
  it('is associated only with global User and has independent validity/revocation', () => {
    const grant = SystemAdminGrant.create({
      id: systemAdminGrantId(uuid(40)),
      userId: USER,
      createdAt: BEFORE,
      validFrom: NOW,
      validUntil: AFTER,
    });
    expect(Object.keys(grant)).not.toEqual(
      expect.arrayContaining(['tenantId', 'membershipId', 'scope']),
    );
    expect('tenantId' in grant).toBe(false);
    expect('membershipId' in grant).toBe(false);
    expect(grant.isEffectiveAt(BEFORE)).toBe(false);
    expect(grant.isEffectiveAt(NOW)).toBe(true);
    expect(grant.isEffectiveAt(AFTER)).toBe(false);
    const revoked = grant.revoke(NOW);
    expect(revoked.revoke(AFTER)).toBe(revoked);
    expect(revoked.revokedAt).toBe(NOW);
    expect(revoked.isEffectiveAt(NOW)).toBe(false);
    expect('unrevoke' in revoked).toBe(false);
  });
  it('rejects an empty validity window', () => {
    expectError(
      () =>
        SystemAdminGrant.create({
          id: systemAdminGrantId(uuid(41)),
          userId: USER,
          createdAt: BEFORE,
          validFrom: NOW,
          validUntil: NOW,
        }),
      'INVALID_VALIDITY_WINDOW',
    );
  });
});
