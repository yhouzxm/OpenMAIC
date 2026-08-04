import { describe, expect, it } from 'vitest';

import { createSessionToken, hashOpaqueToken, parseSessionToken } from '@/lib/zhiban/auth/token';

describe('local session tokens', () => {
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('returns an opaque cookie while persisting only a SHA-256 hash', () => {
    const token = createSessionToken(tenantId);
    const parsed = parseSessionToken(token.cookieValue);
    expect(parsed?.tenantId).toBe(tenantId);
    expect(token.cookieValue).not.toContain(token.tokenHash);
    expect(token.tokenHash).toBe(hashOpaqueToken(parsed!.secret));
    expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects malformed tenant and secret values', () => {
    expect(parseSessionToken('not-a-token')).toBeNull();
    expect(parseSessionToken(`invalid.${'a'.repeat(43)}`)).toBeNull();
    expect(parseSessionToken(`${tenantId}.short`)).toBeNull();
  });
});
