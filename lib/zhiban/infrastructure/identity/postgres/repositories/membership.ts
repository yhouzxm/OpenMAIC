import type { PoolClient } from 'pg';
import { assertAuthenticMembershipForPersistence, type Membership } from '@/lib/zhiban/domain/identity/membership';
import type { RoleGrant } from '@/lib/zhiban/domain/identity/role-grant';
import { membershipId, userId, type MembershipId, type UserId, type TenantId } from '@/lib/zhiban/domain/identity/ids';
import type { MembershipRepositoryPort } from '@/lib/zhiban/application/identity/ports/membership-repository';
import { requireTenantContext, tenantScopeContext, type TenantContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { repositoryRevision, type Loaded, type RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { membershipFromRows, membershipToRows, type MembershipRow, type RoleGrantRow } from '../mappers/membership';
import { checkedInteger, int8Maximum } from '../mappers/checked-values';
import { tenantTransaction, type TransactionPool } from '../transactions';
import { atPortBoundary, expectedRevision, integrity, nextRevision, oneRow, validateRevision } from './repository-support';

type Client = Pick<PoolClient, 'query' | 'release'>;
const parentColumns = 'membership_id, user_id, tenant_id, status, authorization_version, created_at, updated_at, disabled_at, disabled_reason, repository_revision';
const childColumns = 'grant_id, tenant_id, membership_id, grant_ordinal, role_code, scope_kind, scope_id, created_at, valid_from, valid_until, revoked_at';
const selectId = `SELECT ${parentColumns} FROM zhiban_identity.memberships WHERE tenant_id = $1 AND membership_id = $2`;
const selectUser = `SELECT ${parentColumns} FROM zhiban_identity.memberships WHERE tenant_id = $1 AND user_id = $2`;
const selectChildren = `SELECT ${childColumns} FROM zhiban_identity.role_grants WHERE tenant_id = $1 AND membership_id = $2 ORDER BY grant_ordinal, grant_id`;
const allocateOrdinal = 'SELECT COALESCE(MAX(grant_ordinal), -1::bigint) + 1 AS next_ordinal FROM zhiban_identity.role_grants WHERE tenant_id = $1 AND membership_id = $2';
const insertParent = `INSERT INTO zhiban_identity.memberships (${parentColumns}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1) RETURNING ${parentColumns}`;
const updateParent = `UPDATE zhiban_identity.memberships SET status = $1, authorization_version = $2, updated_at = $3, disabled_at = $4, disabled_reason = $5, repository_revision = repository_revision + 1 WHERE tenant_id = $6 AND membership_id = $7 AND repository_revision = $8::bigint RETURNING ${parentColumns}`;
const insertChild = `INSERT INTO zhiban_identity.role_grants (${childColumns}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${childColumns}`;
const revokeChild = `UPDATE zhiban_identity.role_grants SET revoked_at = $1 WHERE tenant_id = $2 AND membership_id = $3 AND grant_id = $4 AND revoked_at IS NULL RETURNING ${childColumns}`;
const childConstraints = ['role_grants_pkey', 'role_grants_ordinal_unique'];

function sameGrantImmutable(a: RoleGrant, b: RoleGrant): boolean {
  return a.id === b.id && a.roleCode === b.roleCode && a.scope.type === b.scope.type &&
    a.scope.scopeId === b.scope.scopeId && a.createdAt === b.createdAt &&
    a.validFrom === b.validFrom && a.validUntil === b.validUntil;
}
function same(a: Membership, b: Membership): boolean {
  return a.id === b.id && a.userId === b.userId && a.tenantId === b.tenantId &&
    a.status === b.status && a.authorizationVersion === b.authorizationVersion &&
    a.createdAt === b.createdAt && a.updatedAt === b.updatedAt &&
    a.disabledAt === b.disabledAt && a.disabledReason === b.disabledReason &&
    a.roleGrants.length === b.roleGrants.length && a.roleGrants.every((grant, index) =>
      sameGrantImmutable(grant, b.roleGrants[index]) && grant.revokedAt === b.roleGrants[index].revokedAt);
}
function history(before: Membership, after: Membership): void {
  integrity(after.roleGrants.length >= before.roleGrants.length);
  before.roleGrants.forEach((old, index) => {
    const grant = after.roleGrants[index];
    integrity(sameGrantImmutable(old, grant) && (old.revokedAt === null || old.revokedAt === grant.revokedAt));
  });
}
function sameChild(a: RoleGrantRow, b: RoleGrantRow): boolean {
  integrity(typeof a === 'object' && a !== null);
  return a.grant_id === b.grant_id && a.tenant_id === b.tenant_id && a.membership_id === b.membership_id &&
    a.grant_ordinal === b.grant_ordinal && a.role_code === b.role_code && a.scope_kind === b.scope_kind &&
    a.scope_id === b.scope_id && a.created_at === b.created_at && a.valid_from === b.valid_from &&
    a.valid_until === b.valid_until && a.revoked_at === b.revoked_at;
}
function candidateRows(candidate: Membership) {
  const write = membershipToRows(candidate);
  const row = write.membership;
  // Validate only after authenticating the ORIGINAL candidate; this is not its authenticity proof.
  membershipFromRows({ membership_id: row.membership_id, user_id: row.user_id, tenant_id: row.tenant_id,
    status: row.status, authorization_version: row.authorization_version, created_at: row.created_at,
    updated_at: row.updated_at, disabled_at: row.disabled_at, disabled_reason: row.disabled_reason,
    repository_revision: '1' }, write.roleGrants);
  return write;
}
async function children(client: Client, tenant: TenantId, id: MembershipId): Promise<RoleGrantRow[]> {
  const result = await client.query<RoleGrantRow>(selectChildren, [tenant, id]);
  integrity(typeof result === 'object' && result !== null && result.command === 'SELECT' &&
    Array.isArray(result.rows) && result.rowCount === result.rows.length);
  return result.rows;
}
function scopedParent(row: MembershipRow, tenant: TenantId, id?: MembershipId): void {
  integrity(typeof row === 'object' && row !== null && row.tenant_id === tenant &&
    (id === undefined || row.membership_id === id));
}
function storedRevision(value: string): RepositoryRevision {
  try { return repositoryRevision(value); } catch { throw new IdentityPortError('INTEGRITY_FAILURE'); }
}
async function append(client: Client, row: RoleGrantRow): Promise<void> {
  // Parent is locked (or newly inserted). Every formal child writer uses this parent protocol.
  const allocation = oneRow(await client.query<{ next_ordinal: string }>(allocateOrdinal,
    [row.tenant_id, row.membership_id]), 'SELECT');
  integrity(allocation !== null && typeof allocation === 'object');
  const ordinal = checkedInteger(allocation.next_ordinal, int8Maximum).toString();
  integrity(ordinal === row.grant_ordinal);
  const returned = oneRow(await client.query<RoleGrantRow>(insertChild,
    [row.grant_id, row.tenant_id, row.membership_id, ordinal, row.role_code, row.scope_kind,
      row.scope_id, row.created_at, row.valid_from, row.valid_until, row.revoked_at]), 'INSERT');
  integrity(returned !== null && sameChild(returned, row));
}
function verify(parent: MembershipRow, grants: readonly RoleGrantRow[], candidate: Membership, revision: string): Loaded<Membership> {
  const loaded = membershipFromRows(parent, grants);
  integrity(loaded.revision === revision && same(loaded.value, candidate));
  return loaded;
}

/** Isolated TENANT_RUNTIME persistence; audited use cases require later same-client composition. */
export class PostgresMembershipRepository implements MembershipRepositoryPort {
  constructor(private readonly pool: TransactionPool) {}

  findById(context: TenantContext, id: MembershipId): Promise<Loaded<Membership> | null> {
    return atPortBoundary(async () => {
      const tenant = requireTenantContext(context);
      membershipId(id);
      return tenantTransaction(this.pool, tenantScopeContext(tenant), async client => {
        const parent = oneRow(await client.query<MembershipRow>(selectId, [tenant, id]), 'SELECT', true);
        if (parent === null) return null;
        scopedParent(parent, tenant, id);
        return membershipFromRows(parent, await children(client, tenant, id));
      }, 'REPEATABLE_READ_READ_ONLY');
    });
  }
  findByUser(context: TenantContext, user: UserId): Promise<Loaded<Membership> | null> {
    return atPortBoundary(async () => {
      const tenant = requireTenantContext(context);
      userId(user);
      return tenantTransaction(this.pool, tenantScopeContext(tenant), async client => {
        const parent = oneRow(await client.query<MembershipRow>(selectUser, [tenant, user]), 'SELECT', true);
        if (parent === null) return null;
        scopedParent(parent, tenant);
        integrity(parent.user_id === user);
        const id = membershipId(parent.membership_id);
        return membershipFromRows(parent, await children(client, tenant, id));
      }, 'REPEATABLE_READ_READ_ONLY');
    });
  }
  create(context: TenantContext, candidate: Membership): Promise<Loaded<Membership>> {
    return atPortBoundary(async () => {
      assertAuthenticMembershipForPersistence(candidate);
      const tenant = requireTenantContext(context);
      if (candidate.tenantId !== tenant) throw new IdentityPortError('TENANT_SCOPE_VIOLATION');
      const write = candidateRows(candidate);
      const row = write.membership;
      return tenantTransaction(this.pool, tenantScopeContext(tenant), async client => {
        const parent = oneRow(await client.query<MembershipRow>(insertParent,
          [row.membership_id, row.user_id, row.tenant_id, row.status, row.authorization_version,
            row.created_at, row.updated_at, row.disabled_at, row.disabled_reason]), 'INSERT');
        integrity(parent !== null);
        verify(parent, write.roleGrants, candidate, '1');
        for (const grant of write.roleGrants) await append(client, grant);
        return verify(parent, await children(client, tenant, candidate.id), candidate, '1');
      });
    }, ['memberships_pkey', 'memberships_tenant_user_unique', 'memberships_tenant_id_unique', ...childConstraints]);
  }
  save(context: TenantContext, candidate: Membership, revision: RepositoryRevision): Promise<Loaded<Membership>> {
    return atPortBoundary(async () => {
      assertAuthenticMembershipForPersistence(candidate);
      const tenant = requireTenantContext(context);
      if (candidate.tenantId !== tenant) throw new IdentityPortError('TENANT_SCOPE_VIOLATION');
      validateRevision(revision);
      return tenantTransaction(this.pool, tenantScopeContext(tenant), async client => {
        const parent = oneRow(await client.query<MembershipRow>(selectId + ' FOR UPDATE', [tenant, candidate.id]), 'SELECT', true);
        if (parent === null) throw new IdentityPortError('CONFLICT');
        scopedParent(parent, tenant, candidate.id);
        expectedRevision(storedRevision(parent.repository_revision), revision);
        const storedChildren = await children(client, tenant, candidate.id);
        const current = membershipFromRows(parent, storedChildren);
        integrity(candidate.id === current.value.id && candidate.userId === current.value.userId &&
          candidate.tenantId === current.value.tenantId && candidate.createdAt === current.value.createdAt &&
          candidate.updatedAt >= current.value.updatedAt && candidate.authorizationVersion >= current.value.authorizationVersion);
        history(current.value, candidate);
        const write = candidateRows(candidate);
        if (candidate.authorizationVersion === current.value.authorizationVersion) {
          integrity(same(current.value, candidate));
          return current;
        }
        const next = nextRevision(current.revision);
        const row = write.membership;
        const returned = oneRow(await client.query<MembershipRow>(updateParent,
          [row.status, row.authorization_version, row.updated_at, row.disabled_at, row.disabled_reason,
            tenant, candidate.id, revision]), 'UPDATE');
        integrity(returned !== null);
        verify(returned, write.roleGrants, candidate, next);
        for (let index = 0; index < write.roleGrants.length; index++) {
          const grant = write.roleGrants[index];
          if (index >= current.value.roleGrants.length) await append(client, grant);
          else if (current.value.roleGrants[index].revokedAt === null && candidate.roleGrants[index].revokedAt !== null) {
            const revoked = oneRow(await client.query<RoleGrantRow>(revokeChild,
              [grant.revoked_at, tenant, candidate.id, grant.grant_id]), 'UPDATE');
            integrity(revoked !== null && sameChild(revoked, grant));
          }
        }
        return verify(returned, await children(client, tenant, candidate.id), candidate, next);
      });
    }, childConstraints);
  }
}
