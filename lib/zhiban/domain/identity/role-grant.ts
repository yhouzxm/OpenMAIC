import { roleGrantId, type RoleGrantId } from './ids';
import { roleCode, type RoleCode } from './role';
import { parseScope, type Scope } from './scope';
import { atOrAfter, instant, validateValidity, type Instant } from './time';

export interface RoleGrantInput {
  readonly id: RoleGrantId;
  readonly roleCode: RoleCode;
  readonly scope: Scope;
  readonly createdAt: Instant;
  readonly validFrom: Instant;
  readonly validUntil: Instant | null;
}

export class RoleGrant {
  private constructor(
    public readonly id: RoleGrantId,
    public readonly roleCode: RoleCode,
    public readonly scope: Scope,
    public readonly createdAt: Instant,
    public readonly validFrom: Instant,
    public readonly validUntil: Instant | null,
    public readonly revokedAt: Instant | null,
  ) {
    Object.freeze(this);
  }

  static create(input: RoleGrantInput): RoleGrant {
    validateValidity(input.validFrom, input.validUntil);
    atOrAfter(input.validFrom, input.createdAt);
    instant(input.createdAt);
    return new RoleGrant(
      roleGrantId(input.id),
      roleCode(input.roleCode),
      parseScope(input.scope?.type, input.scope?.scopeId),
      input.createdAt,
      input.validFrom,
      input.validUntil,
      null,
    );
  }

  get isRevoked(): boolean {
    return this.revokedAt !== null;
  }
  isExpired(at: Instant): boolean {
    instant(at);
    return this.validUntil !== null && at >= this.validUntil;
  }
  isNotYetEffective(at: Instant): boolean {
    instant(at);
    return at < this.validFrom;
  }
  isEffectiveAt(at: Instant): boolean {
    return !this.isExpired(at) && !this.isNotYetEffective(at) && !this.isRevoked;
  }
  revoke(at: Instant): RoleGrant {
    atOrAfter(at, this.revokedAt ?? this.createdAt);
    if (this.isRevoked) return this;
    return new RoleGrant(
      this.id,
      this.roleCode,
      this.scope,
      this.createdAt,
      this.validFrom,
      this.validUntil,
      at,
    );
  }
}
