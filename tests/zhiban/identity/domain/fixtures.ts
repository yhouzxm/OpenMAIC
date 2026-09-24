import { expect } from 'vitest';
import {
  IdentityDomainError,
  Membership,
  RoleGrant,
  instant,
  membershipId,
  roleGrantId,
  selfScope,
  tenantId,
  userId,
  type IdentityErrorCode,
  type RoleGrantInput,
} from '@/lib/zhiban/domain/identity';

export const NOW = instant(Date.parse('2026-09-22T12:00:00.000Z'));
export const BEFORE = instant(NOW - 1_000);
export const AFTER = instant(NOW + 1_000);
export const uuid = (n: number): string =>
  '01996e82-5800-7000-8000-' + n.toString(16).padStart(12, '0');
export const USER = userId(uuid(1));
export const TENANT = tenantId(uuid(2));
export const MEMBERSHIP = membershipId(uuid(3));

export function grant(n: number, overrides: Partial<RoleGrantInput> = {}): RoleGrant {
  return RoleGrant.create({
    id: roleGrantId(uuid(n)),
    roleCode: 'STUDENT',
    scope: selfScope(),
    createdAt: BEFORE,
    validFrom: BEFORE,
    validUntil: null,
    ...overrides,
  });
}
export function pending(grants: readonly RoleGrant[] = []): Membership {
  return Membership.create({
    id: MEMBERSHIP,
    userId: USER,
    tenantId: TENANT,
    now: NOW,
    roleGrants: grants,
  });
}
export function active(grants: readonly RoleGrant[] = [grant(10)]): Membership {
  return pending().activatePending({
    now: NOW,
    expectedAuthorizationVersion: 0,
    approvedGrants: grants,
  });
}
export function command(m: Membership, now = NOW) {
  return { now, expectedAuthorizationVersion: m.authorizationVersion };
}
export function expectError(action: () => unknown, code: IdentityErrorCode): void {
  expect(action).toThrow(IdentityDomainError);
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityDomainError);
    if (error instanceof IdentityDomainError) expect(error.code).toBe(code);
  }
}
