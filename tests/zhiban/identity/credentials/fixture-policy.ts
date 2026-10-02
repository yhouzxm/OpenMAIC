import type { PasswordScreeningPort } from '@/lib/zhiban/application/identity/ports/password-screening';
/** Synthetic vectors only; never a production permissive compromised-password provider. */
export const syntheticPasswordScreening: PasswordScreeningPort = {
  async isCompromised(secret) {
    return (
      !secret.startsWith('Synthetic') &&
      !secret.startsWith('  Unicode') &&
      !/^[A-Za-z0-9+/]{64}$/.test(secret)
    );
  },
};
