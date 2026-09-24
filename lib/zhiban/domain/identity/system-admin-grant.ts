import { systemAdminGrantId, userId, type SystemAdminGrantId, type UserId } from './ids';
import { atOrAfter, instant, validateValidity, type Instant } from './time';

export class SystemAdminGrant {
  private constructor(
    public readonly id: SystemAdminGrantId,
    public readonly userId: UserId,
    public readonly createdAt: Instant,
    public readonly validFrom: Instant,
    public readonly validUntil: Instant | null,
    public readonly revokedAt: Instant | null,
  ) {
    Object.freeze(this);
  }

  static create(input: {
    readonly id: SystemAdminGrantId;
    readonly userId: UserId;
    readonly createdAt: Instant;
    readonly validFrom: Instant;
    readonly validUntil: Instant | null;
  }): SystemAdminGrant {
    instant(input.createdAt);
    validateValidity(input.validFrom, input.validUntil);
    atOrAfter(input.validFrom, input.createdAt);
    return new SystemAdminGrant(
      systemAdminGrantId(input.id),
      userId(input.userId),
      input.createdAt,
      input.validFrom,
      input.validUntil,
      null,
    );
  }

  get isRevoked(): boolean {
    return this.revokedAt !== null;
  }
  isEffectiveAt(at: Instant): boolean {
    instant(at);
    return (
      !this.isRevoked && at >= this.validFrom && (this.validUntil === null || at < this.validUntil)
    );
  }
  revoke(at: Instant): SystemAdminGrant {
    atOrAfter(at, this.revokedAt ?? this.createdAt);
    if (this.isRevoked) return this;
    return new SystemAdminGrant(
      this.id,
      this.userId,
      this.createdAt,
      this.validFrom,
      this.validUntil,
      at,
    );
  }
}
