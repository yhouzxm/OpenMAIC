import type { RoleGrant, TenantId, MembershipId } from '@/lib/zhiban/domain/identity';
import type { Client } from './support';
/** Server-only resource extension on the existing locked Identity client; never an HTTP fact. */
export interface TeacherRelationships {
  verify(
    client: Client,
    tenant: TenantId,
    member: MembershipId,
    grant: RoleGrant,
  ): Promise<boolean>;
}
