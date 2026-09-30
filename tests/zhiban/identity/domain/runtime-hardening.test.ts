import { describe, expect, it } from 'vitest';
import {
  Membership,
  RoleGrant,
  SystemAdminGrant,
  Tenant,
  User,
  systemAdminGrantId,
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
  grant,
  pending,
  uuid,
} from './fixtures';

describe('runtime Domain integrity', () => {
  it('DH01 has no externally callable internal Membership transition', () => {
    const current = active();
    for (const name of ['changed', 'check', 'replacement', 'internalChanged', '#changed']) {
      expect(Reflect.get(current, name)).toBeUndefined();
      expect(Reflect.get(Membership.prototype, name)).toBeUndefined();
    }
    expect(current.authorizationVersion).toBe(1);
  });
  it('DH02 dynamic/cast-like access cannot call a private transition', () => {
    const current = active();
    const dynamic: Record<string, unknown> = current as unknown as Record<string, unknown>;
    expect(() =>
      Reflect.apply(dynamic.changed as (...args: unknown[]) => unknown, current, []),
    ).toThrow();
    expect(current.status).toBe('ACTIVE');
  });
  it('DH03 forged receivers cannot execute public commands or eligibility queries', () => {
    const user = Object.create(User.prototype) as User;
    const tenant = Object.create(Tenant.prototype) as Tenant;
    const membership = Object.create(Membership.prototype) as Membership;
    const roleGrant = Object.create(RoleGrant.prototype) as RoleGrant;
    const systemGrant = Object.create(SystemAdminGrant.prototype) as SystemAdminGrant;
    expect(() => User.prototype.disable.call(user, NOW, 'reason')).toThrow();
    expect(() => User.prototype.restore.call(user, NOW)).toThrow();
    expect(() => Tenant.prototype.disable.call(tenant, NOW, 'reason')).toThrow();
    expect(() => Tenant.prototype.restore.call(tenant, NOW)).toThrow();
    expect(() => Tenant.prototype.archive.call(tenant, NOW)).toThrow();
    expect(() =>
      Membership.prototype.disable.call(membership, { ...command(active()), reason: 'reason' }),
    ).toThrow();
    expect(() => Membership.prototype.effectiveGrantsAt.call(membership, NOW)).toThrow();
    const expected = command(active());
    for (const action of [
      () =>
        Membership.prototype.activatePending.call(membership, { ...expected, approvedGrants: [] }),
      () =>
        Membership.prototype.reactivate.call(membership, {
          ...expected,
          mode: 'PRESERVE_EXISTING_VALID_GRANTS' as const,
          approvedGrantIds: [],
        }),
      () => Membership.prototype.leave.call(membership, expected),
      () => Membership.prototype.rejoin.call(membership, { ...expected, approvedGrants: [] }),
      () =>
        Membership.prototype.grantRole.call(membership, { ...expected, approvedGrant: grant(10) }),
      () =>
        Membership.prototype.revokeGrant.call(membership, { ...expected, grantId: grant(10).id }),
      () =>
        Membership.prototype.replaceGrants.call(membership, { ...expected, approvedGrants: [] }),
    ])
      expect(action).toThrow();
    expect(() => RoleGrant.prototype.revoke.call(roleGrant, NOW)).toThrow();
    expect(() => RoleGrant.prototype.isExpired.call(roleGrant, NOW)).toThrow();
    expect(() => RoleGrant.prototype.isNotYetEffective.call(roleGrant, NOW)).toThrow();
    expect(() => RoleGrant.prototype.isEffectiveAt.call(roleGrant, NOW)).toThrow();
    expect(() => Reflect.get(RoleGrant.prototype, 'isRevoked', roleGrant)).toThrow();
    expect(() => SystemAdminGrant.prototype.revoke.call(systemGrant, NOW)).toThrow();
    expect(() => SystemAdminGrant.prototype.isEffectiveAt.call(systemGrant, NOW)).toThrow();
    expect(() => Reflect.get(SystemAdminGrant.prototype, 'isRevoked', systemGrant)).toThrow();
    expect(() => pending([roleGrant])).toThrow();
  });
  it('DH04 direct and reflected constructors reject missing or wrong tokens', () => {
    for (const constructor of [User, Tenant, Membership, RoleGrant, SystemAdminGrant]) {
      expect(() => Reflect.construct(constructor, [])).toThrow();
      expect(() => Reflect.construct(constructor, [Symbol('forged')])).toThrow();
      expect(() => Reflect.construct(constructor, [undefined])).toThrow();
      expect(() => Reflect.construct(constructor, [{}])).toThrow();
    }
    expect(() =>
      Reflect.construct(User.create(USER, NOW).constructor, [Symbol('forged')]),
    ).toThrow();
  });
  it('DH05 fresh factories issue authentic frozen instances', () => {
    const user = User.create(USER, NOW);
    const tenant = Tenant.create(TENANT, 'school', 'School', NOW);
    const membership = active();
    const item = grant(10);
    const system = SystemAdminGrant.create({
      id: systemAdminGrantId(uuid(40)),
      userId: USER,
      createdAt: BEFORE,
      validFrom: NOW,
      validUntil: null,
    });
    expect(user.disable(AFTER, 'review').status).toBe('DISABLED');
    expect(tenant.archive(AFTER).status).toBe('ARCHIVED');
    expect(membership.effectiveGrantsAt(NOW)).toHaveLength(1);
    expect(item.isEffectiveAt(NOW)).toBe(true);
    expect(system.isEffectiveAt(NOW)).toBe(true);
    for (const value of [user, tenant, membership, item, system])
      expect(Object.isFrozen(value)).toBe(true);
  });
  it('DH06 privileged reconstruction issues authentic, frozen historical instances', () => {
    const user = rehydrateUserForPersistence({ ...User.create(USER, NOW) });
    const tenant = rehydrateTenantForPersistence({
      ...Tenant.create(TENANT, 'school', 'School', NOW),
    });
    const item = rehydrateRoleGrantForPersistence({ ...grant(10), scope: { ...grant(10).scope } });
    const membership = rehydrateMembershipForPersistence({ ...active(), roleGrants: [item] });
    const system = rehydrateSystemAdminGrantForPersistence({
      ...SystemAdminGrant.create({
        id: systemAdminGrantId(uuid(40)),
        userId: USER,
        createdAt: BEFORE,
        validFrom: NOW,
        validUntil: null,
      }),
    });
    expect(user.disable(AFTER, 'review').status).toBe('DISABLED');
    expect(tenant.disable(AFTER, 'review').status).toBe('DISABLED');
    expect(membership.effectiveGrantsAt(NOW)).toHaveLength(1);
    expect(item.revoke(NOW).isRevoked).toBe(true);
    expect(system.revoke(NOW).isRevoked).toBe(true);
    for (const value of [user, tenant, membership, item, system])
      expect(Object.isFrozen(value)).toBe(true);
    expect(Reflect.get(Membership, 'rehydrate')).toBeUndefined();
  });

  it('TOCTOU06 RoleGrant.create validates and constructs one captured validity value', () => {
    const original = grant(10);
    const input = {
      id: original.id,
      roleCode: original.roleCode,
      scope: original.scope,
      createdAt: original.createdAt,
      validFrom: original.validFrom,
      validUntil: original.validUntil,
    };
    let reads = 0;
    Object.defineProperty(input, 'validFrom', {
      enumerable: true,
      get: () => (++reads === 1 ? NOW : NaN),
    });
    const issued = RoleGrant.create(input);
    expect(reads).toBe(1);
    expect(issued.validFrom).toBe(NOW);
    expect(issued.isEffectiveAt(NOW)).toBe(true);
  });
  it('TOCTOU07 Membership.create captures now and grants once', () => {
    const input = {
      id: active().id,
      userId: USER,
      tenantId: TENANT,
      now: NOW,
      roleGrants: [grant(10)],
    };
    let nowReads = 0;
    let grantsReads = 0;
    Object.defineProperty(input, 'now', {
      enumerable: true,
      get: () => (++nowReads === 1 ? NOW : NaN),
    });
    Object.defineProperty(input, 'roleGrants', {
      enumerable: true,
      get: () => (++grantsReads === 1 ? [grant(10)] : [Object.create(RoleGrant.prototype)]),
    });
    const issued = Membership.create(input);
    expect(nowReads).toBe(1);
    expect(grantsReads).toBe(1);
    expect(issued.createdAt).toBe(NOW);
    expect(issued.updatedAt).toBe(NOW);
    expect(issued.roleGrants).toHaveLength(1);
  });
  it('TOCTOU08 SystemAdminGrant.create captures validity once', () => {
    const input = {
      id: systemAdminGrantId(uuid(40)),
      userId: USER,
      createdAt: BEFORE,
      validFrom: NOW,
      validUntil: null,
    };
    let reads = 0;
    Object.defineProperty(input, 'validFrom', {
      enumerable: true,
      get: () => (++reads === 1 ? NOW : NaN),
    });
    const issued = SystemAdminGrant.create(input);
    expect(reads).toBe(1);
    expect(issued.validFrom).toBe(NOW);
    expect(issued.isEffectiveAt(NOW)).toBe(true);
  });
  it('TOCTOU09 Membership.disable cannot persist a different command time', () => {
    const current = active();
    const input = { ...command(current), reason: 'review' };
    let reads = 0;
    Object.defineProperty(input, 'now', {
      enumerable: true,
      get: () => (++reads === 1 ? AFTER : BEFORE),
    });
    const issued = current.disable(input);
    expect(reads).toBe(1);
    expect(issued.updatedAt).toBe(AFTER);
    expect(issued.disabledAt).toBe(AFTER);
  });
  it('TOCTOU10 Membership.replaceGrants captures time and approvals once', () => {
    const current = active();
    const input = { ...command(current), approvedGrants: [grant(11)] };
    let nowReads = 0;
    let grantReads = 0;
    Object.defineProperty(input, 'now', {
      enumerable: true,
      get: () => (++nowReads === 1 ? AFTER : BEFORE),
    });
    Object.defineProperty(input, 'approvedGrants', {
      enumerable: true,
      get: () => (++grantReads === 1 ? [grant(11)] : [Object.create(RoleGrant.prototype)]),
    });
    const issued = current.replaceGrants(input);
    expect(nowReads).toBe(1);
    expect(grantReads).toBe(1);
    expect(issued.updatedAt).toBe(AFTER);
    expect(issued.roleGrants.at(-1)?.id).toBe(grant(11).id);
  });
});
