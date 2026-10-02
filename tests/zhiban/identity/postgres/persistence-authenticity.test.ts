import { describe, expect, it } from 'vitest';
import {
  User,
  Tenant,
  Membership,
  SystemAdminGrant,
  instant,
  userId,
  tenantId,
  membershipId,
  systemAdminGrantId,
} from '@/lib/zhiban/domain/identity';
import { assertAuthenticUserForPersistence } from '@/lib/zhiban/domain/identity/user';
import { assertAuthenticTenantForPersistence } from '@/lib/zhiban/domain/identity/tenant';
import { assertAuthenticSystemAdminGrantForPersistence } from '@/lib/zhiban/domain/identity/system-admin-grant';
import { assertAuthenticMembershipForPersistence } from '@/lib/zhiban/domain/identity/membership';
import { userFromRow, userToRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/user';
import {
  tenantFromRow,
  tenantToRow,
} from '@/lib/zhiban/infrastructure/identity/postgres/mappers/tenant';
import {
  systemAdminGrantFromRow,
  systemAdminGrantToRow,
} from '@/lib/zhiban/infrastructure/identity/postgres/mappers/system-admin-grant';
import {
  membershipFromRows,
  membershipToRows,
} from '@/lib/zhiban/infrastructure/identity/postgres/mappers/membership';

const uid = userId('018f0000-0000-7000-8000-000000000001');
const tid = tenantId('018f0000-0000-7000-8000-000000000002');
const now = instant(1000);

describe('mapper reconstruction cannot prove original-candidate authenticity', () => {
  const cases: readonly {
    name: string;
    original: () => object;
    roundtrip: (value: unknown) => unknown;
    assert: (value: unknown) => void;
  }[] = [
    {
      name: 'User',
      original: () => User.create(uid, now),
      roundtrip: (value) =>
        userFromRow({ ...userToRow(value as User), repository_revision: '1' }).value,
      assert: assertAuthenticUserForPersistence,
    },
    {
      name: 'Tenant',
      original: () => Tenant.create(tid, 'school', 'School', now),
      roundtrip: (value) =>
        tenantFromRow({ ...tenantToRow(value as Tenant), repository_revision: '1' }).value,
      assert: assertAuthenticTenantForPersistence,
    },
    {
      name: 'SystemAdminGrant',
      original: () =>
        SystemAdminGrant.create({
          id: systemAdminGrantId('018f0000-0000-7000-8000-000000000004'),
          userId: uid,
          createdAt: now,
          validFrom: now,
          validUntil: null,
        }),
      roundtrip: (value) =>
        systemAdminGrantFromRow({
          ...systemAdminGrantToRow(value as SystemAdminGrant),
          repository_revision: '1',
        }).value,
      assert: assertAuthenticSystemAdminGrantForPersistence,
    },
    {
      name: 'Membership',
      original: () =>
        Membership.create({
          id: membershipId('018f0000-0000-7000-8000-000000000003'),
          userId: uid,
          tenantId: tid,
          now,
        }),
      roundtrip: (value) => {
        const rows = membershipToRows(value as Membership);
        return membershipFromRows({ ...rows.membership, repository_revision: '1' }, rows.roleGrants)
          .value;
      },
      assert: assertAuthenticMembershipForPersistence,
    },
  ];
  it.each(cases)(
    '$name: rehydrated copy passes, original frozen field-copy forgery still fails',
    ({ original, roundtrip, assert }) => {
      const issued = original();
      const forged = Object.freeze(
        Object.assign(Object.create(Object.getPrototypeOf(issued)), issued),
      );
      expect(forged).toBeInstanceOf(issued.constructor);
      expect(Object.isFrozen(forged)).toBe(true);
      expect(() => assert(forged)).toThrow(expect.objectContaining({ code: 'INVALID_ENTITY' }));
      const reconstructed = roundtrip(forged);
      expect(reconstructed).toEqual(issued);
      expect(reconstructed).not.toBe(forged);
      expect(assert(reconstructed)).toBeUndefined();
      expect(() => assert(forged)).toThrow(expect.objectContaining({ code: 'INVALID_ENTITY' }));
    },
  );
});
