import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debtFingerprint, admitsDebt } from './eslint-debt-policy.mjs';
test('ratchet blocks new, changed, repeated and security-rule errors', () => {
  const m = { ruleId: '@typescript-eslint/no-explicit-any', message: 'Unexpected any.' };
  const key = debtFingerprint('lib/legacy.ts', m, 'value: any');
  const b = { entries: { [key]: 1 } };
  assert.equal(admitsDebt(b, key, 1, m.ruleId), true);
  assert.equal(admitsDebt(b, key, 2, m.ruleId), false);
  for (const k of [
    debtFingerprint('lib/new.ts', m, 'value: any'),
    debtFingerprint('lib/legacy.ts', m, 'other: any'),
  ])
    assert.equal(admitsDebt(b, k, 1, m.ruleId), false);
  assert.equal(admitsDebt(b, key, 1, 'no-restricted-syntax'), false);
  assert.equal(admitsDebt(b, key, 1, null), false);
});
