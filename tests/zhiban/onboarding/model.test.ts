import { describe, it, expect } from 'vitest';
import {
  accountRequestCommand,
  ticketParts,
  onboardingDigest,
} from '../../../lib/zhiban/domain/onboarding/model';
describe('ordinary onboarding closed intents', () => {
  it('refuses requested global authority and secrets in tenant requests', () => {
    const c = {
      type: 'REQUEST_ACCOUNT',
      name: '合成用户',
      subjectReference: 'LOCAL-ROSTER-1',
      requestedRole: 'STUDENT',
    };
    for (const extra of [
      { approved: true },
      { userId: 'forged' },
      { password: 'forbidden' },
      { ticket: 'forbidden' },
      { systemAdmin: true },
    ])
      expect(() => accountRequestCommand({ ...c, ...extra })).toThrow();
    expect(() => accountRequestCommand({ ...c, requestedRole: 'TENANT_ADMIN' })).toThrow();
  });
  it('uses canonical request intent and separately hashed high-entropy setup tickets', () => {
    expect(onboardingDigest({ a: 1, b: 2 })).toBe(onboardingDigest({ b: 2, a: 1 }));
    expect(() => ticketParts('userId.password')).toThrow();
    const t = '01a16389-a830-7146-9c75-8b71d675e05a.' + 'A'.repeat(43);
    expect(ticketParts(t).digest).toMatch(/^[a-f0-9]{64}$/);
    expect(ticketParts(t).digest).not.toContain('A');
  });
});
