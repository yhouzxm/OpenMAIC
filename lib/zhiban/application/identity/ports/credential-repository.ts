import type { Instant, UserId } from '@/lib/zhiban/domain/identity';
import type { Loaded, RepositoryRevision } from './repository-types';
import type { IdentityAuditActor, IdentityAuditReason } from './audit';
import type { PasswordRehashHandle, PasswordVerifierHandle } from './password-hashing';

declare const credentialIdBrand: unique symbol;
declare const epochBrand: unique symbol;
export type CredentialId = string & { readonly [credentialIdBrand]: true };
export type SecurityEpoch = string & { readonly [epochBrand]: true };
export function credentialId(value: string): CredentialId {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
    throw new TypeError('Invalid credential identifier.');
  return value as CredentialId;
}
export function securityEpoch(value: string): SecurityEpoch {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > BigInt('9223372036854775807'))
    throw new TypeError('Invalid security epoch.');
  return value as SecurityEpoch;
}
export interface CredentialSlotMetadata {
  readonly userId: UserId;
  readonly type: 'PASSWORD';
  readonly activeCredentialId: CredentialId | null;
  readonly generation: string;
  readonly securityEpoch: SecurityEpoch;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}
export interface CredentialHistoryMetadata {
  readonly credentialId: CredentialId;
  readonly userId: UserId;
  readonly type: 'PASSWORD';
  readonly generation: string;
  readonly status: 'ACTIVE' | 'REPLACED' | 'REVOKED';
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly replacedAt: Instant | null;
  readonly revokedAt: Instant | null;
  readonly replacedByCredentialId: CredentialId | null;
}
export interface CredentialAuditContext {
  readonly actor: IdentityAuditActor;
  readonly requestId: string | null;
  readonly reason: IdentityAuditReason;
}
export interface CredentialRepositoryPort {
  findSlot(userId: UserId): Promise<Loaded<CredentialSlotMetadata> | null>;
  findHistory(userId: UserId): Promise<readonly CredentialHistoryMetadata[]>;
  createPassword(userId: UserId, id: CredentialId, verifier: PasswordVerifierHandle, at: Instant, audit: CredentialAuditContext): Promise<Loaded<CredentialSlotMetadata>>;
  replacePassword(userId: UserId, revision: RepositoryRevision, current: CredentialId | null, id: CredentialId, verifier: PasswordVerifierHandle, at: Instant, audit: CredentialAuditContext): Promise<Loaded<CredentialSlotMetadata>>;
  revokePassword(userId: UserId, revision: RepositoryRevision, current: CredentialId | null, at: Instant, audit: CredentialAuditContext): Promise<Loaded<CredentialSlotMetadata>>;
  rehashPassword(userId: UserId, revision: RepositoryRevision, current: CredentialId, proof: PasswordRehashHandle, at: Instant, audit: CredentialAuditContext): Promise<Loaded<CredentialSlotMetadata>>;
}
