import { describe, expect, test, vi } from 'vitest';

import {
  createAccessToken,
  createScopedAccessToken,
  verifyAccessToken,
  verifyScopedAccessToken,
} from '@/lib/server/access-token';

describe('access token signing', () => {
  test('verifies tokens signed with the same access code', () => {
    vi.setSystemTime(new Date('2026-06-25T00:00:00Z'));

    const token = createAccessToken('demo-code');

    expect(verifyAccessToken(token, 'demo-code')).toBe(true);
    expect(verifyAccessToken(token, 'other-code')).toBe(false);
    expect(verifyAccessToken('bad-token', 'demo-code')).toBe(false);

    vi.useRealTimers();
  });
});

describe('scoped access token signing', () => {
  test('accepts only the requested scope within its lifetime', () => {
    vi.setSystemTime(new Date('2026-08-17T00:00:00Z'));
    const token = createScopedAccessToken('demo-code', 'activity-agent');
    expect(verifyScopedAccessToken(token, 'demo-code', 'activity-agent')).toBe(true);
    expect(verifyScopedAccessToken(token, 'demo-code', 'other-scope')).toBe(false);
    expect(verifyScopedAccessToken(token, 'other-code', 'activity-agent')).toBe(false);
    vi.setSystemTime(new Date('2026-08-17T02:00:00.001Z'));
    expect(verifyScopedAccessToken(token, 'demo-code', 'activity-agent')).toBe(false);
    vi.useRealTimers();
  });
});
