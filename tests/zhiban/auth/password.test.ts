import { describe, expect, it } from 'vitest';

import {
  hashLocalPassword,
  validateLocalPassword,
  verifyLocalPassword,
} from '@/lib/zhiban/auth/password';

describe('local password security', () => {
  it('hashes valid passwords with Argon2id v19 and verifies them', async () => {
    const encoded = await hashLocalPassword('AdultLearning2026!');
    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(verifyLocalPassword(encoded, 'AdultLearning2026!')).resolves.toBe(true);
    await expect(verifyLocalPassword(encoded, 'wrong-password')).resolves.toBe(false);
  });

  it('rejects short, excessively long, or single-category passwords', () => {
    expect(() => validateLocalPassword('short1')).toThrow();
    expect(() => validateLocalPassword('letters-only-password')).toThrow();
    expect(() => validateLocalPassword('1234567890123456')).toThrow();
    expect(() => validateLocalPassword(`A1${'x'.repeat(127)}`)).toThrow();
  });

  it('performs a dummy verification for missing accounts', async () => {
    await expect(verifyLocalPassword(null, 'unknown-password')).resolves.toBe(false);
    await expect(verifyLocalPassword('invalid-encoded-hash', 'password')).resolves.toBe(false);
  });
});
