/** Request-local opaque capability, not a DTO or permission/tenant proof. */
export interface AuthenticatedRequestHandle {
  readonly kind: 'AUTHENTICATED_REQUEST';
}
/** Server-observed transport handle, never a caller-supplied IP/header DTO. */
export interface AuthenticationTransport {
  readonly kind: 'SERVER_TRANSPORT';
}
