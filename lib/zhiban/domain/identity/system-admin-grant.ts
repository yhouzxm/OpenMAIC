import { systemAdminGrantId, userId, type SystemAdminGrantId, type UserId } from './ids';
import { atOrAfter, instant, validateValidity, type Instant } from './time';
import { invariant } from './errors';
import {
  nullablePersistenceInstant,
  persistenceInstant,
  persistenceRecord,
} from './persistence-validation';

const constructionToken = Symbol('SystemAdminGrant construction');
const issuedGrants = new WeakSet<SystemAdminGrant>();

function assertIssued(grant: unknown): void {
  invariant(
    issuedGrants.has(grant as SystemAdminGrant),
    'INVALID_ENTITY',
    'An authentic system administrator grant is required.',
  );
}

/** Validate the original persistence candidate; never reconstruct or transition it. */
export function assertAuthenticSystemAdminGrantForPersistence(
  value: unknown,
): asserts value is SystemAdminGrant {
  assertIssued(value);
}

export class SystemAdminGrant {
  constructor(
    token: typeof constructionToken,
    public readonly id: SystemAdminGrantId,
    public readonly userId: UserId,
    public readonly createdAt: Instant,
    public readonly validFrom: Instant,
    public readonly validUntil: Instant | null,
    public readonly revokedAt: Instant | null,
  ) {
    invariant(
      token === constructionToken,
      'INVALID_ENTITY',
      'System administrator grant construction is restricted.',
    );
    issuedGrants.add(this);
    Object.freeze(this);
  }

  static create(input: {
    readonly id: SystemAdminGrantId;
    readonly userId: UserId;
    readonly createdAt: Instant;
    readonly validFrom: Instant;
    readonly validUntil: Instant | null;
  }): SystemAdminGrant {
    const rawId = input.id;
    const rawUserId = input.userId;
    const rawCreatedAt = input.createdAt;
    const rawValidFrom = input.validFrom;
    const rawValidUntil = input.validUntil;
    const createdAt = instant(rawCreatedAt);
    const validFrom = atOrAfter(instant(rawValidFrom), createdAt);
    const validUntil = rawValidUntil === null ? null : instant(rawValidUntil);
    validateValidity(validFrom, validUntil);
    return new SystemAdminGrant(
      constructionToken,
      systemAdminGrantId(rawId),
      userId(rawUserId),
      createdAt,
      validFrom,
      validUntil,
      null,
    );
  }

  get isRevoked(): boolean {
    assertIssued(this);
    return this.revokedAt !== null;
  }
  isEffectiveAt(at: Instant): boolean {
    assertIssued(this);
    instant(at);
    return (
      !this.isRevoked && at >= this.validFrom && (this.validUntil === null || at < this.validUntil)
    );
  }
  revoke(at: Instant): SystemAdminGrant {
    assertIssued(this);
    atOrAfter(at, this.revokedAt ?? this.createdAt);
    if (this.isRevoked) return this;
    return new SystemAdminGrant(
      constructionToken,
      this.id,
      this.userId,
      this.createdAt,
      this.validFrom,
      this.validUntil,
      at,
    );
  }
}

/** Privileged reconstruction; never re-export through the standard Domain barrel. */
export function rehydrateSystemAdminGrantForPersistence(input: unknown): SystemAdminGrant {
  const state = persistenceRecord(input, [
    'id',
    'userId',
    'createdAt',
    'validFrom',
    'validUntil',
    'revokedAt',
  ]);
  const id = systemAdminGrantId(state.id);
  const subject = userId(state.userId);
  const createdAt = persistenceInstant(state.createdAt);
  const validFrom = atOrAfter(persistenceInstant(state.validFrom), createdAt);
  const validUntil = nullablePersistenceInstant(state.validUntil);
  validateValidity(validFrom, validUntil);
  const revokedAt = nullablePersistenceInstant(state.revokedAt);
  if (revokedAt !== null) atOrAfter(revokedAt, createdAt);
  return new SystemAdminGrant(
    constructionToken,
    id,
    subject,
    createdAt,
    validFrom,
    validUntil,
    revokedAt,
  );
}
