export type LocalAccountType = 'student' | 'teacher' | 'admin';

export interface AuthenticatedAccount {
  id: string;
  tenantId: string;
  loginName: string;
  displayName: string;
  accountType: LocalAccountType;
  mustChangePassword: boolean;
}

export type LocalLoginFailure = 'invalid_credentials' | 'account_locked' | 'account_unavailable';

export type LocalLoginResult =
  | {
      ok: true;
      account: AuthenticatedAccount;
      sessionCookie: string;
      expiresAt: Date;
    }
  | { ok: false; reason: LocalLoginFailure };
