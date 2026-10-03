import type {
  MembershipId,
  TenantId,
  UserId,
  RoleGrantId,
  RoleCode,
  Scope,
} from '@/lib/zhiban/domain/identity';
import type { RepositoryRevision } from './repository-types';
import type { IdentityAuditReason } from './audit';
import type { AuthenticatedRequestHandle, AuthenticationTransport } from './authenticated-request';

/** Closed composition vocabulary; does not extend the frozen authorization actions. */
export const membershipCommandActions = [
  'MEMBERSHIP_PENDING_CREATE',
  'MEMBERSHIP_CONSENT_RECORD',
  'MEMBERSHIP_ACTIVATE',
  'MEMBERSHIP_DISABLE',
  'MEMBERSHIP_LEAVE_ADMIN',
  'MEMBERSHIP_REACTIVATE',
  'MEMBERSHIP_REJOIN',
  'ROLE_GRANT',
  'ROLE_REVOKE',
  'ROLE_REPLACE',
  'MEMBERSHIP_ATOMIC_TRANSFER',
] as const;
export type MembershipCommandAction = (typeof membershipCommandActions)[number];
export const controlCommandActions = [
  'USER_CREATE',
  'USER_DISABLE',
  'USER_RESTORE',
  'TENANT_CREATE',
  'TENANT_DISABLE',
  'TENANT_RESTORE',
  'MEMBER_ADMISSION',
  'FIRST_TENANT_ADMIN',
] as const;
export type ControlCommandAction = (typeof controlCommandActions)[number];
export type CompositionAction = MembershipCommandAction | ControlCommandAction;
export type ConsentPurpose = 'ACTIVATE' | 'REACTIVATE' | 'REJOIN' | 'FIRST_TENANT_ADMIN';
export type MemberAdmissionPurpose = 'INVITE' | 'REACTIVATE' | 'REJOIN';

/** Proposals are locators, never evidence of permission, relationship or approval. */
export interface MembershipGrantProposal {
  readonly roleCode: RoleCode;
  readonly scope: Scope;
  readonly validUntil: number | null;
}
export interface MembershipCommandTarget {
  readonly userId: UserId;
  readonly membershipId: MembershipId;
  readonly expectedRevision: RepositoryRevision;
  readonly expectedAuthorizationVersion: number;
  readonly action: Exclude<
    MembershipCommandAction,
    'MEMBERSHIP_PENDING_CREATE' | 'MEMBERSHIP_CONSENT_RECORD' | 'MEMBERSHIP_ATOMIC_TRANSFER'
  >;
  readonly admissionId: string | null;
  readonly consentId: string | null;
  readonly grants: readonly MembershipGrantProposal[];
  readonly preserveGrantIds: readonly RoleGrantId[];
  readonly revokeGrantId: RoleGrantId | null;
  readonly mode: 'PRESERVE_EXISTING_VALID_GRANTS' | 'REPLACE_GRANTS' | null;
  readonly reason: IdentityAuditReason;
}
/** Password is a separate ephemeral call input, never part of the durable intent. */
export interface MembershipCommandRequest {
  readonly tenantId: TenantId;
  readonly actorMembershipId: MembershipId;
  readonly expectedActorRevision: RepositoryRevision;
  readonly expectedActorAuthorizationVersion: number;
  readonly expectedTenantRevision: RepositoryRevision;
  readonly action: Exclude<
    MembershipCommandAction,
    'MEMBERSHIP_PENDING_CREATE' | 'MEMBERSHIP_CONSENT_RECORD'
  >;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly targets: readonly MembershipCommandTarget[];
}
export interface MembershipCommandEffect {
  readonly userId: UserId;
  readonly membershipId: MembershipId | null;
  readonly revision: RepositoryRevision | null;
  readonly authorizationVersion: number | null;
  readonly status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'LEFT' | null;
}
export interface MembershipCommandOutcome {
  readonly commandId: string;
  readonly status: 'APPLIED' | 'TRUE_NO_OP';
  readonly effects: readonly MembershipCommandEffect[];
}
/** Request-local capability. A structural copy is not an issued proof. */
export interface RecentMembershipReauthentication {
  readonly kind: 'RECENT_MEMBERSHIP_REAUTHENTICATION';
}
export interface MembershipCompositionPort {
  execute(
    handle: AuthenticatedRequestHandle,
    request: MembershipCommandRequest,
    password: string,
    transport: AuthenticationTransport,
  ): Promise<MembershipCommandOutcome>;
}

export interface PendingMembershipRequest {
  readonly tenantId: TenantId;
  readonly actorMembershipId: MembershipId;
  readonly expectedActorRevision: RepositoryRevision;
  readonly expectedActorAuthorizationVersion: number;
  readonly expectedTenantRevision: RepositoryRevision;
  readonly admissionId: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
}
export interface MembershipConsentRequest {
  readonly tenantId: TenantId;
  readonly admissionId: string | null;
  readonly controlApprovalRef: string | null;
  readonly expectedMemberRevision: RepositoryRevision | null;
  readonly expectedAuthorizationVersion: number | null;
  readonly idempotencyKey: string;
  readonly requestId: string;
}
export interface MembershipAdmissionPort {
  invite(
    handle: AuthenticatedRequestHandle,
    request: PendingMembershipRequest,
    password: string,
    transport: AuthenticationTransport,
  ): Promise<MembershipCommandOutcome>;
  consent(
    handle: AuthenticatedRequestHandle,
    request: MembershipConsentRequest,
  ): Promise<MembershipCommandOutcome>;
}

/** No deployment defaults. Capacity/TTL must be independently approved configuration. */
export interface MembershipCompositionPolicy {
  readonly environmentRef: string;
  readonly approvalRef: string;
  readonly tenantRecordCapacity: number;
  readonly controlRecordCapacity: number;
  readonly sourceTtlMs: number;
}

/** Locators and independent CAS conditions; no claimed operator/approval material. */
export interface ControlCompositionRequest {
  readonly approvalRef: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly expectedUserRevision: RepositoryRevision | null;
  readonly expectedTenantRevision: RepositoryRevision | null;
}
export interface ControlCompositionOutcome {
  readonly commandId: string;
  readonly status: 'APPLIED' | 'TRUE_NO_OP';
  readonly userId: UserId | null;
  readonly tenantId: TenantId | null;
  readonly membershipId: MembershipId | null;
  readonly grantId: RoleGrantId | null;
  readonly admissionId: string | null;
  readonly revision: RepositoryRevision | null;
}
