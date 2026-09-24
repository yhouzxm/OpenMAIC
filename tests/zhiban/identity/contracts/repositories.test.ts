import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  IdentityPortError,
  repositoryRevision,
  tenantScopeContext,
  requireTenantContext,
  type MembershipRepositoryPort,
  type RepositoryRevision,
  type TenantContext,
} from '@/lib/zhiban/application/identity/ports';
import {
  Membership,
  RoleGrant,
  SystemAdminGrant,
  Tenant,
  User,
  instant,
  membershipId,
  roleGrantId,
  selfScope,
  systemAdminGrantId,
  tenantId,
  userId,
} from '@/lib/zhiban/domain/identity';
import { FakeIdentityRepository, FakeMembershipRepository, FakeTenantRepository } from './fakes';

const NOW = instant(Date.parse('2026-09-22T12:00:00.000Z'));
const LATER = instant(NOW + 1);
const A = tenantId('01996e82-5800-7000-8000-000000000001');
const B = tenantId('01996e82-5800-7000-8000-000000000002');
const USER = userId('01996e82-5800-7000-8000-000000000003');
const MEMBER = membershipId('01996e82-5800-7000-8000-000000000004');

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(IdentityPortError);
  if (error instanceof IdentityPortError) expect(error.code).toBe(code);
}

describe('global identity and tenant repository contracts', () => {
  it('creates, reads, conditionally saves, and reports duplicate/stale writes', async () => {
    const repo = new FakeIdentityRepository();
    const user = User.create(USER, NOW);
    expect(await repo.findById(USER)).toBeNull();
    const first = await repo.create(user);
    expect((await repo.findById(USER))?.value).toBe(user);
    await expect(repo.create(user)).rejects.toMatchObject({ code: 'CONFLICT' });
    const disabled = user.disable(LATER, 'review');
    const second = await repo.save(disabled, first.revision);
    expect(second.value.status).toBe('DISABLED');
    expect(second.revision).not.toBe(first.revision);
    await expect(repo.save(user, first.revision)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect((await repo.findById(USER))?.value.status).toBe('DISABLED');
  });

  it('keeps SystemAdminGrant in a restricted global store, without tenant context', async () => {
    const repo = new FakeIdentityRepository();
    const grant = SystemAdminGrant.create({
      id: systemAdminGrantId('01996e82-5800-7000-8000-000000000005'),
      userId: USER,
      createdAt: NOW,
      validFrom: NOW,
      validUntil: null,
    });
    const first = await repo.createSystemAdminGrant(grant);
    expect((await repo.findSystemAdminGrant(grant.id))?.value.userId).toBe(USER);
    const revoked = grant.revoke(LATER);
    await repo.saveSystemAdminGrant(revoked, first.revision);
    expect((await repo.findSystemAdminGrant(grant.id))?.value.isRevoked).toBe(true);
  });

  it('looks up tenant by id/code and rejects code/id duplicates', async () => {
    const repo = new FakeTenantRepository();
    const tenant = Tenant.create(A, 'alpha', 'Alpha', NOW);
    expect(await repo.findByCode('alpha')).toBeNull();
    const first = await repo.create(tenant);
    expect((await repo.findById(A))?.value.code).toBe('alpha');
    expect((await repo.findByCode('alpha'))?.value.id).toBe(A);
    await expect(repo.create(Tenant.create(B, 'alpha', 'Other', NOW))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await repo.save(tenant.disable(LATER, 'review'), first.revision);
    await expect(repo.save(tenant, first.revision)).rejects.toMatchObject({ code: 'STALE_WRITE' });
  });
});

describe('tenant-scoped membership contract', () => {
  it('requires a context on every method at the type boundary', () => {
    expectTypeOf<
      Parameters<MembershipRepositoryPort['findById']>[0]
    >().toEqualTypeOf<TenantContext>();
    expectTypeOf<
      Parameters<MembershipRepositoryPort['findByUser']>[0]
    >().toEqualTypeOf<TenantContext>();
    expectTypeOf<
      Parameters<MembershipRepositoryPort['create']>[0]
    >().toEqualTypeOf<TenantContext>();
    expectTypeOf<Parameters<MembershipRepositoryPort['save']>[0]>().toEqualTypeOf<TenantContext>();
  });

  it('denies cross-tenant read without disclosing membership existence', async () => {
    const repo = new FakeMembershipRepository();
    const contextA = tenantScopeContext(A);
    const contextB = tenantScopeContext(B);
    const member = Membership.create({ id: MEMBER, userId: USER, tenantId: A, now: NOW });
    await repo.create(contextA, member);
    expect((await repo.findById(contextA, MEMBER))?.value.id).toBe(MEMBER);
    expect((await repo.findByUser(contextA, USER))?.value.id).toBe(MEMBER);
    expect(await repo.findById(contextB, MEMBER)).toBeNull();
    expect(await repo.findByUser(contextB, USER)).toBeNull();
    await expect(repo.create(contextB, member)).rejects.toMatchObject({
      code: 'TENANT_SCOPE_VIOLATION',
    });
    await expect(
      repo.save(contextB, member, repositoryRevision('wrong-tenant-token')),
    ).rejects.toMatchObject({
      code: 'TENANT_SCOPE_VIOLATION',
    });
  });

  it('rejects absent or malformed context but treats a copied valid context as scope only', async () => {
    const repo = new FakeMembershipRepository();
    const valid = tenantScopeContext(A);
    const absent = null as unknown as TenantContext;
    const invalid = { tenantId: 'invalid' } as TenantContext;
    const copied = { ...valid } as TenantContext;
    const member = Membership.create({ id: MEMBER, userId: USER, tenantId: A, now: NOW });
    for (const context of [absent, invalid]) {
      await expect(repo.findById(context, MEMBER)).rejects.toMatchObject({
        code: 'TENANT_SCOPE_VIOLATION',
      });
      await expect(repo.findByUser(context, USER)).rejects.toMatchObject({
        code: 'TENANT_SCOPE_VIOLATION',
      });
      await expect(repo.create(context, member)).rejects.toMatchObject({
        code: 'TENANT_SCOPE_VIOLATION',
      });
      await expect(repo.save(context, member, repositoryRevision('x'))).rejects.toMatchObject({
        code: 'TENANT_SCOPE_VIOLATION',
      });
    }
    expect(requireTenantContext(copied)).toBe(A);
    expect(await repo.findById(copied, MEMBER)).toBeNull();
    expect(Object.keys(valid)).toEqual(['tenantId']);
    expectCode(new IdentityPortError('TENANT_SCOPE_VIOLATION'), 'TENANT_SCOPE_VIOLATION');
  });

  it('stale repository revision cannot replace a newer authorization state', async () => {
    const repo = new FakeMembershipRepository();
    const context = tenantScopeContext(A);
    const pending = Membership.create({ id: MEMBER, userId: USER, tenantId: A, now: NOW });
    const loaded = await repo.create(context, pending);
    const active = pending.activatePending({
      now: LATER,
      expectedAuthorizationVersion: pending.authorizationVersion,
      approvedGrants: [],
    });
    const updated = await repo.save(context, active, loaded.revision);
    expect(updated.value.authorizationVersion).toBe(1);
    expect(updated.revision).not.toBe(loaded.revision);
    await expect(repo.save(context, pending, loaded.revision)).rejects.toMatchObject({
      code: 'STALE_WRITE',
    });
    expect((await repo.findById(context, MEMBER))?.value.status).toBe('ACTIVE');
    expectTypeOf<RepositoryRevision>().not.toEqualTypeOf<number>();
  });

  it('rejects identity rebind and authorizationVersion rollback without changing storage', async () => {
    const repo = new FakeMembershipRepository();
    const context = tenantScopeContext(A);
    const pending = Membership.create({ id: MEMBER, userId: USER, tenantId: A, now: NOW });
    const first = await repo.create(context, pending);
    const otherUser = userId('01996e82-5800-7000-8000-000000000099');
    const rebound = Membership.create({ id: MEMBER, userId: otherUser, tenantId: A, now: NOW });
    await expect(repo.save(context, rebound, first.revision)).rejects.toMatchObject({
      code: 'INTEGRITY_FAILURE',
    });
    const otherTenant = Membership.create({ id: MEMBER, userId: USER, tenantId: B, now: NOW });
    await expect(repo.save(context, otherTenant, first.revision)).rejects.toMatchObject({
      code: 'TENANT_SCOPE_VIOLATION',
    });
    expect((await repo.findById(context, MEMBER))?.value).toBe(pending);
    expect((await repo.findById(context, MEMBER))?.revision).toBe(first.revision);

    const equal = await repo.save(context, pending, first.revision);
    expect(equal.revision).not.toBe(first.revision);
    expect(equal.value.authorizationVersion).toBe(0);
    const active = pending.activatePending({
      now: LATER,
      expectedAuthorizationVersion: 0,
      approvedGrants: [],
    });
    const higher = await repo.save(context, active, equal.revision);
    expect(higher.value.authorizationVersion).toBe(1);
    await expect(repo.save(context, pending, higher.revision)).rejects.toMatchObject({
      code: 'INTEGRITY_FAILURE',
    });
    expect((await repo.findById(context, MEMBER))?.value).toBe(active);
    expect((await repo.findById(context, MEMBER))?.revision).toBe(higher.revision);
  });

  it('cannot overwrite a revoked grant with an older aggregate and a current persistence token', async () => {
    const repo = new FakeMembershipRepository();
    const context = tenantScopeContext(A);
    const pending = Membership.create({ id: MEMBER, userId: USER, tenantId: A, now: NOW });
    const first = await repo.create(context, pending);
    const grant = RoleGrant.create({
      id: roleGrantId('01996e82-5800-7000-8000-000000000077'),
      roleCode: 'TEACHER',
      scope: selfScope(),
      createdAt: NOW,
      validFrom: NOW,
      validUntil: null,
    });
    const active = pending.activatePending({
      now: LATER,
      expectedAuthorizationVersion: 0,
      approvedGrants: [grant],
    });
    const activeEntry = await repo.save(context, active, first.revision);
    const revoked = active.revokeGrant({
      now: instant(LATER + 1),
      expectedAuthorizationVersion: active.authorizationVersion,
      grantId: grant.id,
    });
    const revokedEntry = await repo.save(context, revoked, activeEntry.revision);
    await expect(repo.save(context, active, revokedEntry.revision)).rejects.toMatchObject({
      code: 'INTEGRITY_FAILURE',
    });
    expect((await repo.findById(context, MEMBER))?.value.roleGrants[0].isRevoked).toBe(true);
    expect((await repo.findById(context, MEMBER))?.revision).toBe(revokedEntry.revision);
  });
});
