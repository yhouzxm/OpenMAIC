import { membershipId, userId } from '@/lib/zhiban/domain/identity/ids';
import { permission } from '@/lib/zhiban/domain/identity/permission';
import { tenantScope } from '@/lib/zhiban/domain/identity/scope';
import {
  deny,
  evaluateAuthorization,
  identityPermissions,
  type ActionRule,
  type AuthorizationDecision,
} from '@/lib/zhiban/domain/identity/policies/authorization';
import { requireTenantContext, tenantScopeContext } from './ports/tenant-context';
import { repositoryRevision } from './ports/repository-types';
import type {
  AuthorizationCatalog,
  AuthorizationCatalogPort,
  AuthorizationClock,
  AuthorizationRead,
  AuthorizationRequest,
  AuthorizationReceipt,
  AuthorizationStatePort,
  IdentityAction,
} from './ports/authorization';

export function identityActionRule(action: IdentityAction): ActionRule | null {
  const permissions: Partial<Record<IdentityAction, readonly string[]>> = {
    MEMBERSHIP_READ: ['membership:read'],
    MEMBERSHIP_DISABLE: ['membership:manage'],
    MEMBERSHIP_LEAVE_ADMIN: ['membership:manage'],
    MEMBERSHIP_ACTIVATE: ['membership:manage', 'role:assign'],
    MEMBERSHIP_REACTIVATE: ['membership:manage', 'role:assign'],
    MEMBERSHIP_REJOIN: ['membership:manage', 'role:assign'],
    ROLE_GRANT: ['role:assign'],
    ROLE_REPLACE: ['role:assign'],
    ROLE_REVOKE: ['role:assign'],
  };
  if (!Object.hasOwn(permissions, action)) return null;
  return Object.freeze({
    action,
    version: 'identity-v1',
    requiredPermissions: Object.freeze(permissions[action]!.map(permission)),
    targetScopes: Object.freeze(['TENANT'] as const),
    tenantCoversTarget: false,
  });
}

export function validateAuthorizationCatalog(catalog: AuthorizationCatalog): void {
  if (
    catalog.snapshot.version !== 'identity-v1' ||
    catalog.actionVersion !== 'identity-v1' ||
    catalog.delegationVersion !== 'identity-v1' ||
    !/^[a-f0-9]{64}$/.test(catalog.contentDigest) ||
    catalog.snapshot.roles.length !== 3 ||
    new Set(catalog.snapshot.roles.map((r) => r.id)).size !== 3
  )
    throw new TypeError('Invalid authorization catalog.');
  for (const code of ['STUDENT', 'TEACHER', 'TENANT_ADMIN'] as const) {
    const roles = catalog.snapshot.roles.filter((r) => r.code === code);
    if (
      roles.length !== 1 ||
      [...roles[0].permissions].sort().join(',') !== [...identityPermissions[code]].sort().join(',')
    )
      throw new TypeError('Invalid authorization catalog.');
  }
}

/** Server-side composition: no relationship/status DTO accepted from the caller. */
export function authorizeRead(
  request: AuthorizationRequest,
  read: AuthorizationRead,
  catalog: AuthorizationCatalog,
  now: ReturnType<AuthorizationClock['now']>,
): AuthorizationDecision {
  try {
    validateAuthorizationCatalog(catalog);
    const tenant = requireTenantContext(request.context);
    const actor = read.actor.value,
      target = read.target.value;
    const actorFact = read.globals.users.get(actor.id),
      targetFact = read.globals.users.get(target.id);
    if (
      !actorFact ||
      !targetFact ||
      read.globals.tenantId !== tenant ||
      actor.id !== request.actorMembershipId ||
      target.id !== request.targetMembershipId ||
      actor.tenantId !== tenant ||
      target.tenantId !== tenant ||
      actor.userId !== request.actorUserId ||
      actorFact.userId !== actor.userId ||
      targetFact.userId !== target.userId
    )
      return deny('TENANT_MISMATCH');
    const rule = identityActionRule(request.action);
    if (!rule) return deny('UNSUPPORTED_ACTION');
    const stateAllowed =
      request.action === 'MEMBERSHIP_READ' ||
      request.action === 'ROLE_REVOKE' ||
      (request.action === 'MEMBERSHIP_DISABLE' && ['ACTIVE', 'PENDING'].includes(target.status)) ||
      (request.action === 'MEMBERSHIP_ACTIVATE' && target.status === 'PENDING') ||
      (request.action === 'MEMBERSHIP_REACTIVATE' && target.status === 'DISABLED') ||
      (request.action === 'MEMBERSHIP_REJOIN' && target.status === 'LEFT') ||
      (['ROLE_GRANT', 'ROLE_REPLACE', 'MEMBERSHIP_LEAVE_ADMIN'].includes(request.action) &&
        target.status === 'ACTIVE');
    if (
      targetFact.status !== 'ACTIVE' &&
      request.action !== 'MEMBERSHIP_READ' &&
      request.action !== 'ROLE_REVOKE' &&
      request.action !== 'MEMBERSHIP_DISABLE' &&
      request.action !== 'MEMBERSHIP_LEAVE_ADMIN'
    )
      return deny('INACTIVE_IDENTITY');
    return evaluateAuthorization({
      actorUserId: request.actorUserId,
      userStatus: actorFact.status,
      tenantId: tenant,
      tenantStatus: read.globals.tenantStatus,
      membership: actor,
      catalog: catalog.snapshot,
      rule,
      resource: {
        tenantId: target.tenantId,
        resourceId: target.id,
        scope: tenantScope(),
        subjectUserId: target.userId,
        subjectMembershipId: target.id,
        relationshipSatisfied: true,
        stateAllowed,
      },
      now,
    });
  } catch {
    return deny('INVALID_FACTS');
  }
}

export class IdentityAuthorizer {
  constructor(
    private readonly state: AuthorizationStatePort,
    private readonly catalog: AuthorizationCatalogPort,
    private readonly clock: AuthorizationClock,
  ) {}
  async authorize(
    input: AuthorizationRequest,
  ): Promise<
    ReturnType<typeof deny> | { readonly decision: 'ALLOW'; readonly receipt: AuthorizationReceipt }
  > {
    try {
      // Project/copy before awaiting: caller-owned mutable request is never retained in a receipt.
      const request = Object.freeze({
        actorUserId: userId(input.actorUserId),
        actorMembershipId: membershipId(input.actorMembershipId),
        context: tenantScopeContext(requireTenantContext(input.context)),
        targetMembershipId: membershipId(input.targetMembershipId),
        action: input.action,
        requestId: input.requestId,
      });
      if (
        request.requestId !== null &&
        (typeof request.requestId !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.requestId))
      )
        return deny('INVALID_FACTS');
      if (!identityActionRule(request.action)) return deny('UNSUPPORTED_ACTION');
      const catalog = await this.catalog.load();
      validateAuthorizationCatalog(catalog);
      const read = await this.state.read(
        request.context,
        request.actorMembershipId,
        request.targetMembershipId,
      );
      const result = authorizeRead(request, read, catalog, this.clock.now());
      if (result.decision === 'DENY') return result;
      return Object.freeze({
        decision: 'ALLOW' as const,
        receipt: Object.freeze({
          request,
          decision: result,
          actorRevision: repositoryRevision(read.actor.revision),
          targetRevision: repositoryRevision(read.target.revision),
          tenantRevision: repositoryRevision(read.globals.tenantRevision),
          catalogDigest: catalog.contentDigest,
          delegationVersion: catalog.delegationVersion,
          actorUserRevision: repositoryRevision(
            read.globals.users.get(request.actorMembershipId)!.revision,
          ),
          targetUserRevision: repositoryRevision(
            read.globals.users.get(request.targetMembershipId)!.revision,
          ),
        }),
      });
    } catch {
      return deny('STORAGE_UNAVAILABLE');
    }
  }
}
