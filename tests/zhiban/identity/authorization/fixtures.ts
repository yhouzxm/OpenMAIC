import { createHash } from 'node:crypto';
import {
  Membership,
  RoleGrant,
  instant,
  membershipId,
  userId,
  tenantId,
  roleGrantId,
  tenantScope,
  type RoleCode,
  type Scope,
} from '@/lib/zhiban/domain/identity';
import { ApprovedIdentityCatalog } from '@/lib/zhiban/infrastructure/identity/authorization/identity-catalog';

export const id = (n: number) => `018f0000-0000-7000-8000-${n.toString().padStart(12, '0')}`;
export const tenant = tenantId(id(1));
export const time = instant(3000);
export function grant(
  n: number,
  code: RoleCode = 'TENANT_ADMIN',
  scope: Scope = tenantScope(),
  from = 1000,
  until: number | null = null,
) {
  return RoleGrant.create({
    id: roleGrantId(id(n)),
    roleCode: code,
    scope,
    createdAt: instant(1000),
    validFrom: instant(from),
    validUntil: until === null ? null : instant(until),
  });
}
export function member(n: number, grants: readonly RoleGrant[] = [grant(n + 1000)], t = tenant) {
  return Membership.create({
    id: membershipId(id(n)),
    userId: userId(id(n + 100)),
    tenantId: t,
    now: instant(1000),
  }).activatePending({
    now: instant(1000),
    expectedAuthorizationVersion: 0,
    approvedGrants: grants,
  });
}
/** Explicit fixture configuration, never exported from production. */
export function catalogConfig() {
  const codes = ['STUDENT', 'TEACHER', 'TENANT_ADMIN'] as const;
  const roleIds = { STUDENT: id(201), TEACHER: id(202), TENANT_ADMIN: id(203) };
  const roles = codes.map((code) => ({
    id: roleIds[code],
    code,
    permissions:
      code === 'TENANT_ADMIN' ? ['membership:read', 'membership:manage', 'role:assign'] : [],
  }));
  return {
    roleIds,
    approvalRecord: 'test-only-approval',
    expectedDigest: createHash('sha256')
      .update(
        JSON.stringify({
          version: 'identity-v1',
          actionVersion: 'identity-v1',
          delegationVersion: 'identity-v1',
          approvalRecord: 'test-only-approval',
          roles,
        }),
      )
      .digest('hex'),
  };
}
export const catalogPort = () => new ApprovedIdentityCatalog(catalogConfig());
