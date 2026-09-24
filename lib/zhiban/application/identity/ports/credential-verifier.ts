import type { UserId } from '@/lib/zhiban/domain/identity';

/** Secret must never be logged, audited, stored in Domain, or returned. */
export interface CredentialVerificationRequest {
  readonly identifier: string;
  readonly secret: string;
}

export type CredentialVerificationResult =
  | { readonly status: 'VERIFIED'; readonly userId: UserId }
  | { readonly status: 'REJECTED' };

export interface CredentialVerifierPort {
  verifyCredential(request: CredentialVerificationRequest): Promise<CredentialVerificationResult>;
}
