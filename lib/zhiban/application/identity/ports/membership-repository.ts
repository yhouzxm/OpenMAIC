import type { Membership, MembershipId, UserId } from '@/lib/zhiban/domain/identity';
import type { Loaded, RepositoryRevision } from './repository-types';
import type { TenantContext } from './tenant-context';

/**
 * All operations are tenant-scoped. Cross-tenant reads return null; writes fail closed.
 * On save, the stored id/userId/tenantId must equal the supplied aggregate's identifiers.
 * AuthorizationVersion must never decrease; an equal version is valid only when the
 * authorization-relevant state is unchanged. The expected persistence revision is
 * checked independently and atomically, and each successful write returns a fresh revision.
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
