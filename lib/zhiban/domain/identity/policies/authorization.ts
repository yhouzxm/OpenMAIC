import {
  userId,
  tenantId,
  membershipId,
  type UserId,
  type TenantId,
  type MembershipId,
} from '../ids';
import { Membership } from '../membership';
import { Role, type RoleCode } from '../role';
import { RoleGrant } from '../role-grant';
import { parseScope, type Scope } from '../scope';
import { permission, type Permission } from '../permission';
import { instant, type Instant } from '../time';
import { SystemAdminGrant } from '../system-admin-grant';

export type DenialReason =
  | 'INVALID_FACTS'
  | 'INACTIVE_IDENTITY'
  | 'TENANT_MISMATCH'
  | 'NO_EFFECTIVE_GRANT'
  | 'UNSUPPORTED_ACTION'
  | 'CATALOG_UNAVAILABLE'
  | 'PERMISSION_SCOPE_MISMATCH'
  | 'RELATIONSHIP_DENIED'
  | 'RESOURCE_STATE_DENIED'
  | 'STALE_AUTHORIZATION'
  | 'DELEGATION_DENIED'
  | 'LAST_ADMIN_REQUIRED'
  | 'STORAGE_UNAVAILABLE';
export const deny = (reason: DenialReason) => Object.freeze({ decision: 'DENY' as const, reason });
export interface ResourceFacts {
  readonly tenantId: TenantId;
  readonly resourceId: string;
  readonly scope: Scope;
  readonly subjectUserId: UserId | null;
  readonly subjectMembershipId: MembershipId | null;
  /** Ordinary pure values: only a trusted server loader establishes these facts. */
  readonly relationshipSatisfied: boolean;
  readonly stateAllowed: boolean;
}
export interface ActionRule {
  readonly action: string;
  readonly version: string;
  readonly requiredPermissions: readonly Permission[];
  readonly targetScopes: readonly Scope['type'][];
  readonly tenantCoversTarget: boolean;
}
export interface AuthorizationInput {
  readonly actorUserId: UserId;
  readonly userStatus: 'ACTIVE' | 'DISABLED';
  readonly tenantId: TenantId;
  readonly tenantStatus: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
  readonly membership: Membership;
  readonly catalog: { readonly version: string; readonly roles: readonly Role[] };
  readonly rule: ActionRule;
  readonly resource: ResourceFacts;
  readonly now: Instant;
  readonly expectedAuthorizationVersion?: number;
}
export type AuthorizationDecision =
  | ReturnType<typeof deny>
  | Readonly<{
      decision: 'ALLOW';
      actorUserId: UserId;
      tenantId: TenantId;
      membershipId: MembershipId;
      authorizationVersion: number;
      grantId: RoleGrant['id'];
      catalogVersion: string;
      ruleVersion: string;
      action: string;
      resourceId: string;
      evaluatedAt: Instant;
      validUntil: Instant | null;
    }>;

/** Match one grant, never aggregate scopes or infer CLASS/COURSE containment. */
export function scopeMatches(
  grant: Scope,
  facts: ResourceFacts,
  actor: Membership,
  rule: ActionRule,
): boolean {
  try {
    const g = parseScope(grant.type, grant.scopeId);
    const target = parseScope(facts.scope.type, facts.scope.scopeId);
    if (facts.tenantId !== actor.tenantId || !rule.targetScopes.includes(target.type)) return false;
    if (g.type === 'TENANT') return target.type === 'TENANT' || rule.tenantCoversTarget === true;
    if (g.type !== target.type) return false;
    if (g.type === 'SELF')
      return (
        (facts.subjectUserId !== null || facts.subjectMembershipId !== null) &&
        (facts.subjectUserId === null || facts.subjectUserId === actor.userId) &&
        (facts.subjectMembershipId === null || facts.subjectMembershipId === actor.id)
      );
    return g.scopeId === target.scopeId;
  } catch {
    return false;
  }
}

/** Pure evaluation. No DB/Session/Context establishes permissions by itself. */
export function evaluateAuthorization(input: AuthorizationInput): AuthorizationDecision {
  try {
    instant(input.now);
    if (
      userId(input.actorUserId) !== input.actorUserId ||
      tenantId(input.tenantId) !== input.tenantId
    )
      return deny('INVALID_FACTS');
    const m = input.membership;
    // effectiveGrantsAt also validates Domain issuance; copied DTOs cannot become entities.
    const grants = Membership.prototype.effectiveGrantsAt.call(m, input.now);
    if (
      m.userId !== input.actorUserId ||
      m.tenantId !== input.tenantId ||
      input.resource.tenantId !== input.tenantId
    )
      return deny('TENANT_MISMATCH');
    if (input.userStatus !== 'ACTIVE' || input.tenantStatus !== 'ACTIVE' || m.status !== 'ACTIVE')
      return deny('INACTIVE_IDENTITY');
    if (
      input.expectedAuthorizationVersion !== undefined &&
      input.expectedAuthorizationVersion !== m.authorizationVersion
    )
      return deny('STALE_AUTHORIZATION');
    const { catalog, rule, resource } = input;
    const codes = ['STUDENT', 'TEACHER', 'TENANT_ADMIN'] as const;
    if (
      !catalog.version ||
      !Array.isArray(catalog.roles) ||
      catalog.roles.length !== 3 ||
      codes.some(
        (code) => catalog.roles.filter((r) => r instanceof Role && r.code === code).length !== 1,
      ) ||
      new Set(catalog.roles.map((r) => r.id)).size !== 3
    )
      return deny('CATALOG_UNAVAILABLE');
    if (
      !rule.action ||
      !rule.version ||
      !Array.isArray(rule.requiredPermissions) ||
      !rule.requiredPermissions.length ||
      rule.requiredPermissions.some((p) => permission(p) !== p) ||
      !rule.targetScopes.length ||
      rule.targetScopes.some((s) => !['SELF', 'CLASS', 'COURSE', 'TENANT'].includes(s))
    )
      return deny('UNSUPPORTED_ACTION');
    parseScope(resource.scope.type, resource.scope.scopeId);
    if (!resource.resourceId || typeof resource.resourceId !== 'string')
      return deny('INVALID_FACTS');
    if (resource.relationshipSatisfied !== true) return deny('RELATIONSHIP_DENIED');
    if (resource.stateAllowed !== true) return deny('RESOURCE_STATE_DENIED');
    if (!grants.length) return deny('NO_EFFECTIVE_GRANT');
    const matched = grants.find((g) => {
      const role = catalog.roles.find((r) => r.code === g.roleCode);
      return (
        role &&
        rule.requiredPermissions.every((p) => role.permissions.includes(p)) &&
        scopeMatches(g.scope, resource, m, rule)
      );
    });
    if (!matched) return deny('PERMISSION_SCOPE_MISMATCH');
    return Object.freeze({
      decision: 'ALLOW',
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      membershipId: membershipId(m.id),
      authorizationVersion: m.authorizationVersion,
      grantId: matched.id,
      catalogVersion: catalog.version,
      ruleVersion: rule.version,
      action: rule.action,
      resourceId: resource.resourceId,
      evaluatedAt: input.now,
      validUntil: matched.validUntil,
    });
  } catch {
    return deny('INVALID_FACTS');
  }
}

/** Explicit A7-02 table; no role ordering and no post-state self approval. */
export function mayDelegate(input: {
  actor: Membership;
  actorGrant: RoleGrant;
  target: Membership;
  targetUserStatus: 'ACTIVE' | 'DISABLED';
  proposed: RoleGrant;
  catalog: AuthorizationInput['catalog'];
  now: Instant;
  preserve: boolean;
  resourceRelationshipVerified: boolean;
}): boolean {
  try {
    const { actor, actorGrant: authority, target, proposed: grant, now } = input;
    instant(now);
    Membership.prototype.effectiveGrantsAt.call(target, now);
    const role = input.catalog.roles.find((r) => r.code === authority.roleCode);
    if (
      !Membership.prototype.effectiveGrantsAt.call(actor, now).includes(authority) ||
      authority.roleCode !== 'TENANT_ADMIN' ||
      authority.scope.type !== 'TENANT' ||
      !role?.permissions.includes(permission('role:assign')) ||
      actor.tenantId !== target.tenantId ||
      input.targetUserStatus !== 'ACTIVE' ||
      !RoleGrant.prototype.isEffectiveAt.call(grant, now) ||
      (authority.validUntil !== null &&
        (grant.validUntil === null || grant.validUntil > authority.validUntil))
    )
      return false;
    if (input.preserve) {
      if (!target.roleGrants.includes(grant)) return false;
    } else if (grant.validFrom !== now || grant.createdAt !== now) return false;
    if (grant.roleCode === 'TENANT_ADMIN')
      return grant.scope.type === 'TENANT' && actor.userId !== target.userId;
    if (grant.roleCode === 'STUDENT' && grant.scope.type === 'SELF') return true;
    // No production resource loader is installed in this phase. Pure callers need real facts.
    return (
      input.resourceRelationshipVerified === true &&
      (grant.roleCode === 'STUDENT' || grant.roleCode === 'TEACHER') &&
      (grant.scope.type === 'CLASS' || grant.scope.type === 'COURSE')
    );
  } catch {
    return false;
  }
}

/** Complete scoped post-state roster is mandatory; count people, not grant rows. */
export function lastAdminCounts(
  tenant: TenantId,
  members: readonly Membership[],
  userStates: ReadonlyMap<UserId, 'ACTIVE' | 'DISABLED'>,
  catalog: AuthorizationInput['catalog'],
  now: Instant,
): Readonly<{ governance: number; operational: number }> {
  tenantId(tenant);
  instant(now);
  if (
    new Set(members.map((m) => m.id)).size !== members.length ||
    new Set(members.map((m) => m.userId)).size !== members.length
  )
    throw new TypeError('Invalid authorization roster.');
  let governance = 0,
    operational = 0;
  for (const m of members) {
    if (m.tenantId !== tenant || !['ACTIVE', 'DISABLED'].includes(userStates.get(m.userId) ?? ''))
      throw new TypeError('Invalid authorization roster.');
    const admin = Membership.prototype.effectiveGrantsAt
      .call(m, now)
      .filter((g) => g.roleCode === 'TENANT_ADMIN');
    if (admin.length) governance++;
    if (
      userStates.get(m.userId) === 'ACTIVE' &&
      admin.some((g) => g.scope.type === 'TENANT') &&
      identityPermissions.TENANT_ADMIN.every((p) =>
        catalog.roles.find((r) => r.code === 'TENANT_ADMIN')?.permissions.includes(permission(p)),
      )
    )
      operational++;
  }
  return Object.freeze({ governance, operational });
}

/** Eligibility only; a separate control-plane action approval remains required. */
export function systemAdminEligible(
  user: UserId,
  status: 'ACTIVE' | 'DISABLED',
  grant: SystemAdminGrant,
  now: Instant,
): boolean {
  try {
    return (
      status === 'ACTIVE' &&
      grant.userId === userId(user) &&
      SystemAdminGrant.prototype.isEffectiveAt.call(grant, instant(now))
    );
  } catch {
    return false;
  }
}

export const identityPermissions: Readonly<Record<RoleCode, readonly string[]>> = Object.freeze({
  STUDENT: Object.freeze([]),
  TEACHER: Object.freeze([]),
  TENANT_ADMIN: Object.freeze(['membership:read', 'membership:manage', 'role:assign']),
});
