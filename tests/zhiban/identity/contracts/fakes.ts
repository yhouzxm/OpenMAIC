import {
  IdentityPortError,
  repositoryRevision,
  roleCatalogSnapshot,
  requireTenantContext,
  requireIdentityAuditEvent,
  type AuditPort,
  type ClockPort,
  type CredentialVerifierPort,
  type CredentialVerificationRequest,
  type CredentialVerificationResult,
  type IdGeneratorPort,
  type IdentityAuditEvent,
  type IdentityRepositoryPort,
  type Loaded,
  type MembershipRepositoryPort,
  type RepositoryRevision,
  type RoleCatalogPort,
  type RoleCatalogSnapshot,
  type SessionRecord,
  type SessionRepositoryPort,
  type SessionId,
  type TenantContext,
  type TenantRepositoryPort,
  type TokenDigest,
} from '@/lib/zhiban/application/identity/ports';
import {
  membershipId,
  roleGrantId,
  roleId,
  systemAdminGrantId,
  tenantId,
  userId,
  type Instant,
  type Membership,
  type MembershipId,
  type Role,
  type RoleCode,
  type SystemAdminGrant,
  type SystemAdminGrantId,
  type Tenant,
  type TenantId,
  type User,
  type UserId,
} from '@/lib/zhiban/domain/identity';

type Entry<T> = Loaded<T>;

function next<T>(value: T, number: number): Entry<T> {
  // Existing Session support only: canonicalize its test counter, without changing lifecycle.
  return Object.freeze({ value, revision: repositoryRevision(number.toString()) });
}
function initial<T>(value: T): Entry<T> {
  return Object.freeze({ value, revision: repositoryRevision('1') });
}
function advance<T>(value: T, revision: RepositoryRevision): Entry<T> {
  const incremented = BigInt(revision) + BigInt(1);
  if (incremented > BigInt('9223372036854775807')) throw new IdentityPortError('INTEGRITY_FAILURE');
  return Object.freeze({ value, revision: repositoryRevision(incremented.toString()) });
}
function checkRevision(actual: RepositoryRevision, expected: RepositoryRevision): void {
  repositoryRevision(expected);
  if (actual !== expected) throw new IdentityPortError('STALE_WRITE');
}

function integrity(condition: boolean): void {
  if (!condition) throw new IdentityPortError('INTEGRITY_FAILURE');
}
function sameUser(before: User, after: User): boolean {
  return before.id === after.id && before.status === after.status &&
    before.createdAt === after.createdAt && before.updatedAt === after.updatedAt &&
    before.disabledAt === after.disabledAt && before.disabledReason === after.disabledReason;
}
function sameTenant(before: Tenant, after: Tenant): boolean {
  return before.code === after.code && before.displayName === after.displayName &&
    before.id === after.id && before.status === after.status &&
    before.createdAt === after.createdAt && before.updatedAt === after.updatedAt &&
    before.disabledAt === after.disabledAt && before.disabledReason === after.disabledReason;
}
function sameAdminImmutable(before: SystemAdminGrant, after: SystemAdminGrant): boolean {
  return before.id === after.id && before.userId === after.userId &&
    before.createdAt === after.createdAt && before.validFrom === after.validFrom &&
    before.validUntil === after.validUntil;
}
function checkGrantHistory(before: Membership, after: Membership): void {
  integrity(after.roleGrants.length >= before.roleGrants.length);
  before.roleGrants.forEach((old, index) => {
    const grant = after.roleGrants[index];
    integrity(old.id === grant.id && old.roleCode === grant.roleCode &&
      old.scope.type === grant.scope.type && old.scope.scopeId === grant.scope.scopeId &&
      old.createdAt === grant.createdAt && old.validFrom === grant.validFrom &&
      old.validUntil === grant.validUntil &&
      (old.revokedAt === null || old.revokedAt === grant.revokedAt));
  });
}

function sameAuthorizationState(before: Membership, after: Membership): boolean {
  if (before.status !== after.status || before.disabledAt !== after.disabledAt ||
    before.disabledReason !== after.disabledReason || before.roleGrants.length !== after.roleGrants.length)
    return false;
  return before.roleGrants.every((old, index) => {
    const current = after.roleGrants[index];
    return (
      old.id === current.id &&
      old.roleCode === current.roleCode &&
      old.scope.type === current.scope.type &&
      old.scope.scopeId === current.scope.scopeId &&
      old.createdAt === current.createdAt &&
      old.validFrom === current.validFrom &&
      old.validUntil === current.validUntil &&
      old.revokedAt === current.revokedAt
    );
  });
}

function sameMembership(before: Membership, after: Membership): boolean {
  return before.id === after.id && before.userId === after.userId &&
    before.tenantId === after.tenantId &&
    before.authorizationVersion === after.authorizationVersion &&
    before.createdAt === after.createdAt && before.updatedAt === after.updatedAt &&
    sameAuthorizationState(before, after);
}

export class FakeIdentityRepository implements IdentityRepositoryPort {
  private readonly users = new Map<UserId, Entry<User>>();
  private readonly adminGrants = new Map<SystemAdminGrantId, Entry<SystemAdminGrant>>();

  async findById(id: UserId): Promise<Entry<User> | null> {
    return this.users.get(id) ?? null;
  }
  async create(user: User): Promise<Entry<User>> {
    if (this.users.has(user.id)) throw new IdentityPortError('CONFLICT');
    const entry = initial(user);
    this.users.set(user.id, entry);
    return entry;
  }
  async save(user: User, expectedRevision: RepositoryRevision): Promise<Entry<User>> {
    const current = this.users.get(user.id);
    if (!current) throw new IdentityPortError('CONFLICT');
    checkRevision(current.revision, expectedRevision);
    integrity(user.createdAt === current.value.createdAt && user.updatedAt >= current.value.updatedAt);
    if (sameUser(current.value, user)) return current;
    const entry = advance(user, current.revision);
    this.users.set(user.id, entry);
    return entry;
  }
  async findSystemAdminGrant(id: SystemAdminGrantId): Promise<Entry<SystemAdminGrant> | null> {
    return this.adminGrants.get(id) ?? null;
  }
  async createSystemAdminGrant(grant: SystemAdminGrant): Promise<Entry<SystemAdminGrant>> {
    if (this.adminGrants.has(grant.id)) throw new IdentityPortError('CONFLICT');
    const entry = initial(grant);
    this.adminGrants.set(grant.id, entry);
    return entry;
  }
  async saveSystemAdminGrant(
    grant: SystemAdminGrant,
    expectedRevision: RepositoryRevision,
  ): Promise<Entry<SystemAdminGrant>> {
    const current = this.adminGrants.get(grant.id);
    if (!current) throw new IdentityPortError('CONFLICT');
    checkRevision(current.revision, expectedRevision);
    integrity(sameAdminImmutable(current.value, grant) &&
      (current.value.revokedAt === null || current.value.revokedAt === grant.revokedAt));
    if (current.value.revokedAt === grant.revokedAt) return current;
    const entry = advance(grant, current.revision);
    this.adminGrants.set(grant.id, entry);
    return entry;
  }
}

export class FakeTenantRepository implements TenantRepositoryPort {
  private readonly tenants = new Map<TenantId, Entry<Tenant>>();
  async findById(id: TenantId): Promise<Entry<Tenant> | null> {
    return this.tenants.get(id) ?? null;
  }
  async findByCode(code: string): Promise<Entry<Tenant> | null> {
    return [...this.tenants.values()].find((entry) => entry.value.code === code) ?? null;
  }
  async create(tenant: Tenant): Promise<Entry<Tenant>> {
    if (this.tenants.has(tenant.id) || (await this.findByCode(tenant.code))) {
      throw new IdentityPortError('CONFLICT');
    }
    const entry = initial(tenant);
    this.tenants.set(tenant.id, entry);
    return entry;
  }
  async save(tenant: Tenant, expectedRevision: RepositoryRevision): Promise<Entry<Tenant>> {
    const current = this.tenants.get(tenant.id);
    if (!current) throw new IdentityPortError('CONFLICT');
    checkRevision(current.revision, expectedRevision);
    integrity(tenant.createdAt === current.value.createdAt && tenant.code === current.value.code &&
      tenant.displayName === current.value.displayName && tenant.updatedAt >= current.value.updatedAt &&
      (current.value.status !== 'ARCHIVED' || sameTenant(current.value, tenant)));
    if (sameTenant(current.value, tenant)) return current;
    const entry = advance(tenant, current.revision);
    this.tenants.set(tenant.id, entry);
    return entry;
  }
}

export class FakeMembershipRepository implements MembershipRepositoryPort {
  private readonly memberships = new Map<MembershipId, Entry<Membership>>();
  async findById(context: TenantContext, id: MembershipId): Promise<Entry<Membership> | null> {
    const tenant = requireTenantContext(context);
    const entry = this.memberships.get(id);
    return entry?.value.tenantId === tenant ? entry : null;
  }
  async findByUser(context: TenantContext, user: UserId): Promise<Entry<Membership> | null> {
    const tenant = requireTenantContext(context);
    return (
      [...this.memberships.values()].find(
        (entry) => entry.value.tenantId === tenant && entry.value.userId === user,
      ) ?? null
    );
  }
  async create(context: TenantContext, membership: Membership): Promise<Entry<Membership>> {
    const tenant = requireTenantContext(context);
    if (tenant !== membership.tenantId) throw new IdentityPortError('TENANT_SCOPE_VIOLATION');
    if (
      this.memberships.has(membership.id) ||
      [...this.memberships.values()].some(
        (entry) => entry.value.tenantId === tenant && entry.value.userId === membership.userId,
      )
    ) {
      throw new IdentityPortError('CONFLICT');
    }
    const entry = initial(membership);
    this.memberships.set(membership.id, entry);
    return entry;
  }
  async save(
    context: TenantContext,
    membership: Membership,
    expectedRevision: RepositoryRevision,
  ): Promise<Entry<Membership>> {
    const tenant = requireTenantContext(context);
    const current = this.memberships.get(membership.id);
    if (tenant !== membership.tenantId || (current && current.value.tenantId !== tenant)) {
      throw new IdentityPortError('TENANT_SCOPE_VIOLATION');
    }
    if (!current) throw new IdentityPortError('CONFLICT');
    checkRevision(current.revision, expectedRevision);
    if (
      current.value.id !== membership.id ||
      current.value.userId !== membership.userId ||
      current.value.tenantId !== membership.tenantId ||
      current.value.createdAt !== membership.createdAt
    ) {
      throw new IdentityPortError('INTEGRITY_FAILURE');
    }
    checkGrantHistory(current.value, membership);
    if (
      membership.authorizationVersion < current.value.authorizationVersion ||
      membership.updatedAt < current.value.updatedAt
    ) {
      throw new IdentityPortError('INTEGRITY_FAILURE');
    }
    if (membership.authorizationVersion === current.value.authorizationVersion) {
      // No reviewed metadata-only operation exists: equal versions require full state equality.
      integrity(sameMembership(current.value, membership));
      return current;
    }
    const entry = advance(membership, current.revision);
    this.memberships.set(membership.id, entry);
    return entry;
  }
}

export class FakeRoleCatalog implements RoleCatalogPort {
  private readonly catalog: RoleCatalogSnapshot;
  constructor(catalog: RoleCatalogSnapshot) {
    this.catalog = roleCatalogSnapshot(catalog.version, catalog.roles);
  }
  async findByCode(code: RoleCode): Promise<Role | null> {
    return this.catalog.roles.find((role) => role.code === code) ?? null;
  }
  async snapshot(): Promise<RoleCatalogSnapshot> {
    return this.catalog;
  }
}

export class FakeCredentialVerifier implements CredentialVerifierPort {
  constructor(
    private readonly user: UserId,
    private readonly expectedSecret: string,
  ) {}
  async verifyCredential(
    request: CredentialVerificationRequest,
  ): Promise<CredentialVerificationResult> {
    return request.identifier === 'known' && request.secret === this.expectedSecret
      ? { status: 'VERIFIED', userId: this.user }
      : { status: 'REJECTED' };
  }
}

export class FakeSessionRepository implements SessionRepositoryPort {
  private readonly sessions = new Map<SessionId, Entry<SessionRecord>>();
  private sequence = 0;
  async create(session: SessionRecord): Promise<Entry<SessionRecord>> {
    if (this.sessions.has(session.id)) throw new IdentityPortError('CONFLICT');
    const entry = next(session, ++this.sequence);
    this.sessions.set(session.id, entry);
    return entry;
  }
  async findByDigest(digest: TokenDigest): Promise<Entry<SessionRecord> | null> {
    return [...this.sessions.values()].find((entry) => entry.value.tokenDigest === digest) ?? null;
  }
  async touch(
    id: SessionId,
    lastSeenAt: Instant,
    idleExpiresAt: Instant,
    expectedRevision: RepositoryRevision,
  ): Promise<Entry<SessionRecord> | null> {
    const current = this.sessions.get(id);
    if (!current) return null;
    checkRevision(current.revision, expectedRevision);
    if (current.value.revokedAt !== null) return null;
    const entry = next({ ...current.value, lastSeenAt, idleExpiresAt }, ++this.sequence);
    this.sessions.set(id, entry);
    return entry;
  }
  async revoke(id: SessionId, at: Instant): Promise<void> {
    const current = this.sessions.get(id);
    if (current && current.value.revokedAt === null) {
      this.sessions.set(id, next({ ...current.value, revokedAt: at }, ++this.sequence));
    }
  }
  async revokeAllForUser(user: UserId, at: Instant): Promise<void> {
    for (const entry of this.sessions.values()) {
      if (entry.value.userId === user) await this.revoke(entry.value.id, at);
    }
  }
}

export class FakeAudit implements AuditPort {
  readonly events: IdentityAuditEvent[] = [];
  async append(event: IdentityAuditEvent): Promise<void> {
    this.events.push(requireIdentityAuditEvent(event));
  }
}
export class FakeClock implements ClockPort {
  constructor(private readonly fixed: Instant) {}
  now(): Instant {
    return this.fixed;
  }
}
export class FakeIdGenerator implements IdGeneratorPort {
  private sequence = 100;
  private uuid(): string {
    return `01996e82-5800-7000-8000-${(++this.sequence).toString(16).padStart(12, '0')}`;
  }
  nextUserId(): UserId {
    return userId(this.uuid());
  }
  nextTenantId(): TenantId {
    return tenantId(this.uuid());
  }
  nextMembershipId(): MembershipId {
    return membershipId(this.uuid());
  }
  nextRoleId() {
    return roleId(this.uuid());
  }
  nextRoleGrantId() {
    return roleGrantId(this.uuid());
  }
  nextSystemAdminGrantId() {
    return systemAdminGrantId(this.uuid());
  }
}
