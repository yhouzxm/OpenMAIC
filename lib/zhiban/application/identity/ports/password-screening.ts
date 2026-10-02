/** Security-only creation gate. Deployment supplies an approved compromised-password corpus/provider. */
export interface PasswordScreeningPort {
  /** Raw input is short-lived only; implementations must not log/cache it or fail open. */
  isCompromised(secret: string): Promise<boolean>;
}
