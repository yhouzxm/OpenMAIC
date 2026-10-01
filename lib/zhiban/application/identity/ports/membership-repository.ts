import type { Membership, MembershipId, UserId } from '@/lib/zhiban/domain/identity';
import type { Loaded, RepositoryRevision } from './repository-types';
import type { TenantContext } from './tenant-context';

/**
 * All operations are tenant-scoped. Cross-tenant reads return null; writes fail closed.
 * On save, the stored id/userId/tenantId must equal the supplied aggregate's identifiers.
 * AuthorizationVersion must never decrease; an equal version is valid only when the
 * authorization-relevant state is unchanged. The expected persistence revision is
 * checked independently and atomically before integrity checks or no-op comparison.
 * Each state-changing save returns a fresh per-row revision. A verified full-state TRUE_NO_OP
 * returns the current stored Loaded value and unchanged revision, never the candidate wrapper.
 * Higher authorizationVersion (including jumps and equivalent facts) is state-changing.
 * Full ordered grant history is append-or-first-revoke only under the parent CAS boundary.
 */
export interface MembershipRepositoryPort {
  findById(context: TenantContext, id: MembershipId): Promise<Loaded<Membership> | null>;
  findByUser(context: TenantContext, userId: UserId): Promise<Loaded<Membership> | null>;
  create(context: TenantContext, membership: Membership): Promise<Loaded<Membership>>;
  save(
    context: TenantContext,
    membership: Membership,
    expectedRevision: RepositoryRevision,
  ): Promise<Loaded<Membership>>;
}
