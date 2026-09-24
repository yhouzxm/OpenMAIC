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
  return Object.freeze({ value, revision: repositoryRevision(`fake-${number}`) });
}
function checkRevision(actual: RepositoryRevision, expected: RepositoryRevision): void {
  if (actual !== expected) throw new IdentityPortError('STALE_WRITE');
}

function sameAuthorizationState(before: Membership, after: Membership): boolean {
  if (before.status !== after.status || before.roleGrants.length !== after.roleGrants.length)
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

export class FakeIdentityRepository implements IdentityRepositoryPort {
  private readonly users = new Map<UserId, Entry<User>>();
  private readonly adminGrants = new Map<SystemAdminGrantId, Entry<SystemAdminGrant>>();
  private sequence = 0;

  async findById(id: UserId): Promise<Entry<User> | null> {
    return this.users.get(id) ?? null;
  }
  async create(user: User): Promise<Entry<User>> {
    if (this.users.has(user.id)) throw new IdentityPortError('CONFLICT');
    const entry = next(user, ++this.sequence);
    this.users.set(user.id, entry);
    return entry;
  }
  async save(user: User, expectedRevision: RepositoryRevision): Promise<Entry<User>> {
    const current = this.users.get(user.id);
    if (!current) throw new IdentityPortError('CONFLICT');
    checkRevision(current.revision, expectedRevision);
    const entry = next(user, ++this.sequence);
    this.users.set(user.id, entry);
    return entry;
  }
  async findSystemAdminGrant(id: SystemAdminGrantId): Promise<Entry<SystemAdminGrant> | null> {
    return this.adminGrants.get(id) ?? null;
  }
  async createSystemAdminGrant(grant: SystemAdminGrant): Promise<Entry<SystemAdminGrant>> {
    if (this.adminGrants.has(grant.id)) throw new IdentityPortError('CONFLICT');
    const entry = next(grant, ++this.sequence);
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
    const entry = next(grant, ++this.sequence);
    this.adminGrants.set(grant.id, entry);
    return entry;
  }
}

export class FakeTenantRepository implements TenantRepositoryPort {
  private readonly tenants = new Map<TenantId, Entry<Tenant>>();
  private sequence = 0;
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
    const entry = next(tenant, ++this.sequence);
    this.tenants.set(tenant.id, entry);
    return entry;
  }
  async save(tenant: Tenant, expectedRevision: RepositoryRevision): Promise<Entry<Tenant>> {
    const current = this.tenants.get(tenant.id);
    if (!current) throw new IdentityPortError('CONFLICT');
    checkRevision(current.revision, expectedRevision);
    const entry = next(tenant, ++this.sequence);
    this.tenants.set(tenant.id, entry);
    return entry;
  }
}

export class FakeMembershipRepository implements MembershipRepositoryPort {
  private readonly memberships = new Map<MembershipId, Entry<Membership>>();
  private sequence = 0;
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
    const entry = next(membership, ++this.sequence);
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
    if (
      current.value.id !== membership.id ||
      current.value.userId !== membership.userId ||
      current.value.tenantId !== membership.tenantId ||
      current.value.createdAt !== membership.createdAt
    ) {
      throw new IdentityPortError('INTEGRITY_FAILURE');
    }
    checkRevision(current.revision, expectedRevision);
    if (
      membership.authorizationVersion < current.value.authorizationVersion ||
      membership.updatedAt < current.value.updatedAt ||
      (membership.authorizationVersion === current.value.authorizationVersion &&
        !sameAuthorizationState(current.value, membership))
    ) {
      throw new IdentityPortError('INTEGRITY_FAILURE');
    }
    const entry = next(membership, ++this.sequence);
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
