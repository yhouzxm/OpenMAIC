export { IdentityPortError } from './errors';
export type { IdentityPortErrorCode } from './errors';
export { repositoryRevision } from './repository-types';
export type { Loaded, RepositoryRevision } from './repository-types';
export { tenantScopeContext, requireTenantContext } from './tenant-context';
export type { TenantContext } from './tenant-context';
export type { IdentityRepositoryPort } from './identity-repository';
export type { TenantRepositoryPort } from './tenant-repository';
export type { MembershipRepositoryPort } from './membership-repository';
export { roleCatalogSnapshot } from './role-catalog';
export type { RoleCatalogPort, RoleCatalogSnapshot } from './role-catalog';
export type {
  CredentialVerifierPort,
  CredentialVerificationRequest,
  CredentialVerificationResult,
} from './credential-verifier';
export { sessionId, tokenDigest } from './session-repository';
export type {
  SessionRepositoryPort,
  SessionRecord,
  SessionId,
  TokenDigest,
} from './session-repository';
export { createIdentityAuditEvent, requireIdentityAuditEvent } from './audit';
export type {
  AuditPort,
  IdentityAuditEvent,
  IdentityAuditActor,
  IdentityAuditEventInput,
  IdentityAuditGrantFact,
  IdentityAuditReason,
  IdentityAuditType,
} from './audit';
export type { ClockPort } from './clock';
export type { IdGeneratorPort } from './id-generator';
