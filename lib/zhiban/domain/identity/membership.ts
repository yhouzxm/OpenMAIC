import { invariant, nonBlank } from './errors';
import {
  membershipId,
  tenantId,
  userId,
  roleGrantId,
  type MembershipId,
  type TenantId,
  type UserId,
  type RoleGrantId,
} from './ids';
import { RoleGrant, isIssuedRoleGrantForDomain } from './role-grant';
import { atOrAfter, instant, type Instant } from './time';
import {
  nullablePersistenceInstant,
  persistenceInstant,
  persistenceRecord,
  persistenceText,
} from './persistence-validation';

const constructionToken = Symbol('Membership construction');
const issuedMemberships = new WeakSet<Membership>();

function assertIssued(membership: Membership): void {
  invariant(
    issuedMemberships.has(membership),
    'INVALID_ENTITY',
    'An authentic membership is required.',
  );
}

export type MembershipStatus = 'PENDING' | 'ACTIVE' | 'DISABLED' | 'LEFT';
export type MembershipReactivationMode = 'PRESERVE_EXISTING_VALID_GRANTS' | 'REPLACE_GRANTS';

export interface MembershipCommand {
  readonly now: Instant;
  readonly expectedAuthorizationVersion: number;
}
export type MembershipReactivation = MembershipCommand &
  (
    | {
        readonly mode: 'PRESERVE_EXISTING_VALID_GRANTS';
        readonly approvedGrantIds: readonly RoleGrantId[];
      }
    | { readonly mode: 'REPLACE_GRANTS'; readonly approvedGrants: readonly RoleGrant[] }
  );
export type ApprovedMembershipCommand = MembershipCommand & {
  readonly approvedGrants: readonly RoleGrant[];
};

function validatedGrants(grants: unknown, now: Instant): readonly RoleGrant[] {
  invariant(
    Array.isArray(grants),
    'INVALID_ROLE_GRANT',
    'An explicit grant collection is required.',
  );
  const ids = new Set<RoleGrantId>();
  const validated: RoleGrant[] = [];
  const candidates: readonly unknown[] = grants;
  for (const grant of candidates) {
    invariant(
      isIssuedRoleGrantForDomain(grant),
      'INVALID_ROLE_GRANT',
      'A validated grant is required.',
    );
    invariant(!ids.has(grant.id), 'INVALID_ROLE_GRANT', 'Duplicate grant identifier.');
    ids.add(grant.id);
    atOrAfter(now, grant.revokedAt ?? grant.createdAt);
    validated.push(grant);
  }
  return Object.freeze(validated);
}

export class Membership {
  constructor(
    token: typeof constructionToken,
    public readonly id: MembershipId,
    public readonly userId: UserId,
    public readonly tenantId: TenantId,
    public readonly status: MembershipStatus,
    public readonly roleGrants: readonly RoleGrant[],
    public readonly authorizationVersion: number,
    public readonly createdAt: Instant,
    public readonly updatedAt: Instant,
    public readonly disabledAt: Instant | null,
    public readonly disabledReason: string | null,
  ) {
    invariant(
      token === constructionToken,
      'INVALID_ENTITY',
      'Membership construction is restricted.',
    );
    issuedMemberships.add(this);
    Object.freeze(this);
  }

  static create(input: {
    readonly id: MembershipId;
    readonly userId: UserId;
    readonly tenantId: TenantId;
    readonly now: Instant;
    readonly roleGrants?: readonly RoleGrant[];
  }): Membership {
    const rawId = input.id;
    const rawUserId = input.userId;
    const rawTenantId = input.tenantId;
    const now = instant(input.now);
    const roleGrants = input.roleGrants ?? [];
    return new Membership(
      constructionToken,
      membershipId(rawId),
      userId(rawUserId),
      tenantId(rawTenantId),
      'PENDING',
      validatedGrants(roleGrants, now),
      0,
      now,
      now,
      null,
      null,
    );
  }

  /** Eligibility within this aggregate only; the caller must check surrounding resource facts. */
  effectiveGrantsAt(at: Instant): readonly RoleGrant[] {
    assertIssued(this);
    instant(at);
    return Object.freeze(
      this.status === 'ACTIVE' ? this.roleGrants.filter((grant) => grant.isEffectiveAt(at)) : [],
    );
  }

  #check(command: MembershipCommand): Instant {
    const expectedAuthorizationVersion = command.expectedAuthorizationVersion;
    const now = command.now;
    invariant(
      Number.isSafeInteger(expectedAuthorizationVersion) &&
        expectedAuthorizationVersion >= 0 &&
        expectedAuthorizationVersion === this.authorizationVersion,
      'AUTHORIZATION_VERSION_CONFLICT',
      'The command requires the current authorization version.',
    );
    return atOrAfter(now, this.updatedAt);
  }

  #changed(
    now: Instant,
    status: MembershipStatus,
    grants: readonly RoleGrant[],
    disabledReason: string | null = null,
  ): Membership {
    invariant(
      Number.isSafeInteger(this.authorizationVersion + 1),
      'AUTHORIZATION_VERSION_CONFLICT',
      'Authorization version exhausted.',
    );
    return new Membership(
      constructionToken,
      this.id,
      this.userId,
      this.tenantId,
      status,
      validatedGrants(grants, now),
      this.authorizationVersion + 1,
      this.createdAt,
      now,
      status === 'DISABLED' ? (this.disabledAt ?? now) : null,
      disabledReason,
    );
  }

  #replacement(approved: readonly RoleGrant[], now: Instant): readonly RoleGrant[] {
    const grants = validatedGrants(approved, now);
    const historicalIds = new Set(this.roleGrants.map((grant) => grant.id));
    for (const grant of grants) {
      invariant(
        !historicalIds.has(grant.id) && !grant.isRevoked && !grant.isExpired(now),
        'INVALID_ROLE_GRANT',
        'Replacement grants must be new, approved, and not expired or revoked.',
      );
    }
    return [...this.roleGrants.map((grant) => grant.revoke(now)), ...grants];
  }

  activatePending(command: ApprovedMembershipCommand): Membership {
    const now = this.#check(command);
    invariant(
      this.status === 'PENDING',
      'INVALID_STATE_TRANSITION',
      'Only pending membership can be activated.',
    );
    const approvedGrants = command.approvedGrants;
    return this.#changed(now, 'ACTIVE', this.#replacement(approvedGrants, now));
  }

  disable(command: MembershipCommand & { readonly reason: string }): Membership {
    const now = this.#check(command);
    invariant(
      this.status === 'ACTIVE' || this.status === 'PENDING',
      'INVALID_STATE_TRANSITION',
      'Only active or pending membership can be disabled.',
    );
    const reason = command.reason;
    return this.#changed(now, 'DISABLED', this.roleGrants, nonBlank(reason));
  }

  reactivate(command: MembershipReactivation): Membership {
    const now = this.#check(command);
    invariant(
      this.status === 'DISABLED',
      'INVALID_STATE_TRANSITION',
      'Only disabled membership can be reactivated.',
    );
    const mode = command.mode;
    invariant(
      mode === 'PRESERVE_EXISTING_VALID_GRANTS' || mode === 'REPLACE_GRANTS',
      'REACTIVATION_MODE_REQUIRED',
      'An explicit reactivation mode is required.',
    );
    if (mode === 'REPLACE_GRANTS') {
      const approvedGrants = command.approvedGrants;
      return this.#changed(now, 'ACTIVE', this.#replacement(approvedGrants, now));
    }
    const approvedGrantIds = command.approvedGrantIds;
    invariant(
      Array.isArray(approvedGrantIds),
      'UNAPPROVED_GRANT_REACTIVATION',
      'An explicit set of approved grant identifiers is required.',
    );
    const approvedIds = [...approvedGrantIds].map(roleGrantId);
    const ids = new Set(approvedIds);
    invariant(
      ids.size === approvedIds.length,
      'UNAPPROVED_GRANT_REACTIVATION',
      'Duplicate approval.',
    );
    for (const id of ids) {
      const grant = this.roleGrants.find((candidate) => candidate.id === id);
      invariant(
        grant?.isEffectiveAt(now),
        'UNAPPROVED_GRANT_REACTIVATION',
        'Every preserved grant must exist and be currently effective.',
      );
    }
    const grants = this.roleGrants.map((grant) => (ids.has(grant.id) ? grant : grant.revoke(now)));
    return this.#changed(now, 'ACTIVE', grants);
  }

  leave(command: MembershipCommand): Membership {
    const now = this.#check(command);
    invariant(
      this.status === 'ACTIVE',
      'INVALID_STATE_TRANSITION',
      'Only active membership can leave.',
    );
    return this.#changed(
      now,
      'LEFT',
      this.roleGrants.map((grant) => grant.revoke(now)),
    );
  }

  rejoin(command: ApprovedMembershipCommand): Membership {
    const now = this.#check(command);
    invariant(
      this.status === 'LEFT',
      'INVALID_STATE_TRANSITION',
      'Only left membership can rejoin.',
    );
    const approvedGrants = command.approvedGrants;
    return this.#changed(now, 'ACTIVE', this.#replacement(approvedGrants, now));
  }

  grantRole(command: MembershipCommand & { readonly approvedGrant: RoleGrant }): Membership {
    const now = this.#check(command);
    invariant(
      this.status === 'ACTIVE',
      'INVALID_STATE_TRANSITION',
      'Only active membership can receive grants.',
    );
    const approvedGrant = command.approvedGrant;
    const grants = validatedGrants([approvedGrant], now);
    const grant = grants[0];
    invariant(
      !this.roleGrants.some((old) => old.id === grant.id) &&
        !grant.isRevoked &&
        !grant.isExpired(now),
      'INVALID_ROLE_GRANT',
      'A new, approved, unrevoked and unexpired grant is required.',
    );
    return this.#changed(now, 'ACTIVE', [...this.roleGrants, grant]);
  }

  revokeGrant(command: MembershipCommand & { readonly grantId: RoleGrantId }): Membership {
    const now = this.#check(command);
    const rawGrantId = command.grantId;
    const id = roleGrantId(rawGrantId);
    const grant = this.roleGrants.find((candidate) => candidate.id === id);
    invariant(grant, 'INVALID_ROLE_GRANT', 'Unknown grant identifier.');
    if (grant.isRevoked) return this;
    return this.#changed(
      now,
      this.status,
      this.roleGrants.map((candidate) => (candidate.id === id ? candidate.revoke(now) : candidate)),
      this.disabledReason,
    );
  }

  replaceGrants(command: ApprovedMembershipCommand): Membership {
    const now = this.#check(command);
    invariant(
      this.status === 'ACTIVE',
      'INVALID_STATE_TRANSITION',
      'Only active membership can replace grants.',
    );
    const approvedGrants = command.approvedGrants;
    return this.#changed(now, 'ACTIVE', this.#replacement(approvedGrants, now));
  }
}

/** Privileged reconstruction; never re-export through the standard Domain barrel. */
export function rehydrateMembershipForPersistence(input: unknown): Membership {
  const state = persistenceRecord(input, [
    'id',
    'userId',
    'tenantId',
    'status',
    'roleGrants',
    'authorizationVersion',
    'createdAt',
    'updatedAt',
    'disabledAt',
    'disabledReason',
  ]);
  const id = membershipId(state.id);
  const subject = userId(state.userId);
  const tenant = tenantId(state.tenantId);
  const status = state.status;
  invariant(
    status === 'PENDING' || status === 'ACTIVE' || status === 'DISABLED' || status === 'LEFT',
    'INVALID_ENTITY',
    'Unknown membership status.',
  );
  const authorizationVersion = state.authorizationVersion;
  invariant(
    Number.isSafeInteger(authorizationVersion) &&
      typeof authorizationVersion === 'number' &&
      authorizationVersion >= 0,
    'AUTHORIZATION_VERSION_CONFLICT',
    'Invalid authorization version.',
  );
  const createdAt = persistenceInstant(state.createdAt);
  const updatedAt = atOrAfter(persistenceInstant(state.updatedAt), createdAt);
  const disabledAt = nullablePersistenceInstant(state.disabledAt);
  let disabledReason: string | null = null;
  if (status === 'DISABLED') {
    invariant(disabledAt !== null, 'INVALID_ENTITY', 'Disabled membership requires a timestamp.');
    atOrAfter(disabledAt, createdAt);
    atOrAfter(updatedAt, disabledAt);
    disabledReason = persistenceText(state.disabledReason);
  } else {
    invariant(
      disabledAt === null && state.disabledReason === null,
      'INVALID_ENTITY',
      'Non-disabled membership cannot have disabled facts.',
    );
  }
  const roleGrants = state.roleGrants;
  invariant(Array.isArray(roleGrants), 'INVALID_ROLE_GRANT', 'A grant collection is required.');
  const grants = validatedGrants(roleGrants, updatedAt);
  return new Membership(
    constructionToken,
    id,
    subject,
    tenant,
    status,
    grants,
    authorizationVersion,
    createdAt,
    updatedAt,
    disabledAt,
    disabledReason,
  );
}
