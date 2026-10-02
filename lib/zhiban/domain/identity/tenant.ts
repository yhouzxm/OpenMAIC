import { invariant, nonBlank } from './errors';
import { tenantId, type TenantId } from './ids';
import { atOrAfter, instant, type Instant } from './time';
import {
  nullablePersistenceInstant,
  persistenceInstant,
  persistenceRecord,
  persistenceText,
} from './persistence-validation';

export type TenantStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
const constructionToken = Symbol('Tenant construction');
const issuedTenants = new WeakSet<Tenant>();

function assertIssued(tenant: unknown): void {
  invariant(issuedTenants.has(tenant as Tenant), 'INVALID_ENTITY', 'An authentic tenant is required.');
}

/** Validate the original persistence candidate; never reconstruct or transition it. */
export function assertAuthenticTenantForPersistence(value: unknown): asserts value is Tenant {
  assertIssued(value);
}

export class Tenant {
  constructor(
    token: typeof constructionToken,
    public readonly id: TenantId,
    public readonly code: string,
    public readonly displayName: string,
    public readonly status: TenantStatus,
    public readonly createdAt: Instant,
    public readonly updatedAt: Instant,
    public readonly disabledAt: Instant | null,
    public readonly disabledReason: string | null,
  ) {
    invariant(token === constructionToken, 'INVALID_ENTITY', 'Tenant construction is restricted.');
    issuedTenants.add(this);
    Object.freeze(this);
  }

  static create(id: TenantId, code: string, displayName: string, now: Instant): Tenant {
    invariant(
      typeof code === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(code),
      'INVALID_ENTITY',
      'Invalid tenant code.',
    );
    return new Tenant(
      constructionToken,
      tenantId(id),
      code,
      nonBlank(displayName),
      'ACTIVE',
      instant(now),
      now,
      null,
      null,
    );
  }
  disable(now: Instant, reason: string): Tenant {
    assertIssued(this);
    invariant(
      this.status === 'ACTIVE',
      'INVALID_STATE_TRANSITION',
      'Only an active tenant can be disabled.',
    );
    return new Tenant(
      constructionToken,
      this.id,
      this.code,
      this.displayName,
      'DISABLED',
      this.createdAt,
      atOrAfter(now, this.updatedAt),
      now,
      nonBlank(reason),
    );
  }
  restore(now: Instant): Tenant {
    assertIssued(this);
    invariant(
      this.status === 'DISABLED',
      'INVALID_STATE_TRANSITION',
      'Only a disabled tenant can be restored.',
    );
    return new Tenant(
      constructionToken,
      this.id,
      this.code,
      this.displayName,
      'ACTIVE',
      this.createdAt,
      atOrAfter(now, this.updatedAt),
      null,
      null,
    );
  }
  archive(now: Instant): Tenant {
    assertIssued(this);
    invariant(
      this.status !== 'ARCHIVED',
      'INVALID_STATE_TRANSITION',
      'Tenant is already archived.',
    );
    return new Tenant(
      constructionToken,
      this.id,
      this.code,
      this.displayName,
      'ARCHIVED',
      this.createdAt,
      atOrAfter(now, this.updatedAt),
      this.disabledAt,
      this.disabledReason,
    );
  }
}

/** Privileged reconstruction; never re-export through the standard Domain barrel. */
export function rehydrateTenantForPersistence(input: unknown): Tenant {
  const state = persistenceRecord(input, [
    'id',
    'code',
    'displayName',
    'status',
    'createdAt',
    'updatedAt',
    'disabledAt',
    'disabledReason',
  ]);
  const id = tenantId(state.id);
  invariant(
    typeof state.code === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(state.code),
    'INVALID_ENTITY',
    'Invalid tenant code.',
  );
  const code = state.code;
  const displayName = persistenceText(state.displayName);
  const status = state.status;
  invariant(
    status === 'ACTIVE' || status === 'DISABLED' || status === 'ARCHIVED',
    'INVALID_ENTITY',
    'Unknown tenant status.',
  );
  const createdAt = persistenceInstant(state.createdAt);
  const updatedAt = atOrAfter(persistenceInstant(state.updatedAt), createdAt);
  const disabledAt = nullablePersistenceInstant(state.disabledAt);
  invariant(
    (disabledAt === null) === (state.disabledReason === null),
    'INVALID_ENTITY',
    'Tenant disabled facts must be complete.',
  );
  if (status === 'ACTIVE') {
    invariant(disabledAt === null, 'INVALID_ENTITY', 'Active tenant cannot have disabled facts.');
  } else if (status === 'DISABLED') {
    invariant(disabledAt !== null, 'INVALID_ENTITY', 'Disabled tenant requires disabled facts.');
  }
  if (disabledAt !== null) {
    atOrAfter(disabledAt, createdAt);
    atOrAfter(updatedAt, disabledAt);
  }
  const disabledReason =
    state.disabledReason === null ? null : persistenceText(state.disabledReason);
  return new Tenant(
    constructionToken,
    id,
    code,
    displayName,
    status,
    createdAt,
    updatedAt,
    disabledAt,
    disabledReason,
  );
}
