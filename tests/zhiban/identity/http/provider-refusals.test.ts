import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { observeOperation } from '@/lib/zhiban/infrastructure/identity/composition/refusals';
import type { PasswordScreeningPort } from '@/lib/zhiban/application/identity/ports/password-screening';
describe('D8 real hashing boundary preserves only trusted immediate classification', () => {
  it('real true screening is the sole password-policy refusal', async () => {
    const result = await observeOperation(() =>
      new Argon2PasswordHasher({ isCompromised: async () => true }).hash(
        'Synthetic-only-screening-input!',
      ),
    );
    expect(result).toEqual({ ok: false, refusal: 'PASSWORD_POLICY_REJECTED' });
  });
  it.each(['false', 0, undefined, null])(
    'nonboolean screening %# remains unclassified system failure',
    async (value) => {
      expect(
        await observeOperation(() =>
          new Argon2PasswordHasher({
            isCompromised: async () => value,
          } as unknown as PasswordScreeningPort).hash('Synthetic-only-screening-input!'),
        ),
      ).toEqual({ ok: false, refusal: null });
    },
  );
  it('provider custom tags and cause cannot fabricate observation; real native hash still works after exception', async () => {
    const bad = new Argon2PasswordHasher({
      isCompromised: async () => {
        throw { code: 'PASSWORD_POLICY_REJECTED', cause: 'synthetic-untrusted-provider-input' };
      },
    });
    expect(await observeOperation(() => bad.hash('Synthetic-only-screening-input!'))).toEqual({
      ok: false,
      refusal: null,
    });
    const good = new Argon2PasswordHasher({ isCompromised: async () => false });
    const verifier = await good.hash('Synthetic-only-screening-input!');
    expect(await good.verify('Synthetic-only-screening-input!', verifier)).toBe(true);
    expect(await good.verify('Synthetic-wrong-input!', verifier)).toBe(false);
  });
});
