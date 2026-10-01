import { describe, expect, it } from 'vitest';
import {
  repositoryRevision, tenantScopeContext,
  type Loaded,
} from '@/lib/zhiban/application/identity/ports';
import {
  Membership, RoleGrant, SystemAdminGrant, Tenant, User,
  instant, membershipId, roleGrantId, selfScope, systemAdminGrantId, tenantId, userId,
} from '@/lib/zhiban/domain/identity';
import { FakeIdentityRepository, FakeMembershipRepository, FakeTenantRepository } from './fakes';

const uuid = (n: number) => `01996e82-5800-7000-8000-${n.toString().padStart(12, '0')}`;
const now = instant(1000);
const later = instant(3000);
const subject = userId(uuid(1));
const tenant = tenantId(uuid(2));
const context = tenantScopeContext(tenant);
const pending = () => Membership.create({
  id: membershipId(uuid(3)), userId: subject, tenantId: tenant, now,
});
const disabled = () => pending().disable({
  now: later, expectedAuthorizationVersion: 0, reason: 'original',
});
const grant = (n: number, validFrom = now, validUntil: ReturnType<typeof instant> | null = null) =>
  RoleGrant.create({
    id: roleGrantId(uuid(n)), roleCode: 'TEACHER', scope: selfScope(),
    createdAt: now, validFrom, validUntil,
  });

type MembershipState = Pick<Membership,
  'id' | 'userId' | 'tenantId' | 'status' | 'roleGrants' | 'authorizationVersion' |
  'createdAt' | 'updatedAt' | 'disabledAt' | 'disabledReason'>;

// Fault injection for the Fake's persistence consistency checks, NOT Domain issuance.
// No privileged import, constructor bypass, or change to the Domain test allowlist.
function changedSnapshot(member: Membership, changes: Partial<MembershipState>): Membership {
  return Object.freeze({ ...member, ...changes }) as unknown as Membership;
}

async function expectRejectedUnchanged(stored: Membership, candidate: Membership): Promise<void> {
  const repo = new FakeMembershipRepository();
  const first = await repo.create(context, stored);
  await expect(repo.save(context, candidate, first.revision)).rejects.toMatchObject({
    code: 'INTEGRITY_FAILURE',
  });
  const loaded = await repo.findById(context, stored.id);
  expect(loaded).toBe(first);
  expect(loaded?.value).toBe(stored);
  expect(loaded?.value.updatedAt).toBe(stored.updatedAt);
  expect(loaded?.revision).toBe('1');
}

describe('SA01-SA10 same-auth complete persistence state', () => {
  it('SA01 equal complete state returns current stored Loaded and unchanged revision', async () => {
    const repo = new FakeMembershipRepository();
    const first = await repo.create(context, pending());
    const equal = pending();
    expect(equal).not.toBe(first.value);
    expect(await repo.save(context, equal, first.revision)).toBe(first);
    expect(await repo.findById(context, first.value.id)).toBe(first);
    expect(first.revision).toBe('1');
  });

  it('SA02 updatedAt forward with unchanged authVersion rejects without a write', async () => {
    const stored = pending();
    const candidate = changedSnapshot(stored, { updatedAt: later });
    expect(candidate.authorizationVersion).toBe(stored.authorizationVersion);
    expect(candidate.updatedAt).toBeGreaterThan(stored.updatedAt);
    await expectRejectedUnchanged(stored, candidate);
  });

  it('SA03 createdAt change with unchanged authVersion rejects', async () => {
    const stored = pending();
    await expectRejectedUnchanged(stored, changedSnapshot(stored, { createdAt: instant(500) }));
  });

  it('SA04 status change with unchanged authVersion rejects', async () => {
    const stored = pending();
    await expectRejectedUnchanged(stored, changedSnapshot(stored, { status: 'ACTIVE' }));
  });

  it('SA05 disabledAt change with unchanged authVersion rejects', async () => {
    const stored = disabled();
    await expectRejectedUnchanged(stored, changedSnapshot(stored, { disabledAt: instant(2000) }));
  });

  it('SA06 disabledReason change with unchanged authVersion rejects', async () => {
    const stored = disabled();
    await expectRejectedUnchanged(stored, changedSnapshot(stored, { disabledReason: 'changed' }));
  });

  it('SA07 complete grant history change with unchanged authVersion rejects', async () => {
    const stored = pending();
    await expectRejectedUnchanged(stored, changedSnapshot(stored, { roleGrants: [grant(10)] }));
  });

  it('SA08 expired/future/revoked history differences reject even with equal effective grants', async () => {
    const history = [grant(20, now, instant(2000)), grant(21, instant(4000)), grant(22)];
    const active = pending().activatePending({
      now: instant(1500), expectedAuthorizationVersion: 0, approvedGrants: history,
    });
    const stored = active.revokeGrant({
      now: later, expectedAuthorizationVersion: active.authorizationVersion, grantId: history[2].id,
    });
    expect(stored.effectiveGrantsAt(later)).toEqual([]);
    const variants = [
      [grant(20, now, instant(2500)), stored.roleGrants[1], stored.roleGrants[2]],
      [stored.roleGrants[0], grant(21, instant(5000)), stored.roleGrants[2]],
      [stored.roleGrants[0], stored.roleGrants[1], grant(22).revoke(instant(2000))],
    ];
    for (const roleGrants of variants) {
      expect(roleGrants.filter((item) => item.isEffectiveAt(later))).toEqual([]);
      await expectRejectedUnchanged(stored, changedSnapshot(stored, { roleGrants }));
    }
  });

  it('SA09 lower authVersion rejects even with all other persistence facts equal', async () => {
    const stored = disabled();
    await expectRejectedUnchanged(stored, changedSnapshot(stored, { authorizationVersion: 0 }));
  });

  it('SA10 higher authVersion with otherwise equal facts is a write, including a jump', async () => {
    const repo = new FakeMembershipRepository();
    const active = pending().activatePending({
      now: later, expectedAuthorizationVersion: 0, approvedGrants: [],
    });
    const first = await repo.create(context, active);
    let candidate = active;
    for (let i = 0; i < 3; i++) {
      candidate = candidate.replaceGrants({
        now: later, expectedAuthorizationVersion: candidate.authorizationVersion, approvedGrants: [],
      });
    }
    expect(candidate.authorizationVersion).toBe(active.authorizationVersion + 3);
    expect({ ...candidate, authorizationVersion: active.authorizationVersion }).toEqual({ ...active });
    const second = await repo.save(context, candidate, first.revision);
    expect(second.value).toBe(candidate);
    expect(second.revision).toBe('2');
    expect(await repo.findById(context, active.id)).toBe(second);
    expect(first.value).toBe(active);
    expect(first.revision).toBe('1');
  });

  it('same-auth user relationship change rejects without changing stored state', async () => {
    const stored = pending();
    await expectRejectedUnchanged(stored, changedSnapshot(stored, { userId: userId(uuid(99)) }));
  });

  it('same-auth tenant relationship change fails scope and leaves storage unchanged', async () => {
    const repo = new FakeMembershipRepository();
    const stored = await repo.create(context, pending());
    const candidate = changedSnapshot(stored.value, { tenantId: tenantId(uuid(99)) });
    await expect(repo.save(context, candidate, stored.revision)).rejects.toMatchObject({
      code: 'TENANT_SCOPE_VIOLATION',
    });
    expect(await repo.findById(context, stored.value.id)).toBe(stored);
    expect(stored.revision).toBe('1');
  });
});

const maxRevision = repositoryRevision('9223372036854775807');

// Boundary setup confined to this test: access existing Fake storage, not a new Port/Fake API.
function seedMaxRevision<T extends { readonly id: unknown }>(
  repo: object,
  collection: 'users' | 'tenants' | 'adminGrants' | 'memberships',
  entry: Loaded<T>,
): Loaded<T> {
  const rows: unknown = Reflect.get(repo, collection);
  if (!(rows instanceof Map)) throw new TypeError('Expected Fake row storage.');
  const stored = Object.freeze({ value: entry.value, revision: maxRevision });
  rows.set(entry.value.id, stored);
  return stored;
}

describe('signed-int8 maximum revision state-changing saves fail closed', () => {
  it('MAX01 User overflow leaves stored User and maximum revision unchanged', async () => {
    const repo = new FakeIdentityRepository();
    const stored = seedMaxRevision(repo, 'users', await repo.create(User.create(subject, now)));
    expect(await repo.save(User.create(subject, now), maxRevision)).toBe(stored);
    await expect(repo.save(stored.value.disable(later, 'review'), maxRevision)).rejects.toMatchObject({
      code: 'INTEGRITY_FAILURE',
    });
    expect(await repo.findById(subject)).toBe(stored);
    expect(stored.value.status).toBe('ACTIVE');
    expect(stored.revision).toBe('9223372036854775807');
  });

  it('MAX02 Tenant overflow leaves stored Tenant and maximum revision unchanged', async () => {
    const repo = new FakeTenantRepository();
    const stored = seedMaxRevision(repo, 'tenants', await repo.create(Tenant.create(tenant, 'alpha', 'Alpha', now)));
    expect(await repo.save(Tenant.create(tenant, 'alpha', 'Alpha', now), maxRevision)).toBe(stored);
    await expect(repo.save(stored.value.disable(later, 'review'), maxRevision)).rejects.toMatchObject({
      code: 'INTEGRITY_FAILURE',
    });
    expect(await repo.findById(tenant)).toBe(stored);
    expect(stored.value.status).toBe('ACTIVE');
    expect(stored.revision).toBe('9223372036854775807');
  });

  it('MAX03 SystemAdminGrant overflow leaves grant and maximum revision unchanged', async () => {
    const repo = new FakeIdentityRepository();
    const value = SystemAdminGrant.create({
      id: systemAdminGrantId(uuid(4)), userId: subject, createdAt: now, validFrom: now, validUntil: null,
    });
    const stored = seedMaxRevision(repo, 'adminGrants', await repo.createSystemAdminGrant(value));
    expect(await repo.saveSystemAdminGrant(value, maxRevision)).toBe(stored);
    await expect(repo.saveSystemAdminGrant(value.revoke(later), maxRevision)).rejects.toMatchObject({
      code: 'INTEGRITY_FAILURE',
    });
    expect(await repo.findSystemAdminGrant(value.id)).toBe(stored);
    expect(stored.value.revokedAt).toBeNull();
    expect(stored.revision).toBe('9223372036854775807');
  });

  it('MAX04 Membership overflow leaves aggregate and maximum revision unchanged', async () => {
    const repo = new FakeMembershipRepository();
    const stored = seedMaxRevision(repo, 'memberships', await repo.create(context, pending()));
    expect(await repo.save(context, pending(), maxRevision)).toBe(stored);
    const candidate = stored.value.activatePending({
      now: later, expectedAuthorizationVersion: stored.value.authorizationVersion, approvedGrants: [grant(10)],
    });
    await expect(repo.save(context, candidate, maxRevision)).rejects.toMatchObject({
      code: 'INTEGRITY_FAILURE',
    });
    expect(await repo.findById(context, stored.value.id)).toBe(stored);
    expect(stored.value.status).toBe('PENDING');
    expect(stored.value.authorizationVersion).toBe(0);
    expect(stored.value.roleGrants).toEqual([]);
    expect(stored.revision).toBe('9223372036854775807');
  });
});
