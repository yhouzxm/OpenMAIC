import {
  instant,
  membershipId,
  parseScope,
  roleCode,
  roleGrantId,
  systemAdminGrantId,
  tenantId,
  userId,
  type Instant,
  type MembershipId,
  type MembershipReactivationMode,
  type RoleCode,
  type RoleGrantId,
  type Scope,
  type SystemAdminGrantId,
  type TenantId,
  type UserId,
} from '@/lib/zhiban/domain/identity';
import { sessionId, type SessionId } from './session-repository';

declare const auditEventBrand: unique symbol;
const issuedEvents = new WeakSet<object>();

export type IdentityAuditReason =
  | 'ADMIN_REQUEST'
  | 'USER_REQUEST'
  | 'ACCESS_REVIEW'
  | 'SECURITY_POLICY'
  | 'INVITATION_EXPIRED'
  | 'ACCOUNT_RECOVERY'
  | 'CREDENTIAL_REJECTED'
  | 'SYSTEM_MAINTENANCE';

export type IdentityAuditActor =
  | { readonly kind: 'USER'; readonly userId: UserId }
  | { readonly kind: 'SERVICE'; readonly serviceCode: string }
  | { readonly kind: 'SYSTEM' };

/** A fixed, minimal grant fact; never serialize a Domain RoleGrant object into audit. */
export interface IdentityAuditGrantFact {
  readonly id: RoleGrantId;
  readonly roleCode: RoleCode;
  readonly scope: Scope;
  readonly validFrom: Instant;
  readonly validUntil: Instant | null;
}

interface CommonFacts {
  readonly occurredAt: Instant;
  readonly actor: IdentityAuditActor;
  readonly requestId: string | null;
  readonly reason: IdentityAuditReason;
}

interface MembershipFacts {
  readonly membershipId: MembershipId;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly authorizationVersionBefore: number;
  readonly authorizationVersionAfter: number;
}

export type IdentityAuditEventInput = CommonFacts &
  (
    | { readonly type: 'USER_CREATED' | 'USER_DISABLED' | 'USER_RESTORED'; readonly userId: UserId }
    | {
        readonly type: 'TENANT_CREATED' | 'TENANT_DISABLED' | 'TENANT_RESTORED';
        readonly tenantId: TenantId;
      }
    | (MembershipFacts & { readonly type: 'MEMBERSHIP_DISABLED' | 'MEMBERSHIP_LEFT' })
    | (MembershipFacts & {
        readonly type: 'MEMBERSHIP_REACTIVATED';
        readonly mode: MembershipReactivationMode;
        readonly priorGrantIds: readonly RoleGrantId[];
        readonly approvedGrants: readonly IdentityAuditGrantFact[];
      })
    | (MembershipFacts & {
        readonly type: 'MEMBERSHIP_ACTIVATED' | 'MEMBERSHIP_REJOINED' | 'ROLE_GRANTS_REPLACED';
        readonly priorGrantIds: readonly RoleGrantId[];
        readonly approvedGrants: readonly IdentityAuditGrantFact[];
      })
    | (MembershipFacts & {
        readonly type: 'ROLE_GRANT_GRANTED' | 'ROLE_GRANT_REVOKED';
        readonly grant: IdentityAuditGrantFact;
      })
    | {
        readonly type: 'SYSTEM_ADMIN_GRANT_GRANTED' | 'SYSTEM_ADMIN_GRANT_REVOKED';
        readonly grantId: SystemAdminGrantId;
        readonly userId: UserId;
      }
    | { readonly type: 'SESSION_REVOKED'; readonly sessionId: SessionId; readonly userId: UserId }
    | { readonly type: 'AUTHENTICATION_REJECTED' }
  );

export type IdentityAuditType = IdentityAuditEventInput['type'];
/** Only the factory can issue this compile-time contract; runtime rejects forged values. */
export type IdentityAuditEvent = Readonly<IdentityAuditEventInput> & {
  readonly [auditEventBrand]: true;
};

function checkedReason(reason: IdentityAuditReason): IdentityAuditReason {
  if (
    reason !== 'ADMIN_REQUEST' &&
    reason !== 'USER_REQUEST' &&
    reason !== 'ACCESS_REVIEW' &&
    reason !== 'SECURITY_POLICY' &&
    reason !== 'INVITATION_EXPIRED' &&
    reason !== 'ACCOUNT_RECOVERY' &&
    reason !== 'CREDENTIAL_REJECTED' &&
    reason !== 'SYSTEM_MAINTENANCE'
  )
    throw new TypeError('Unknown audit reason.');
  return reason;
}

function checkedActor(actor: IdentityAuditActor): IdentityAuditActor {
  if (actor?.kind === 'USER') return Object.freeze({ kind: 'USER', userId: userId(actor.userId) });
  if (actor?.kind === 'SYSTEM') return Object.freeze({ kind: 'SYSTEM' });
  if (actor?.kind === 'SERVICE') {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(actor.serviceCode))
      throw new TypeError('Invalid service actor.');
    return Object.freeze({ kind: 'SERVICE', serviceCode: actor.serviceCode });
  }
  throw new TypeError('Unknown audit actor.');
}

function common(input: CommonFacts): CommonFacts {
  if (
    input.requestId !== null &&
    (typeof input.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId))
  )
    throw new TypeError('Invalid audit request identifier.');
  return {
    occurredAt: instant(input.occurredAt),
    actor: checkedActor(input.actor),
    requestId: input.requestId,
    reason: checkedReason(input.reason),
  };
}

function membershipFacts(input: MembershipFacts): MembershipFacts {
  if (
    !Number.isSafeInteger(input.authorizationVersionBefore) ||
    input.authorizationVersionBefore < 0 ||
    !Number.isSafeInteger(input.authorizationVersionAfter) ||
    input.authorizationVersionAfter <= input.authorizationVersionBefore
  )
    throw new TypeError('Audit authorization versions must increase.');
  return {
    membershipId: membershipId(input.membershipId),
    tenantId: tenantId(input.tenantId),
    userId: userId(input.userId),
    authorizationVersionBefore: input.authorizationVersionBefore,
    authorizationVersionAfter: input.authorizationVersionAfter,
  };
}

function grantFact(input: IdentityAuditGrantFact): IdentityAuditGrantFact {
  const validFrom = instant(input.validFrom);
  const validUntil = input.validUntil === null ? null : instant(input.validUntil);
  if (validUntil !== null && validUntil <= validFrom)
    throw new TypeError('Invalid audit grant validity window.');
  return Object.freeze({
    id: roleGrantId(input.id),
    roleCode: roleCode(input.roleCode),
    scope: parseScope(input.scope?.type, input.scope?.scopeId),
    validFrom,
    validUntil,
  });
}

function approvedFacts(
  inputs: readonly IdentityAuditGrantFact[],
): readonly IdentityAuditGrantFact[] {
  if (!Array.isArray(inputs)) throw new TypeError('An explicit approved grant list is required.');
  const grants = inputs.map(grantFact);
  if (new Set(grants.map((grant) => grant.id)).size !== grants.length)
    throw new TypeError('Duplicate approved grant fact.');
  return Object.freeze(grants);
}

function priorGrantIds(inputs: readonly RoleGrantId[]): readonly RoleGrantId[] {
  if (!Array.isArray(inputs)) throw new TypeError('An explicit prior grant list is required.');
  const ids = inputs.map(roleGrantId);
  if (new Set(ids).size !== ids.length) throw new TypeError('Duplicate prior grant identifier.');
  return Object.freeze(ids);
}

function seal(input: IdentityAuditEventInput): IdentityAuditEvent {
  const event = Object.freeze(input) as IdentityAuditEvent;
  issuedEvents.add(event);
  return event;
}

/** Whitelist projection: input may carry extra runtime fields; none are copied. */
export function createIdentityAuditEvent(input: IdentityAuditEventInput): IdentityAuditEvent {
  const base = common(input);
  switch (input.type) {
    case 'USER_CREATED':
    case 'USER_DISABLED':
    case 'USER_RESTORED':
      return seal({ ...base, type: input.type, userId: userId(input.userId) });
    case 'TENANT_CREATED':
    case 'TENANT_DISABLED':
    case 'TENANT_RESTORED':
      return seal({ ...base, type: input.type, tenantId: tenantId(input.tenantId) });
    case 'MEMBERSHIP_DISABLED':
    case 'MEMBERSHIP_LEFT':
      return seal({ ...base, type: input.type, ...membershipFacts(input) });
    case 'MEMBERSHIP_REACTIVATED':
      if (input.mode !== 'PRESERVE_EXISTING_VALID_GRANTS' && input.mode !== 'REPLACE_GRANTS')
        throw new TypeError('Unknown membership reactivation mode.');
      return seal({
        ...base,
        type: input.type,
        ...membershipFacts(input),
        mode: input.mode,
        priorGrantIds: priorGrantIds(input.priorGrantIds),
        approvedGrants: approvedFacts(input.approvedGrants),
      });
    case 'MEMBERSHIP_ACTIVATED':
    case 'MEMBERSHIP_REJOINED':
    case 'ROLE_GRANTS_REPLACED': {
      const prior = priorGrantIds(input.priorGrantIds);
      const approved = approvedFacts(input.approvedGrants);
      if (approved.some((grant) => prior.includes(grant.id)))
        throw new TypeError('New approved grants cannot reuse prior grant identifiers.');
      return seal({
        ...base,
        type: input.type,
        ...membershipFacts(input),
        priorGrantIds: prior,
        approvedGrants: approved,
      });
    }
    case 'ROLE_GRANT_GRANTED':
    case 'ROLE_GRANT_REVOKED':
      return seal({
        ...base,
        type: input.type,
        ...membershipFacts(input),
        grant: grantFact(input.grant),
      });
    case 'SYSTEM_ADMIN_GRANT_GRANTED':
    case 'SYSTEM_ADMIN_GRANT_REVOKED':
      return seal({
        ...base,
        type: input.type,
        grantId: systemAdminGrantId(input.grantId),
        userId: userId(input.userId),
      });
    case 'SESSION_REVOKED':
      return seal({
        ...base,
        type: input.type,
        sessionId: sessionId(input.sessionId),
        userId: userId(input.userId),
      });
    case 'AUTHENTICATION_REJECTED':
      return seal({ ...base, type: input.type });
    default:
      throw new TypeError('Unknown identity audit event.');
  }
}

/** Factory projection proof, not actor authorization or transaction atomicity. */
export function requireIdentityAuditEvent(event: IdentityAuditEvent): IdentityAuditEvent {
  if (typeof event !== 'object' || event === null || !issuedEvents.has(event))
    throw new TypeError('A controlled identity audit event is required.');
  return event;
}

export interface AuditPort {
  /** Sensitive state changes and append must later be committed atomically. */
  append(event: IdentityAuditEvent): Promise<void>;
}
