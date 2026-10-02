import { instant, userId, type Instant, type UserId } from '@/lib/zhiban/domain/identity';
import { createIdentityAuditEvent } from '@/lib/zhiban/application/identity/ports/audit';
import { credentialId, securityEpoch, type CredentialAuditContext, type CredentialHistoryMetadata, type CredentialId, type CredentialRepositoryPort, type CredentialSlotMetadata, type SecurityEpoch } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import type { PasswordRehashHandle, PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';
import { repositoryRevision, type Loaded, type RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { rehashMaterial, verifierMaterial } from '@/lib/zhiban/infrastructure/identity/credentials/verifier-material';

/** Independent safe-result Fake; opaque verifier material stays in private security storage. */
export class FakeCredentialRepository implements CredentialRepositoryPort {
  #users: ReadonlySet<UserId>;
  constructor(existingUsers: readonly UserId[]) { this.#users = new Set(existingUsers.map(id => userId(credentialId(id)))); }
  private slots = new Map<UserId, Loaded<CredentialSlotMetadata>>();
  private histories = new Map<UserId, CredentialHistoryMetadata[]>();
  #materials = new Map<CredentialId, string>();
  readonly audit = [] as ReturnType<typeof createIdentityAuditEvent>[];
  /** Fixture only: reaching int8 maximum by billions of real mutations is not a test strategy. */
  setVersionBoundaryForTest(id: UserId, revision: RepositoryRevision, epoch: SecurityEpoch) {
    const stored = this.slots.get(id);
    if (!stored) throw new Error('Credential fixture requires an existing slot.');
    this.slots.set(id, Object.freeze({ revision: repositoryRevision(revision), value: Object.freeze({ ...stored.value, securityEpoch: securityEpoch(epoch) }) }));
  }
  async findSlot(id: UserId) { return this.slots.get(userId(id)) ?? null; }
  async findHistory(id: UserId) { return Object.freeze([...(this.histories.get(userId(id)) ?? [])]); }
  private advance(value: string) { if (value === '9223372036854775807') throw new IdentityPortError('INTEGRITY_FAILURE'); return (BigInt(value) + BigInt(1)).toString(); }
  private target(id: UserId, revision: RepositoryRevision, current: CredentialId | null) {
    const stored = this.slots.get(id);
    if (!stored) throw new IdentityPortError('CONFLICT');
    try { repositoryRevision(revision); } catch { throw new IdentityPortError('INTEGRITY_FAILURE'); }
    if (stored.revision !== revision) throw new IdentityPortError('STALE_WRITE');
    if (stored.value.activeCredentialId !== current) throw new IdentityPortError('CONFLICT');
    return stored;
  }
  private newHistory(id: UserId, newId: CredentialId, at: Instant, generation: string): CredentialHistoryMetadata {
    return Object.freeze({ credentialId: newId, userId: id, type: 'PASSWORD', generation, status: 'ACTIVE', createdAt: at, updatedAt: at, replacedAt: null, revokedAt: null, replacedByCredentialId: null });
  }
  async createPassword(id: UserId, newId: CredentialId, handle: PasswordVerifierHandle, at: Instant, audit: CredentialAuditContext) {
    id = userId(id); newId = credentialId(newId); at = instant(at);
    const material = verifierMaterial(handle);
    if (!this.#users.has(id)) throw new IdentityPortError('INTEGRITY_FAILURE');
    if (this.slots.has(id) || [...this.histories.values()].flat().some(row => row.credentialId === newId)) throw new IdentityPortError('CONFLICT');
    const event = createIdentityAuditEvent({ ...audit, type: 'CREDENTIAL_CREATED', occurredAt: at, userId: id, credentialId: newId, repositoryRevisionAfter: repositoryRevision('1'), securityEpochAfter: securityEpoch('1') });
    const loaded = Object.freeze({ value: Object.freeze({ userId: id, type: 'PASSWORD' as const, activeCredentialId: newId, generation: '1', securityEpoch: securityEpoch('1'), createdAt: at, updatedAt: at }), revision: repositoryRevision('1') });
    this.slots.set(id, loaded); this.histories.set(id, [this.newHistory(id, newId, at, '1')]); this.#materials.set(newId, material); this.audit.push(event); return loaded;
  }
  async replacePassword(id: UserId, revision: RepositoryRevision, current: CredentialId | null, newId: CredentialId, handle: PasswordVerifierHandle, at: Instant, audit: CredentialAuditContext) {
    const stored = this.target(id, revision, current); credentialId(newId); instant(at);
    if (at < stored.value.updatedAt) throw new IdentityPortError('INTEGRITY_FAILURE');
    if ([...this.histories.values()].flat().some(row => row.credentialId === newId)) throw new IdentityPortError('CONFLICT');
    const material = verifierMaterial(handle), next = repositoryRevision(this.advance(revision)), epoch = securityEpoch(this.advance(stored.value.securityEpoch)), generation = this.advance(stored.value.generation);
    const event = createIdentityAuditEvent({ ...audit, type: 'CREDENTIAL_REPLACED', occurredAt: at, userId: id, credentialId: newId, priorCredentialId: current, repositoryRevisionBefore: revision, repositoryRevisionAfter: next, securityEpochBefore: stored.value.securityEpoch, securityEpochAfter: epoch });
    const rows = this.histories.get(id)!.map(row => row.credentialId === current ? Object.freeze({ ...row, status: 'REPLACED' as const, updatedAt: at, replacedAt: at, replacedByCredentialId: newId }) : row);
    rows.push(this.newHistory(id, newId, at, generation));
    const loaded = Object.freeze({ revision: next, value: Object.freeze({ ...stored.value, activeCredentialId: newId, generation, securityEpoch: epoch, updatedAt: at }) });
    if (current) this.#materials.delete(current); this.#materials.set(newId, material); this.histories.set(id, rows); this.slots.set(id, loaded); this.audit.push(event); return loaded;
  }
  async revokePassword(id: UserId, revision: RepositoryRevision, current: CredentialId | null, at: Instant, audit: CredentialAuditContext) {
    instant(at);
    const stored = this.target(id, revision, current);
    if (current === null) return stored;
    instant(at); if (at < stored.value.updatedAt) throw new IdentityPortError('INTEGRITY_FAILURE');
    const next = repositoryRevision(this.advance(revision)), epoch = securityEpoch(this.advance(stored.value.securityEpoch));
    const event = createIdentityAuditEvent({ ...audit, type: 'CREDENTIAL_REVOKED', occurredAt: at, userId: id, credentialId: current, repositoryRevisionBefore: revision, repositoryRevisionAfter: next, securityEpochBefore: stored.value.securityEpoch, securityEpochAfter: epoch });
    const loaded = Object.freeze({ revision: next, value: Object.freeze({ ...stored.value, activeCredentialId: null, securityEpoch: epoch, updatedAt: at }) });
    this.histories.set(id, this.histories.get(id)!.map(row => row.credentialId === current ? Object.freeze({ ...row, status: 'REVOKED' as const, updatedAt: at, revokedAt: at }) : row));
    this.#materials.delete(current); this.slots.set(id, loaded); this.audit.push(event); return loaded;
  }
  async rehashPassword(id: UserId, revision: RepositoryRevision, current: CredentialId, proof: PasswordRehashHandle, at: Instant, audit: CredentialAuditContext) {
    const stored = this.target(id, revision, current); instant(at);
    if (at < stored.value.updatedAt) throw new IdentityPortError('INTEGRITY_FAILURE');
    const material = rehashMaterial(proof, this.#materials.get(current)!);
    const next = repositoryRevision(this.advance(revision));
    const event = createIdentityAuditEvent({ ...audit, type: 'CREDENTIAL_REHASHED', occurredAt: at, userId: id, credentialId: current, repositoryRevisionBefore: revision, repositoryRevisionAfter: next, securityEpoch: stored.value.securityEpoch });
    const loaded = Object.freeze({ revision: next, value: Object.freeze({ ...stored.value, updatedAt: at }) });
    this.histories.set(id, this.histories.get(id)!.map(row => row.credentialId === current ? Object.freeze({ ...row, updatedAt: at }) : row));
    this.slots.set(id, loaded); this.#materials.set(current, material); this.audit.push(event); return loaded;
  }
}
