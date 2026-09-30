import { roleGrantId, type RoleGrantId } from './ids';
import { invariant } from './errors';
import { roleCode, type RoleCode } from './role';
import { parseScope, type Scope } from './scope';
import { atOrAfter, instant, validateValidity, type Instant } from './time';
import {
  nullablePersistenceInstant,
  persistenceInstant,
  persistenceRecord,
} from './persistence-validation';

const constructionToken = Symbol('RoleGrant construction');
const issuedGrants = new WeakSet<RoleGrant>();

export function isIssuedRoleGrantForDomain(value: unknown): value is RoleGrant {
  return typeof value === 'object' && value !== null && issuedGrants.has(value as RoleGrant);
}

function assertIssued(grant: RoleGrant): void {
  invariant(
    isIssuedRoleGrantForDomain(grant),
    'INVALID_ROLE_GRANT',
    'An authentic role grant is required.',
  );
}

export interface RoleGrantInput {
  readonly id: RoleGrantId;
  readonly roleCode: RoleCode;
  readonly scope: Scope;
  readonly createdAt: Instant;
  readonly validFrom: Instant;
  readonly validUntil: Instant | null;
}

export class RoleGrant {
  constructor(
    token: typeof constructionToken,
    public readonly id: RoleGrantId,
    public readonly roleCode: RoleCode,
    public readonly scope: Scope,
    public readonly createdAt: Instant,
    public readonly validFrom: Instant,
    public readonly validUntil: Instant | null,
    public readonly revokedAt: Instant | null,
  ) {
    invariant(
      token === constructionToken,
      'INVALID_ROLE_GRANT',
      'Role grant construction is restricted.',
    );
    issuedGrants.add(this);
    Object.freeze(this);
  }

  static create(input: RoleGrantInput): RoleGrant {
    const rawId = input.id;
    const rawRoleCode = input.roleCode;
    const rawScope = input.scope;
    const rawCreatedAt = input.createdAt;
    const rawValidFrom = input.validFrom;
    const rawValidUntil = input.validUntil;
    const scopeType = rawScope?.type;
    const scopeId = rawScope?.scopeId;
    const createdAt = instant(rawCreatedAt);
    const validFrom = atOrAfter(instant(rawValidFrom), createdAt);
    const validUntil = rawValidUntil === null ? null : instant(rawValidUntil);
    validateValidity(validFrom, validUntil);
    return new RoleGrant(
      constructionToken,
      roleGrantId(rawId),
      roleCode(rawRoleCode),
      parseScope(scopeType, scopeId),
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
  isExpired(at: Instant): boolean {
    assertIssued(this);
    instant(at);
    return this.validUntil !== null && at >= this.validUntil;
  }
  isNotYetEffective(at: Instant): boolean {
    assertIssued(this);
    instant(at);
    return at < this.validFrom;
  }
  isEffectiveAt(at: Instant): boolean {
    assertIssued(this);
    return !this.isExpired(at) && !this.isNotYetEffective(at) && !this.isRevoked;
  }
  revoke(at: Instant): RoleGrant {
    assertIssued(this);
    atOrAfter(at, this.revokedAt ?? this.createdAt);
    if (this.isRevoked) return this;
    return new RoleGrant(
      constructionToken,
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

/** Privileged reconstruction; never re-export through the standard Domain barrel. */
export function rehydrateRoleGrantForPersistence(input: unknown): RoleGrant {
  const state = persistenceRecord(input, [
    'id',
    'roleCode',
    'scope',
    'createdAt',
    'validFrom',
    'validUntil',
    'revokedAt',
  ]);
  const id = roleGrantId(state.id);
  const code = roleCode(state.roleCode);
  const scopeState = persistenceRecord(state.scope, ['type', 'scopeId']);
  const scope = parseScope(scopeState.type, scopeState.scopeId);
  const createdAt = persistenceInstant(state.createdAt);
  const validFrom = atOrAfter(persistenceInstant(state.validFrom), createdAt);
  const validUntil = nullablePersistenceInstant(state.validUntil);
  validateValidity(validFrom, validUntil);
  const revokedAt = nullablePersistenceInstant(state.revokedAt);
  if (revokedAt !== null) atOrAfter(revokedAt, createdAt);
  return new RoleGrant(
    constructionToken,
    id,
    code,
    scope,
    createdAt,
    validFrom,
    validUntil,
    revokedAt,
  );
}
