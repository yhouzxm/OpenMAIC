import type {
  MembershipId,
  RoleGrantId,
  RoleId,
  SystemAdminGrantId,
  TenantId,
  UserId,
} from '@/lib/zhiban/domain/identity';

/** UUIDv7 generation implementation and clock-backward behavior belong to Infrastructure. */
export interface IdGeneratorPort {
  nextUserId(): UserId;
  nextTenantId(): TenantId;
  nextMembershipId(): MembershipId;
  nextRoleId(): RoleId;
  nextRoleGrantId(): RoleGrantId;
  nextSystemAdminGrantId(): SystemAdminGrantId;
}
