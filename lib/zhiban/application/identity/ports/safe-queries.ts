import type { AuthenticatedRequestHandle } from './authenticated-request';
import type {
  MembershipId,
  TenantId,
  RoleGrantId,
  Scope,
  UserId,
  RoleCode,
} from '@/lib/zhiban/domain/identity';
import type { RepositoryRevision } from './repository-types';
import type { ConsentPurpose } from './membership-composition';

export interface MemberPointQuery {
  readonly tenantId: TenantId;
  readonly actorMembershipId: MembershipId;
  readonly membershipId: MembershipId;
  readonly afterGrantId: RoleGrantId | null;
  readonly consentPurpose: Exclude<ConsentPurpose, 'FIRST_TENANT_ADMIN'> | null;
}
export interface MemberPoint {
  readonly tenantId: TenantId;
  readonly membershipId: MembershipId;
  readonly userId: UserId;
  readonly status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'LEFT';
  readonly revision: RepositoryRevision;
  readonly authorizationVersion: number;
  readonly actorRevision: RepositoryRevision;
  readonly actorAuthorizationVersion: number;
  readonly tenantRevision: RepositoryRevision;
  readonly grants: readonly {
    readonly grantId: RoleGrantId;
    readonly roleCode: RoleCode;
    readonly scope: Scope;
    readonly validUntil: number | null;
  }[];
  readonly nextGrantCursor: RoleGrantId | null;
  readonly consent: null | {
    readonly consentId: string;
    readonly admissionId: string;
    readonly purpose: Exclude<ConsentPurpose, 'FIRST_TENANT_ADMIN'>;
    readonly expectedMemberRevision: RepositoryRevision;
    readonly expectedAuthorizationVersion: number;
    readonly expiresAt: number;
  };
}
export interface ConsentContextQuery {
  readonly tenantId: TenantId;
  readonly admissionId: string | null;
  readonly onboardingRef: string | null;
}
export interface ConsentContext {
  readonly membershipId: MembershipId | null;
  readonly expectedMemberRevision: RepositoryRevision | null;
  readonly expectedAuthorizationVersion: number | null;
  readonly purpose: ConsentPurpose;
  readonly expiresAt: number;
}
export interface IdentitySafeQueriesPort {
  passwordState(
    handle: AuthenticatedRequestHandle,
  ): Promise<{ readonly credentialRevision: RepositoryRevision }>;
  member(handle: AuthenticatedRequestHandle, query: MemberPointQuery): Promise<MemberPoint>;
  consentContext(
    handle: AuthenticatedRequestHandle,
    query: ConsentContextQuery,
  ): Promise<ConsentContext>;
}
