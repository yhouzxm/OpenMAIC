import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  IdentityPortError, repositoryRevision, tenantScopeContext,
  type IdentityPortErrorCode, type Loaded, type RepositoryRevision,
} from '@/lib/zhiban/application/identity/ports';
import {
  User, Tenant, SystemAdminGrant, Membership, RoleGrant, instant, userId, tenantId,
  membershipId, systemAdminGrantId, roleGrantId, selfScope,
} from '@/lib/zhiban/domain/identity';
import { FakeIdentityRepository, FakeTenantRepository, FakeMembershipRepository } from './fakes';

const uuid = (n: number) => `01996e82-5800-7000-8000-${n.toString().padStart(12, '0')}`;
const now = instant(1000);
const later = instant(2000);
const subject = userId(uuid(1));
const tenant = tenantId(uuid(2));
const context = tenantScopeContext(tenant);
const pending = () => Membership.create({ id: membershipId(uuid(3)), userId: subject, tenantId: tenant, now });
const admin = () => SystemAdminGrant.create({
  id: systemAdminGrantId(uuid(4)), userId: subject, createdAt: now, validFrom: now, validUntil: null,
});
const grant = (n: number, validFrom = now, validUntil: ReturnType<typeof instant> | null = null) =>
  RoleGrant.create({ id: roleGrantId(uuid(n)), roleCode: 'TEACHER', scope: selfScope(), createdAt: now, validFrom, validUntil });
const stale = repositoryRevision('999');

describe('frozen RR01-RR10 RepositoryRevision contract', () => {
  it('RR01 minimum', () => expect(repositoryRevision('1')).toBe('1'));
  it('RR02 signed int8 maximum, preserving precision', () => {
    expect(repositoryRevision('9223372036854775807')).toBe('9223372036854775807');
    for (const value of ['2', '10', '999', '9007199254740993']) expect(repositoryRevision(value)).toBe(value);
  });
  it('RR03 zero', () => expect(() => repositoryRevision('0')).toThrow(TypeError));
  it('RR04 negative', () => expect(() => repositoryRevision('-1')).toThrow(TypeError));
  it('RR05 plus', () => expect(() => repositoryRevision('+1')).toThrow(TypeError));
  it('RR06 leading zero', () => {
    for (const value of ['01', '001']) expect(() => repositoryRevision(value)).toThrow(TypeError);
  });
  it('RR07 decimal', () => {
    for (const value of ['1.0', '1.5']) expect(() => repositoryRevision(value)).toThrow(TypeError);
  });
  it('RR08 exponent', () => {
    for (const value of ['1e3', '1E3']) expect(() => repositoryRevision(value)).toThrow(TypeError);
  });
  it('RR09 arbitrary tokens, whitespace and nonstrings', () => {
    for (const value of ['fake-1', 'rev-1', '', ' ', ' 1', '1 ', '1\n', '1\r\n'])
      expect(() => repositoryRevision(value)).toThrow(TypeError);
    for (const value of [1, null, undefined, BigInt(1), {}])
      expect(() => repositoryRevision(value as unknown as string)).toThrow(TypeError);
  });
  it('RR10 overflow', () => {
    for (const value of ['9223372036854775808', '18446744073709551615'])
      expect(() => repositoryRevision(value)).toThrow(TypeError);
  });
});

describe('frozen GN01-GN07 global no-op contracts', () => {
  it('GN01 User returns stored Loaded, not equal candidate', async () => {
    const repo = new FakeIdentityRepository();
    const first = await repo.create(User.create(subject, now));
    const equal = User.create(subject, now);
    expect(equal).not.toBe(first.value);
    expect(await repo.save(equal, first.revision)).toBe(first);
    expect(first.revision).toBe('1');
  });
  it('GN02 Tenant returns stored Loaded', async () => {
    const repo = new FakeTenantRepository();
    const first = await repo.create(Tenant.create(tenant, 'alpha', 'Alpha', now));
    expect(await repo.save(Tenant.create(tenant, 'alpha', 'Alpha', now), first.revision)).toBe(first);
    expect(first.revision).toBe('1');
  });
  it('GN03 SystemAdminGrant returns stored Loaded', async () => {
    const repo = new FakeIdentityRepository();
    const first = await repo.createSystemAdminGrant(admin());
    expect(await repo.saveSystemAdminGrant(admin(), first.revision)).toBe(first);
    expect(first.revision).toBe('1');
  });
  it('GN04 all global stale revisions fail before identical-state no-op', async () => {
    const identity = new FakeIdentityRepository();
    const tenants = new FakeTenantRepository();
    const user = await identity.create(User.create(subject, now));
    const grant = await identity.createSystemAdminGrant(admin());
    const entry = await tenants.create(Tenant.create(tenant, 'alpha', 'Alpha', now));
    await expect(identity.save(user.value, stale)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    await expect(identity.saveSystemAdminGrant(grant.value, stale)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    await expect(tenants.save(entry.value, stale)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect(await identity.findById(subject)).toBe(user);
    expect(await identity.findSystemAdminGrant(grant.value.id)).toBe(grant);
    expect(await tenants.findById(tenant)).toBe(entry);
  });
  it('GN05 User disable/restore each advances once', async () => {
    const repo = new FakeIdentityRepository();
    const first = await repo.create(User.create(subject, now));
    const second = await repo.save(first.value.disable(later, 'review'), first.revision);
    const third = await repo.save(second.value.restore(later), second.revision);
    expect([first.revision, second.revision, third.revision]).toEqual(['1', '2', '3']);
    expect(first.value.status).toBe('ACTIVE');
    expect(second.value.status).toBe('DISABLED');
    expect(await repo.save(third.value, third.revision)).toBe(third);
  });
  it('GN06 Tenant disable/restore/archive each advances once', async () => {
    const repo = new FakeTenantRepository();
    const first = await repo.create(Tenant.create(tenant, 'alpha', 'Alpha', now));
    const second = await repo.save(first.value.disable(later, 'review'), first.revision);
    const third = await repo.save(second.value.restore(later), second.revision);
    const fourth = await repo.save(third.value.archive(later), third.revision);
    expect([first.revision, second.revision, third.revision, fourth.revision]).toEqual(['1', '2', '3', '4']);
    expect(await repo.save(fourth.value, fourth.revision)).toBe(fourth);
    await expect(repo.save(third.value, fourth.revision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
  });
  it('GN07 first revoke advances once; no-op preserves first timestamp; reversal/rewrite rejects', async () => {
    const repo = new FakeIdentityRepository();
    const first = await repo.createSystemAdminGrant(admin());
    const second = await repo.saveSystemAdminGrant(first.value.revoke(later), first.revision);
    expect(second.revision).toBe('2');
    expect(await repo.saveSystemAdminGrant(admin().revoke(later), second.revision)).toBe(second);
    for (const candidate of [admin(), admin().revoke(instant(3000))])
      await expect(repo.saveSystemAdminGrant(candidate, second.revision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(await repo.findSystemAdminGrant(first.value.id)).toBe(second);
    expect(second.value.revokedAt).toBe(later);
  });
  it('global rows and separate stores advance independently', async () => {
    const repo = new FakeIdentityRepository();
    const a = await repo.create(User.create(subject, now));
    const b = await repo.create(User.create(userId(uuid(9)), now));
    const g = await repo.createSystemAdminGrant(admin());
    expect([a.revision, b.revision, g.revision]).toEqual(['1', '1', '1']);
    expect((await repo.save(a.value.disable(later, 'a'), a.revision)).revision).toBe('2');
    expect((await repo.save(b.value.disable(later, 'b'), b.revision)).revision).toBe('2');
    expect((await repo.saveSystemAdminGrant(g.value.revoke(later), g.revision)).revision).toBe('2');
    const tenants = new FakeTenantRepository();
    const t1 = await tenants.create(Tenant.create(tenant, 'alpha', 'Alpha', now));
    const t2 = await tenants.create(Tenant.create(tenantId(uuid(10)), 'beta', 'Beta', now));
    expect([t1.revision, t2.revision]).toEqual(['1', '1']);
    expect((await tenants.save(t1.value.disable(later, 'a'), t1.revision)).revision).toBe('2');
    expect((await tenants.findById(t2.value.id))?.revision).toBe('1');
  });
  it('full state comparison includes timestamps and disabled reason, not only status', async () => {
    const repo = new FakeIdentityRepository();
    const first = await repo.create(User.create(subject, now).disable(later, 'one'));
    const second = await repo.save(User.create(subject, now).disable(later, 'two'), first.revision);
    expect(second.revision).toBe('2');
    const third = await repo.save(User.create(subject, now).disable(instant(3000), 'two'), second.revision);
    expect(third.revision).toBe('3');
    await expect(repo.save(User.create(subject, later), third.revision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
  });
  it('global immutable tenant and administrator fields cannot be rebound', async () => {
    const tenants = new FakeTenantRepository();
    const first = await tenants.create(Tenant.create(tenant, 'alpha', 'Alpha', now));
    for (const candidate of [
      Tenant.create(tenant, 'beta', 'Alpha', now),
      Tenant.create(tenant, 'alpha', 'Other', now),
      Tenant.create(tenant, 'alpha', 'Alpha', later),
    ]) await expect(tenants.save(candidate, first.revision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(await tenants.findById(tenant)).toBe(first);
    const identity = new FakeIdentityRepository();
    const stored = await identity.createSystemAdminGrant(admin());
    for (const candidate of [
      SystemAdminGrant.create({ ...admin(), userId: userId(uuid(99)) }),
      SystemAdminGrant.create({ ...admin(), validFrom: later }),
      SystemAdminGrant.create({ ...admin(), validUntil: later }),
    ]) await expect(identity.saveSystemAdminGrant(candidate, stored.revision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(await identity.findSystemAdminGrant(stored.value.id)).toBe(stored);
  });
});

describe('Membership parent CAS and version contracts', () => {
  it('M1 stale revision plus identical candidate conflicts', async () => {
    const repo = new FakeMembershipRepository();
    const first = await repo.create(context, pending());
    await expect(repo.save(context, first.value, stale)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect(await repo.findById(context, first.value.id)).toBe(first);
  });
  it('M2 same authVersion and full state returns stored Loaded', async () => {
    const repo = new FakeMembershipRepository();
    const first = await repo.create(context, pending());
    expect(await repo.save(context, pending(), first.revision)).toBe(first);
    expect(first.revision).toBe('1');
  });
  it('M3 same authVersion with different disabled facts rejects', async () => {
    const repo = new FakeMembershipRepository();
    const first = await repo.create(context, pending().disable({ now: later, expectedAuthorizationVersion: 0, reason: 'one' }));
    const different = pending().disable({ now: later, expectedAuthorizationVersion: 0, reason: 'two' });
    await expect(repo.save(context, different, first.revision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(await repo.findById(context, first.value.id)).toBe(first);
  });
  it('M4 lower authVersion rejects', async () => {
    const repo = new FakeMembershipRepository();
    const first = await repo.create(context, pending().activatePending({ now: later, expectedAuthorizationVersion: 0, approvedGrants: [] }));
    await expect(repo.save(context, pending(), first.revision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
  });
  it('M5 higher authVersion is state-changing and permits multi-command jumps', async () => {
    const repo = new FakeMembershipRepository();
    const first = await repo.create(context, pending());
    const active = first.value.activatePending({ now: later, expectedAuthorizationVersion: 0, approvedGrants: [] });
    const disabled = active.disable({ now: later, expectedAuthorizationVersion: 1, reason: 'review' });
    const second = await repo.save(context, disabled, first.revision);
    expect(second.revision).toBe('2');
    expect(second.value.authorizationVersion).toBe(2);
  });
  it('M6 equivalent authorization facts with higher version are not no-op', async () => {
    const repo = new FakeMembershipRepository();
    const active = pending().activatePending({ now: later, expectedAuthorizationVersion: 0, approvedGrants: [] });
    const first = await repo.create(context, active);
    const replaced = active.replaceGrants({ now: later, expectedAuthorizationVersion: 1, approvedGrants: [] });
    const second = await repo.save(context, replaced, first.revision);
    expect(second.value).toBe(replaced);
    expect(second.revision).toBe('2');
    expect(second.value.authorizationVersion).toBe(2);
    await expect(repo.save(context, replaced, first.revision)).rejects.toMatchObject({ code: 'STALE_WRITE' });
  });
  it('M7 complete ordered active/future/expired/revoked history participates in comparison', async () => {
    const repo = new FakeMembershipRepository();
    const history = [grant(20), grant(21, instant(4000)), grant(22, now, later), grant(23).revoke(later)];
    const member = Membership.create({ id: membershipId(uuid(3)), userId: subject, tenantId: tenant, now: later, roleGrants: history });
    const first = await repo.create(context, member);
    expect(first.value.roleGrants).toEqual(history);
    expect(Object.isFrozen(first.value.roleGrants)).toBe(true);
    const equal = Membership.create({ id: member.id, userId: subject, tenantId: tenant, now: later, roleGrants: [...history] });
    expect(await repo.save(context, equal, first.revision)).toBe(first);
    for (const roleGrants of [history.slice(0, 3), [...history].reverse(), [history[0], history[1], history[2], grant(23)]]) {
      const changed = Membership.create({ id: member.id, userId: subject, tenantId: tenant, now: later, roleGrants });
      await expect(repo.save(context, changed, first.revision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    }
    expect(await repo.findById(context, member.id)).toBe(first);
  });
  it('M8 per-row revisions are independent', async () => {
    const repo = new FakeMembershipRepository();
    const first = await repo.create(context, pending());
    const other = await repo.create(context, Membership.create({ id: membershipId(uuid(30)), userId: userId(uuid(31)), tenantId: tenant, now }));
    expect([first.revision, other.revision]).toEqual(['1', '1']);
    const second = await repo.save(context, first.value.disable({ now: later, expectedAuthorizationVersion: 0, reason: 'review' }), first.revision);
    expect(second.revision).toBe('2');
    expect((await repo.findById(context, other.value.id))?.revision).toBe('1');
  });
  it('higher authVersion still cannot delete, edit or rewrite revoked history', async () => {
    const repo = new FakeMembershipRepository();
    const original = pending().activatePending({ now: later, expectedAuthorizationVersion: 0, approvedGrants: [grant(40)] });
    const revoked = original.revokeGrant({ now: later, expectedAuthorizationVersion: 1, grantId: grant(40).id });
    const stored = await repo.create(context, revoked);
    const altered = RoleGrant.create({ ...grant(40), roleCode: 'STUDENT' });
    for (const approvedGrants of [[], [altered], [grant(40)]]) {
      let candidate = pending().activatePending({ now: later, expectedAuthorizationVersion: 0, approvedGrants });
      candidate = candidate.replaceGrants({ now: instant(3000), expectedAuthorizationVersion: 1, approvedGrants: [] });
      candidate = candidate.replaceGrants({ now: instant(3000), expectedAuthorizationVersion: 2, approvedGrants: [] });
      expect(candidate.authorizationVersion).toBeGreaterThan(stored.value.authorizationVersion);
      await expect(repo.save(context, candidate, stored.revision)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    }
    expect(await repo.findById(context, revoked.id)).toBe(stored);
  });
  it('stale revision is checked before identity/history/version integrity', async () => {
    const repo = new FakeMembershipRepository();
    const stored = await repo.create(context, pending());
    const rebound = Membership.create({ id: stored.value.id, userId: userId(uuid(99)), tenantId: tenant, now });
    await expect(repo.save(context, rebound, stale)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect(await repo.findById(context, stored.value.id)).toBe(stored);
  });
});

describe('Loaded and persistence error compatibility', () => {
  it('preserves absent find null and absent save CONFLICT in every store', async () => {
    const identity = new FakeIdentityRepository();
    const tenants = new FakeTenantRepository();
    const members = new FakeMembershipRepository();
    expect(await identity.findById(subject)).toBeNull();
    expect(await identity.findSystemAdminGrant(admin().id)).toBeNull();
    expect(await tenants.findById(tenant)).toBeNull();
    expect(await members.findById(context, pending().id)).toBeNull();
    for (const save of [
      identity.save(User.create(subject, now), stale),
      identity.saveSystemAdminGrant(admin(), stale),
      tenants.save(Tenant.create(tenant, 'alpha', 'Alpha', now), stale),
      members.save(context, pending(), stale),
    ]) await expect(save).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('keeps Loaded value/revision separate from Domain state and error constructor shape', () => {
    expectTypeOf<Loaded<User>['value']>().toEqualTypeOf<User>();
    expectTypeOf<Loaded<User>['revision']>().toEqualTypeOf<RepositoryRevision>();
    expectTypeOf<ConstructorParameters<typeof IdentityPortError>>().toEqualTypeOf<[code: IdentityPortErrorCode]>();
    const error = new IdentityPortError('RETRYABLE_PERSISTENCE_FAILURE');
    expect(error.code).toBe('RETRYABLE_PERSISTENCE_FAILURE');
    expect(error.message).toBe(error.code);
    expect(error.name).toBe('IdentityPortError');
    expect(Object.keys(error).sort()).toEqual(['code', 'name']);
    expect(User.create(subject, now)).not.toHaveProperty('revision');
    expect(User.create(subject, now)).not.toHaveProperty('repositoryRevision');
  });
});
