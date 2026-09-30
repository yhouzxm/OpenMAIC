import { describe, expect, it } from 'vitest';
import {
  Membership,
  RoleGrant,
  SystemAdminGrant,
  Tenant,
  User,
  instant,
  roleGrantId,
  systemAdminGrantId,
  selfScope,
} from '@/lib/zhiban/domain/identity';
import {
  rehydrateMembershipForPersistence,
  rehydrateRoleGrantForPersistence,
  rehydrateSystemAdminGrantForPersistence,
  rehydrateTenantForPersistence,
  rehydrateUserForPersistence,
} from '@/lib/zhiban/domain/identity/persistence-rehydration';
import {
  AFTER,
  BEFORE,
  NOW,
  TENANT,
  USER,
  active,
  command,
  expectError,
  grant,
  pending,
  uuid,
} from './fixtures';

const userState = (user: User) => ({ ...user });
const tenantState = (tenant: Tenant) => ({ ...tenant });
const grantState = (item: RoleGrant) => ({ ...item, scope: { ...item.scope } });
const adminState = (item: SystemAdminGrant) => ({ ...item });
const membershipState = (item: Membership) => ({ ...item, roleGrants: [...item.roleGrants] });
const admin = () =>
  SystemAdminGrant.create({
    id: systemAdminGrantId(uuid(40)),
    userId: USER,
    createdAt: BEFORE,
    validFrom: NOW,
    validUntil: null,
  });

describe('privileged persistence rehydration', () => {
  it('RHY01 User ACTIVE roundtrip', () => {
    const original = User.create(USER, NOW);
    expect(rehydrateUserForPersistence(userState(original))).toEqual(original);
  });
  it('RHY02 User DISABLED roundtrip', () => {
    const original = User.create(USER, BEFORE).disable(NOW, 'review');
    const restored = rehydrateUserForPersistence(userState(original));
    expect(restored).toEqual(original);
    expect(restored.disabledAt).toBe(NOW);
  });
  it('RHY03 Tenant ACTIVE roundtrip', () => {
    const original = Tenant.create(TENANT, 'school_1', 'School', NOW);
    expect(rehydrateTenantForPersistence(tenantState(original))).toEqual(original);
  });
  it('RHY04 Tenant DISABLED roundtrip', () => {
    const original = Tenant.create(TENANT, 'school_1', 'School', BEFORE).disable(NOW, 'review');
    expect(rehydrateTenantForPersistence(tenantState(original))).toEqual(original);
  });
  it('RHY05 Tenant ARCHIVED supports both valid fact shapes, rejects partial facts', () => {
    const original = Tenant.create(TENANT, 'school_1', 'School', BEFORE);
    expect(rehydrateTenantForPersistence(tenantState(original.archive(NOW)))).toEqual(
      original.archive(NOW),
    );
    const disabledArchived = original.disable(NOW, 'review').archive(AFTER);
    expect(rehydrateTenantForPersistence(tenantState(disabledArchived))).toEqual(disabledArchived);
    expectError(
      () =>
        rehydrateTenantForPersistence({ ...tenantState(disabledArchived), disabledReason: null }),
      'INVALID_ENTITY',
    );
  });
  it('RHY06 Membership PENDING and ACTIVE preserve identity, version and order', () => {
    for (const original of [pending([grant(10), grant(11)]), active([grant(10), grant(11)])]) {
      const restored = rehydrateMembershipForPersistence(membershipState(original));
      expect(restored).toEqual(original);
      expect(restored.roleGrants.map((item) => item.id)).toEqual(
        original.roleGrants.map((item) => item.id),
      );
    }
  });
  it('RHY07 Membership DISABLED and LEFT retain history without grant revival', () => {
    const current = active();
    for (const original of [
      current.disable({ ...command(current), reason: 'review' }),
      current.leave(command(current)),
    ]) {
      const restored = rehydrateMembershipForPersistence(membershipState(original));
      expect(restored).toEqual(original);
      expect(restored.effectiveGrantsAt(AFTER)).toEqual([]);
    }
  });
  it('RHY08 preserves active, future, expired and revoked grant history', () => {
    const history = [
      grant(10),
      grant(11, { validFrom: AFTER }),
      grant(12, { validUntil: NOW }),
      grant(13).revoke(NOW),
    ];
    const restored = rehydrateMembershipForPersistence(membershipState(pending(history)));
    expect(restored.roleGrants.map((item) => item.id)).toEqual(history.map((item) => item.id));
    expect(restored.roleGrants[1].isNotYetEffective(NOW)).toBe(true);
    expect(restored.roleGrants[2].isExpired(NOW)).toBe(true);
    expect(restored.roleGrants[3].revokedAt).toBe(NOW);
    for (const item of history)
      expect(rehydrateRoleGrantForPersistence(grantState(item))).toEqual(item);
    expectError(
      () =>
        rehydrateMembershipForPersistence({
          ...membershipState(pending()),
          roleGrants: [grant(14, { createdAt: AFTER, validFrom: AFTER })],
        }),
      'INVALID_TIME',
    );
    expectError(
      () =>
        rehydrateMembershipForPersistence({
          ...membershipState(pending()),
          roleGrants: [grant(14), grant(14)],
        }),
      'INVALID_ROLE_GRANT',
    );
  });
  it('RHY09 preserves revoked-future grant without filtering or restoring it', () => {
    const future = grant(10, { validFrom: AFTER }).revoke(NOW);
    const restored = rehydrateMembershipForPersistence(membershipState(pending([future])));
    expect(restored.roleGrants[0]).toEqual(future);
    expect(restored.roleGrants[0].isEffectiveAt(AFTER)).toBe(false);
  });
  it('RHY10 SystemAdminGrant active and revoked roundtrip', () => {
    for (const original of [admin(), admin().revoke(AFTER)]) {
      const restored = rehydrateSystemAdminGrantForPersistence(adminState(original));
      expect(restored).toEqual(original);
      expect('tenantId' in restored).toBe(false);
      expect('scope' in restored).toBe(false);
    }
  });
  it('RHY11 rejects invalid and non-v7 UUIDs', () => {
    expectError(
      () =>
        rehydrateUserForPersistence({
          ...userState(User.create(USER, NOW)),
          id: uuid(1).replace('-7000-', '-4000-'),
        }),
      'INVALID_ID',
    );
    expectError(
      () =>
        rehydrateMembershipForPersistence({ ...membershipState(pending()), tenantId: 'invalid' }),
      'INVALID_ID',
    );
  });
  it('RHY12 rejects invalid, NaN and out-of-range instants', () => {
    const state = userState(User.create(USER, NOW));
    for (const bad of [NaN, -1, 8_640_000_000_000_001, '123']) {
      expectError(() => rehydrateUserForPersistence({ ...state, updatedAt: bad }), 'INVALID_TIME');
    }
    expectError(
      () =>
        rehydrateRoleGrantForPersistence({
          ...grantState(grant(10)),
          revokedAt: instant(BEFORE - 1),
        }),
      'INVALID_TIME',
    );
  });
  it('RHY13 rejects unknown status, enum and tenant role', () => {
    expectError(
      () =>
        rehydrateUserForPersistence({ ...userState(User.create(USER, NOW)), status: 'UNKNOWN' }),
      'INVALID_ENTITY',
    );
    expectError(
      () => rehydrateMembershipForPersistence({ ...membershipState(pending()), status: 'UNKNOWN' }),
      'INVALID_ENTITY',
    );
    expectError(
      () =>
        rehydrateRoleGrantForPersistence({ ...grantState(grant(10)), roleCode: 'SYSTEM_ADMIN' }),
      'INVALID_ROLE',
    );
    expectError(
      () =>
        rehydrateMembershipForPersistence({
          ...membershipState(pending()),
          authorizationVersion: -1,
        }),
      'AUTHORIZATION_VERSION_CONFLICT',
    );
    expectError(
      () =>
        rehydrateMembershipForPersistence({
          ...membershipState(pending()),
          status: 'DISABLED',
          disabledAt: NOW,
          disabledReason: null,
        }),
      'INVALID_ENTITY',
    );
  });
  it('RHY14 rejects invalid scope shape and identifier', () => {
    expectError(
      () =>
        rehydrateRoleGrantForPersistence({
          ...grantState(grant(10)),
          scope: { type: 'SELF', scopeId: uuid(1) },
        }),
      'INVALID_SCOPE',
    );
    expectError(
      () =>
        rehydrateRoleGrantForPersistence({
          ...grantState(grant(10)),
          scope: { type: 'CLASS', scopeId: 'bad' },
        }),
      'INVALID_ID',
    );
  });
  it('RHY15 reconstructs exact version/history without command replay or persistence metadata', () => {
    const original = active().revokeGrant({ ...command(active()), grantId: roleGrantId(uuid(10)) });
    const restored = rehydrateMembershipForPersistence(membershipState(original));
    expect(restored.authorizationVersion).toBe(original.authorizationVersion);
    expect(restored.updatedAt).toBe(original.updatedAt);
    expect(restored.roleGrants[0].revokedAt).toBe(original.roleGrants[0].revokedAt);
    expect('repositoryRevision' in restored).toBe(false);
    expectError(
      () =>
        rehydrateMembershipForPersistence({
          ...membershipState(original),
          repositoryRevision: '1',
        }),
      'INVALID_ENTITY',
    );
  });
  it('RHY16 copies/freezes collections and nested values', () => {
    const item = rehydrateRoleGrantForPersistence({
      ...grantState(grant(10)),
      scope: { ...selfScope() },
    });
    const roleGrants = [item];
    const restored = rehydrateMembershipForPersistence({
      ...membershipState(pending()),
      roleGrants,
    });
    roleGrants.push(grant(11));
    expect(restored.roleGrants).toHaveLength(1);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.roleGrants)).toBe(true);
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item.scope)).toBe(true);
    expect(Reflect.set(item.scope, 'type', 'TENANT')).toBe(false);
  });

  it('TOCTOU01 rejects a changing User status accessor without invoking it', () => {
    const state = userState(User.create(USER, NOW));
    let reads = 0;
    Object.defineProperty(state, 'status', {
      enumerable: true,
      get: () => (++reads === 1 ? 'ACTIVE' : 'DISABLED'),
    });
    expectError(() => rehydrateUserForPersistence(state), 'INVALID_ENTITY');
    expect(reads).toBe(0);
  });
  it('TOCTOU02 rejects Tenant accessors before status/fact validation', () => {
    const state = tenantState(Tenant.create(TENANT, 'school_1', 'School', NOW));
    let reads = 0;
    Object.defineProperty(state, 'status', {
      enumerable: true,
      get: () => (++reads === 1 ? 'ACTIVE' : 'DISABLED'),
    });
    expectError(() => rehydrateTenantForPersistence(state), 'INVALID_ENTITY');
    expect(reads).toBe(0);
  });
  it('TOCTOU03 rejects Membership authorizationVersion accessors', () => {
    const state = membershipState(pending());
    let reads = 0;
    Object.defineProperty(state, 'authorizationVersion', {
      enumerable: true,
      get: () => ++reads,
    });
    expectError(() => rehydrateMembershipForPersistence(state), 'INVALID_ENTITY');
    expect(reads).toBe(0);
  });
  it('TOCTOU04 rejects nested RoleGrant scope accessors', () => {
    const state = grantState(grant(10));
    let reads = 0;
    Object.defineProperty(state.scope, 'type', {
      enumerable: true,
      get: () => (++reads === 1 ? 'SELF' : 'TENANT'),
    });
    expectError(() => rehydrateRoleGrantForPersistence(state), 'INVALID_ENTITY');
    expect(reads).toBe(0);
  });
  it('TOCTOU05 rejects SystemAdminGrant validity accessors', () => {
    const state = adminState(admin());
    let reads = 0;
    Object.defineProperty(state, 'validFrom', {
      enumerable: true,
      get: () => (++reads === 1 ? NOW : NaN),
    });
    expectError(() => rehydrateSystemAdminGrantForPersistence(state), 'INVALID_ENTITY');
    expect(reads).toBe(0);
  });
});
