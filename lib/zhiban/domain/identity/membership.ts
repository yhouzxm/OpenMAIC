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
import { RoleGrant } from './role-grant';
import { atOrAfter, instant, type Instant } from './time';

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

function validatedGrants(grants: readonly RoleGrant[], now: Instant): readonly RoleGrant[] {
  invariant(
    Array.isArray(grants),
    'INVALID_ROLE_GRANT',
    'An explicit grant collection is required.',
  );
  const ids = new Set<RoleGrantId>();
  for (const grant of grants) {
    invariant(grant instanceof RoleGrant, 'INVALID_ROLE_GRANT', 'A validated grant is required.');
    invariant(!ids.has(grant.id), 'INVALID_ROLE_GRANT', 'Duplicate grant identifier.');
    ids.add(grant.id);
    atOrAfter(now, grant.revokedAt ?? grant.createdAt);
  }
  return Object.freeze([...grants]);
}

export class Membership {
  private constructor(
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
    Object.freeze(this);
  }

  static create(input: {
    readonly id: MembershipId;
    readonly userId: UserId;
    readonly tenantId: TenantId;
    readonly now: Instant;
    readonly roleGrants?: readonly RoleGrant[];
  }): Membership {
    instant(input.now);
    return new Membership(
      membershipId(input.id),
      userId(input.userId),
      tenantId(input.tenantId),
      'PENDING',
      validatedGrants(input.roleGrants ?? [], input.now),
      0,
      input.now,
      input.now,
      null,
      null,
    );
  }

  /** Eligibility within this aggregate only; the caller must check surrounding resource facts. */
  effectiveGrantsAt(at: Instant): readonly RoleGrant[] {
    instant(at);
    return Object.freeze(
      this.status === 'ACTIVE' ? this.roleGrants.filter((grant) => grant.isEffectiveAt(at)) : [],
    );
  }

  private check(command: MembershipCommand): void {
    invariant(
      Number.isSafeInteger(command.expectedAuthorizationVersion) &&
        command.expectedAuthorizationVersion >= 0 &&
        command.expectedAuthorizationVersion === this.authorizationVersion,
      'AUTHORIZATION_VERSION_CONFLICT',
      'The command requires the current authorization version.',
    );
    atOrAfter(command.now, this.updatedAt);
  }

  private changed(
    command: MembershipCommand,
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
      this.id,
      this.userId,
      this.tenantId,
      status,
      validatedGrants(grants, command.now),
      this.authorizationVersion + 1,
      this.createdAt,
      command.now,
      status === 'DISABLED' ? (this.disabledAt ?? command.now) : null,
      disabledReason,
    );
  }

  private replacement(approved: readonly RoleGrant[], now: Instant): readonly RoleGrant[] {
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
    this.check(command);
    invariant(
      this.status === 'PENDING',
      'INVALID_STATE_TRANSITION',
      'Only pending membership can be activated.',
    );
    return this.changed(command, 'ACTIVE', this.replacement(command.approvedGrants, command.now));
  }

  disable(command: MembershipCommand & { readonly reason: string }): Membership {
    this.check(command);
    invariant(
      this.status === 'ACTIVE' || this.status === 'PENDING',
      'INVALID_STATE_TRANSITION',
      'Only active or pending membership can be disabled.',
    );
    return this.changed(command, 'DISABLED', this.roleGrants, nonBlank(command.reason));
  }

  reactivate(command: MembershipReactivation): Membership {
    this.check(command);
    invariant(
      this.status === 'DISABLED',
      'INVALID_STATE_TRANSITION',
      'Only disabled membership can be reactivated.',
    );
    invariant(
      command.mode === 'PRESERVE_EXISTING_VALID_GRANTS' || command.mode === 'REPLACE_GRANTS',
      'REACTIVATION_MODE_REQUIRED',
      'An explicit reactivation mode is required.',
    );
    if (command.mode === 'REPLACE_GRANTS') {
      return this.changed(command, 'ACTIVE', this.replacement(command.approvedGrants, command.now));
    }
    invariant(
      Array.isArray(command.approvedGrantIds),
      'UNAPPROVED_GRANT_REACTIVATION',
      'An explicit set of approved grant identifiers is required.',
    );
    const approvedIds = command.approvedGrantIds.map(roleGrantId);
    const ids = new Set(approvedIds);
    invariant(
      ids.size === approvedIds.length,
      'UNAPPROVED_GRANT_REACTIVATION',
      'Duplicate approval.',
    );
    for (const id of ids) {
      const grant = this.roleGrants.find((candidate) => candidate.id === id);
      invariant(
        grant?.isEffectiveAt(command.now),
        'UNAPPROVED_GRANT_REACTIVATION',
        'Every preserved grant must exist and be currently effective.',
      );
    }
    const grants = this.roleGrants.map((grant) =>
      ids.has(grant.id) ? grant : grant.revoke(command.now),
    );
    return this.changed(command, 'ACTIVE', grants);
  }

  leave(command: MembershipCommand): Membership {
    this.check(command);
    invariant(
      this.status === 'ACTIVE',
      'INVALID_STATE_TRANSITION',
      'Only active membership can leave.',
    );
    return this.changed(
      command,
      'LEFT',
      this.roleGrants.map((grant) => grant.revoke(command.now)),
    );
  }

  rejoin(command: ApprovedMembershipCommand): Membership {
    this.check(command);
    invariant(
      this.status === 'LEFT',
      'INVALID_STATE_TRANSITION',
      'Only left membership can rejoin.',
    );
    return this.changed(command, 'ACTIVE', this.replacement(command.approvedGrants, command.now));
  }

  grantRole(command: MembershipCommand & { readonly approvedGrant: RoleGrant }): Membership {
    this.check(command);
    invariant(
      this.status === 'ACTIVE',
      'INVALID_STATE_TRANSITION',
      'Only active membership can receive grants.',
    );
    const grants = validatedGrants([command.approvedGrant], command.now);
    const grant = grants[0];
    invariant(
      !this.roleGrants.some((old) => old.id === grant.id) &&
        !grant.isRevoked &&
        !grant.isExpired(command.now),
      'INVALID_ROLE_GRANT',
      'A new, approved, unrevoked and unexpired grant is required.',
    );
    return this.changed(command, 'ACTIVE', [...this.roleGrants, grant]);
  }

  revokeGrant(command: MembershipCommand & { readonly grantId: RoleGrantId }): Membership {
    this.check(command);
    const id = roleGrantId(command.grantId);
    const grant = this.roleGrants.find((candidate) => candidate.id === id);
    invariant(grant, 'INVALID_ROLE_GRANT', 'Unknown grant identifier.');
    if (grant.isRevoked) return this;
    return this.changed(
      command,
      this.status,
      this.roleGrants.map((candidate) =>
        candidate.id === id ? candidate.revoke(command.now) : candidate,
      ),
      this.disabledReason,
    );
  }

  replaceGrants(command: ApprovedMembershipCommand): Membership {
    this.check(command);
    invariant(
      this.status === 'ACTIVE',
      'INVALID_STATE_TRANSITION',
      'Only active membership can replace grants.',
    );
    return this.changed(command, 'ACTIVE', this.replacement(command.approvedGrants, command.now));
  }
}
