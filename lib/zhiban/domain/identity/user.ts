import { invariant, nonBlank } from './errors';
import { userId, type UserId } from './ids';
import { atOrAfter, instant, type Instant } from './time';

export type UserStatus = 'ACTIVE' | 'DISABLED';

export class User {
  private constructor(
    public readonly id: UserId,
    public readonly status: UserStatus,
    public readonly createdAt: Instant,
    public readonly updatedAt: Instant,
    public readonly disabledAt: Instant | null,
    public readonly disabledReason: string | null,
  ) {
    Object.freeze(this);
  }

  static create(id: UserId, now: Instant): User {
    return new User(userId(id), 'ACTIVE', instant(now), now, null, null);
  }
  disable(now: Instant, reason: string): User {
    invariant(
      this.status === 'ACTIVE',
      'INVALID_STATE_TRANSITION',
      'Only an active user can be disabled.',
    );
    return new User(
      this.id,
      'DISABLED',
      this.createdAt,
      atOrAfter(now, this.updatedAt),
      now,
      nonBlank(reason),
    );
  }
  restore(now: Instant): User {
    invariant(
      this.status === 'DISABLED',
      'INVALID_STATE_TRANSITION',
      'Only a disabled user can be restored.',
    );
    return new User(this.id, 'ACTIVE', this.createdAt, atOrAfter(now, this.updatedAt), null, null);
  }
}
