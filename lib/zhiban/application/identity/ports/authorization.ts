import type {
  Membership,
  MembershipReactivationMode,
  MembershipId,
  UserId,
  TenantId,
  RoleGrantId,
  RoleCode,
  Scope,
  Instant,
  AuthorizationDecision,
} from '@/lib/zhiban/domain/identity';
import type { RoleCatalogSnapshot } from './role-catalog';
import type { Loaded, RepositoryRevision } from './repository-types';
import type { TenantContext } from './tenant-context';
import type { IdentityAuditReason } from './audit';
import type { ClockPort } from './clock';

export type IdentityAction =
  | 'MEMBERSHIP_READ'
  | 'MEMBERSHIP_DISABLE'
  | 'MEMBERSHIP_LEAVE_ADMIN'
  | 'MEMBERSHIP_ACTIVATE'
  | 'MEMBERSHIP_REACTIVATE'
  | 'MEMBERSHIP_REJOIN'
  | 'ROLE_GRANT'
  | 'ROLE_REPLACE'
  | 'ROLE_REVOKE';
export interface AuthorizationCatalog {
  readonly snapshot: RoleCatalogSnapshot;
  readonly contentDigest: string;
  readonly actionVersion: 'identity-v1';
  readonly delegationVersion: 'identity-v1';
}
export interface AuthorizationCatalogPort {
  load(): Promise<AuthorizationCatalog>;
}
export interface GlobalAuthorizationFacts {
  readonly tenantId: TenantId;
  readonly tenantStatus: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
  readonly tenantRevision: RepositoryRevision;
  readonly users: ReadonlyMap<
    MembershipId,
    Readonly<{
      userId: UserId;
      status: 'ACTIVE' | 'DISABLED';
      revision: RepositoryRevision;
    }>
  >;
}
export interface AuthorizationRead {
  readonly globals: GlobalAuthorizationFacts;
  readonly actor: Loaded<Membership>;
  readonly target: Loaded<Membership>;
}
export interface AuthorizationStatePort {
  read(
    context: TenantContext,
    actor: MembershipId,
    target: MembershipId,
  ): Promise<AuthorizationRead>;
}
export interface AuthorizationRequest {
  /** Trusted server request correlation; receipts cannot be replayed into another request. */
  readonly requestId: string | null;
  /** From server authentication, never a client-supplied identity. */
  readonly actorUserId: UserId;
  readonly actorMembershipId: MembershipId;
  readonly context: TenantContext;
  readonly targetMembershipId: MembershipId;
  readonly action: IdentityAction;
}
export interface AuthorizationReceipt {
  readonly request: AuthorizationRequest;
  readonly decision: Extract<AuthorizationDecision, { decision: 'ALLOW' }>;
  readonly actorRevision: RepositoryRevision;
  readonly targetRevision: RepositoryRevision;
  readonly actorUserRevision: RepositoryRevision;
  readonly targetUserRevision: RepositoryRevision;
  readonly tenantRevision: RepositoryRevision;
  readonly catalogDigest: string;
  readonly delegationVersion: 'identity-v1';
}
/** Closed intent only. Approval provenance/HTTP use cases are owned by 1B-8. */
export interface NewAuthorizationGrant {
  readonly id: RoleGrantId;
  readonly roleCode: RoleCode;
  readonly scope: Scope;
  readonly validUntil: Instant | null;
  // createdAt/validFrom are assigned at fresh in-transaction approval, not supplied by a client.
}
export type MembershipMutationIntent =
  | { readonly action: 'MEMBERSHIP_DISABLE'; readonly reason: string }
  | { readonly action: 'MEMBERSHIP_LEAVE_ADMIN' }
  | { readonly action: 'ROLE_REVOKE'; readonly grantId: RoleGrantId }
  | { readonly action: 'ROLE_GRANT'; readonly approvedGrant: NewAuthorizationGrant }
  | {
      readonly action: 'MEMBERSHIP_ACTIVATE' | 'MEMBERSHIP_REJOIN' | 'ROLE_REPLACE';
      readonly approvedGrants: readonly NewAuthorizationGrant[];
    }
  | {
      readonly action: 'MEMBERSHIP_REACTIVATE';
      readonly mode: MembershipReactivationMode;
      readonly approvedGrants: readonly NewAuthorizationGrant[];
      readonly approvedGrantIds: readonly RoleGrantId[];
    };
export interface AuthorizationMutation {
  readonly receipt: AuthorizationReceipt;
  readonly intent: MembershipMutationIntent;
}
export interface AuthorizationMutationRequest {
  readonly operations: readonly AuthorizationMutation[];
  readonly requestId: string | null;
  readonly auditReason: IdentityAuditReason;
}
export interface AuthorizationMutationPort {
  execute(request: AuthorizationMutationRequest): Promise<readonly Loaded<Membership>[]>;
}
export type AuthorizationClock = ClockPort;
