import type { UserId, TenantId, MembershipId } from '@/lib/zhiban/domain/identity';

/** Request-local opaque capability, not a DTO or permission/tenant proof. */
export interface AuthenticatedRequestHandle {
  readonly kind: 'AUTHENTICATED_REQUEST';
}
/** Server-observed transport handle, never a caller-supplied IP/header DTO. */
export interface AuthenticationTransport {
  readonly kind: 'SERVER_TRANSPORT';
}
export interface OwnIdentity {
  readonly userId: UserId;
  readonly absoluteExpiresAt: number;
  readonly idleExpiresAt: number;
}
export interface OwnSpace {
  readonly tenantId: TenantId;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly membershipId: MembershipId;
}
/** Security adapter resolves cookie/material; Application never accepts a claimed UserId. */
export interface OwnAuthenticationPort {
  me(handle: AuthenticatedRequestHandle): Promise<OwnIdentity>;
  logout(handle: AuthenticatedRequestHandle, requestId: string): Promise<void>;
  spaces(
    handle: AuthenticatedRequestHandle,
    after: MembershipId | null,
    limit: number,
  ): Promise<readonly OwnSpace[]>;
  logoutAll(
    handle: AuthenticatedRequestHandle,
    password: string,
    transport: AuthenticationTransport,
    requestId: string,
  ): Promise<void>;
  changePassword(
    handle: AuthenticatedRequestHandle,
    password: string,
    newPassword: string,
    transport: AuthenticationTransport,
    requestId: string,
    expectedRevision: string,
  ): Promise<void>;
  csrfToken(handle: AuthenticatedRequestHandle): Promise<string>;
  assertUnsafe(handle: AuthenticatedRequestHandle, origin: unknown, proof: unknown): Promise<void>;
}
export class OwnAuthentication {
  constructor(private readonly security: OwnAuthenticationPort) {}
  me(handle: AuthenticatedRequestHandle) {
    return this.security.me(handle);
  }
  logout(handle: AuthenticatedRequestHandle, requestId: string) {
    return this.security.logout(handle, requestId);
  }
  spaces(handle: AuthenticatedRequestHandle, after: MembershipId | null = null, limit = 25) {
    return this.security.spaces(handle, after, limit);
  }
  // Secrets are ephemeral inputs only; these methods retain no request/secret state.
  logoutAll(
    handle: AuthenticatedRequestHandle,
    password: string,
    transport: AuthenticationTransport,
    requestId: string,
  ) {
    return this.security.logoutAll(handle, password, transport, requestId);
  }
  changePassword(
    handle: AuthenticatedRequestHandle,
    password: string,
    newPassword: string,
    transport: AuthenticationTransport,
    requestId: string,
    expectedRevision: string,
  ) {
    return this.security.changePassword(
      handle,
      password,
      newPassword,
      transport,
      requestId,
      expectedRevision,
    );
  }
  csrfToken(handle: AuthenticatedRequestHandle) {
    return this.security.csrfToken(handle);
  }
  assertUnsafe(handle: AuthenticatedRequestHandle, origin: unknown, proof: unknown) {
    return this.security.assertUnsafe(handle, origin, proof);
  }
}
