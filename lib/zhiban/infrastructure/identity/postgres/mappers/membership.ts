import type { Membership } from '@/lib/zhiban/domain/identity/membership';
import { membershipId, roleGrantId, tenantId, userId } from '@/lib/zhiban/domain/identity/ids';
import { roleCode } from '@/lib/zhiban/domain/identity/role';
import { parseScope } from '@/lib/zhiban/domain/identity/scope';
import { instant } from '@/lib/zhiban/domain/identity/time';
import { rehydrateMembershipForPersistence, rehydrateRoleGrantForPersistence } from '@/lib/zhiban/domain/identity/persistence-rehydration';
import { repositoryRevision, type Loaded } from '@/lib/zhiban/application/identity/ports/repository-types';
import { checkRow, checkedInteger, checkedNullableText, instantMaximum, safeIntegerMaximum, int8Maximum, integrityFailure } from './checked-values';

export interface MembershipRow {
  readonly membership_id: string;
  readonly user_id: string;
  readonly tenant_id: string;
  readonly status: string;
  readonly authorization_version: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly disabled_at: string | null;
  readonly disabled_reason: string | null;
  readonly repository_revision: string;
}

export interface RoleGrantRow {
  readonly grant_id: string;
  readonly tenant_id: string;
  readonly membership_id: string;
  readonly grant_ordinal: string;
  readonly role_code: string;
  readonly scope_kind: string;
  readonly scope_id: string | null;
  readonly created_at: string;
  readonly valid_from: string;
  readonly valid_until: string | null;
  readonly revoked_at: string | null;
}

const parentColumns = ['membership_id', 'user_id', 'tenant_id', 'status', 'authorization_version', 'created_at', 'updated_at', 'disabled_at', 'disabled_reason', 'repository_revision'];
const childColumns = ['grant_id', 'tenant_id', 'membership_id', 'grant_ordinal', 'role_code', 'scope_kind', 'scope_id', 'created_at', 'valid_from', 'valid_until', 'revoked_at'];

function rowRecord(value: unknown, columns: readonly string[]): Readonly<Record<string, unknown>> {
  checkRow(value, columns, columns === parentColumns ? ['disabled_at', 'disabled_reason'] : ['scope_id', 'valid_until', 'revoked_at']);
  const result: Record<string, unknown> = {};
  for (const field of columns) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) integrityFailure();
    result[field] = descriptor.value;
  }
  return Object.freeze(result);
}

function epoch(value: unknown) { return instant(Number(checkedInteger(value, instantMaximum))); }
function nullableEpoch(value: unknown) { return value === null ? null : epoch(value); }
function authorizationVersion(value: unknown) { return Number(checkedInteger(value, safeIntegerMaximum)); }
function ordinal(value: unknown) { return checkedInteger(value, int8Maximum); }

/** Private child reconstruction, reachable only from the complete aggregate terminal. */
function roleGrantFromRow(row: Readonly<Record<string, unknown>>) {
  const snapshot = {
    id: roleGrantId(row.grant_id), roleCode: roleCode(row.role_code),
    scope: parseScope(row.scope_kind, row.scope_id),
    createdAt: epoch(row.created_at), validFrom: epoch(row.valid_from),
    validUntil: nullableEpoch(row.valid_until), revokedAt: nullableEpoch(row.revoked_at),
  };
  return rehydrateRoleGrantForPersistence(snapshot);
}

export function membershipFromRows(parentInput: MembershipRow, childInput: readonly RoleGrantRow[]): Loaded<Membership> {
  const row = rowRecord(parentInput, parentColumns);
  if (!Array.isArray(childInput)) integrityFailure();
  const children = Array.from(childInput).map(child => rowRecord(child, childColumns));
  const ordered = children.map(child => ({ row: child, ordinal: ordinal(child.grant_ordinal) }))
    .sort((a, b) => a.ordinal < b.ordinal ? -1 : a.ordinal > b.ordinal ? 1 : 0);
  const id = membershipId(row.membership_id);
  const tenant = tenantId(row.tenant_id);
  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index];
    if (entry.ordinal !== BigInt(index) || membershipId(entry.row.membership_id) !== id ||
        tenantId(entry.row.tenant_id) !== tenant) integrityFailure();
  }
  const roleGrants = ordered.map(entry => roleGrantFromRow(entry.row));
  const snapshot = {
    id: id, userId: userId(row.user_id), tenantId: tenant, status: row.status, roleGrants,
    authorizationVersion: authorizationVersion(row.authorization_version),
    createdAt: epoch(row.created_at), updatedAt: epoch(row.updated_at),
    disabledAt: nullableEpoch(row.disabled_at), disabledReason: row.disabled_reason,
  };
  const value = rehydrateMembershipForPersistence(snapshot);
  const rawRevision = row.repository_revision;
  if (typeof rawRevision !== 'string') integrityFailure();
  const revision = repositoryRevision(rawRevision);
  return { value, revision };
}

/** Stable history order determines ordinals; repositories retain/update history under parent CAS. */
export function membershipToRows(value: Membership): {
  readonly membership: Omit<MembershipRow, 'repository_revision'>;
  readonly roleGrants: readonly RoleGrantRow[];
} {
  return {
    membership: {
      membership_id: value.id, user_id: value.userId, tenant_id: value.tenantId, status: value.status,
      authorization_version: value.authorizationVersion.toString(),
      created_at: value.createdAt.toString(), updated_at: value.updatedAt.toString(),
      disabled_at: value.disabledAt === null ? null : value.disabledAt.toString(),
      disabled_reason: checkedNullableText(value.disabledReason),
    },
    roleGrants: value.roleGrants.map((grant, index) => ({
      grant_id: grant.id, tenant_id: value.tenantId, membership_id: value.id,
      grant_ordinal: BigInt(index).toString(), role_code: grant.roleCode,
      scope_kind: grant.scope.type, scope_id: grant.scope.scopeId,
      created_at: grant.createdAt.toString(), valid_from: grant.validFrom.toString(),
      valid_until: grant.validUntil === null ? null : grant.validUntil.toString(),
      revoked_at: grant.revokedAt === null ? null : grant.revokedAt.toString(),
    })),
  };
}
