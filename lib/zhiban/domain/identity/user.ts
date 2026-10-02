import { invariant, nonBlank } from './errors';
import { userId, type UserId } from './ids';
import { atOrAfter, instant, type Instant } from './time';
import {
  nullablePersistenceInstant,
  persistenceInstant,
  persistenceRecord,
  persistenceText,
} from './persistence-validation';

export type UserStatus = 'ACTIVE' | 'DISABLED';
const constructionToken = Symbol('User construction');
const issuedUsers = new WeakSet<User>();

function assertIssued(user: unknown): void {
  invariant(issuedUsers.has(user as User), 'INVALID_ENTITY', 'An authentic user is required.');
}

/** Validate the original persistence candidate; never reconstruct or transition it. */
export function assertAuthenticUserForPersistence(value: unknown): asserts value is User {
  assertIssued(value);
}

export class User {
  constructor(
    token: typeof constructionToken,
    public readonly id: UserId,
    public readonly status: UserStatus,
    public readonly createdAt: Instant,
    public readonly updatedAt: Instant,
    public readonly disabledAt: Instant | null,
    public readonly disabledReason: string | null,
  ) {
    invariant(token === constructionToken, 'INVALID_ENTITY', 'User construction is restricted.');
    issuedUsers.add(this);
    Object.freeze(this);
  }

  static create(id: UserId, now: Instant): User {
    return new User(constructionToken, userId(id), 'ACTIVE', instant(now), now, null, null);
  }
  disable(now: Instant, reason: string): User {
    assertIssued(this);
    invariant(
      this.status === 'ACTIVE',
      'INVALID_STATE_TRANSITION',
      'Only an active user can be disabled.',
    );
    return new User(
      constructionToken,
      this.id,
      'DISABLED',
      this.createdAt,
      atOrAfter(now, this.updatedAt),
      now,
      nonBlank(reason),
    );
  }
  restore(now: Instant): User {
    assertIssued(this);
    invariant(
      this.status === 'DISABLED',
      'INVALID_STATE_TRANSITION',
      'Only a disabled user can be restored.',
    );
    return new User(
      constructionToken,
      this.id,
      'ACTIVE',
      this.createdAt,
      atOrAfter(now, this.updatedAt),
      null,
      null,
    );
  }
}

/** Privileged reconstruction; never re-export through the standard Domain barrel. */
export function rehydrateUserForPersistence(input: unknown): User {
  const state = persistenceRecord(input, [
    'id',
    'status',
    'createdAt',
    'updatedAt',
    'disabledAt',
    'disabledReason',
  ]);
  const id = userId(state.id);
  const status = state.status;
  invariant(status === 'ACTIVE' || status === 'DISABLED', 'INVALID_ENTITY', 'Unknown user status.');
  const createdAt = persistenceInstant(state.createdAt);
  const updatedAt = atOrAfter(persistenceInstant(state.updatedAt), createdAt);
  const disabledAt = nullablePersistenceInstant(state.disabledAt);
  if (status === 'ACTIVE') {
    invariant(
      disabledAt === null && state.disabledReason === null,
      'INVALID_ENTITY',
      'Active user cannot have disabled facts.',
    );
  } else {
    invariant(disabledAt !== null, 'INVALID_ENTITY', 'Disabled user requires a timestamp.');
    atOrAfter(disabledAt, createdAt);
    atOrAfter(updatedAt, disabledAt);
  }
  const disabledReason = status === 'DISABLED' ? persistenceText(state.disabledReason) : null;
  return new User(constructionToken, id, status, createdAt, updatedAt, disabledAt, disabledReason);
}
