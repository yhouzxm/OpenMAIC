import { describe, expect, it } from 'vitest';
import { instant, tenantScope } from '@/lib/zhiban/domain/identity';
import { AFTER, BEFORE, NOW, expectError, grant } from './fixtures';

describe('RoleGrant', () => {
  it('uses inclusive validFrom and exclusive validUntil', () => {
    const item = grant(10, { validFrom: NOW, validUntil: AFTER });
    expect(item.isNotYetEffective(BEFORE)).toBe(true);
    expect(item.isEffectiveAt(BEFORE)).toBe(false);
    expect(item.isEffectiveAt(NOW)).toBe(true);
    expect(item.isExpired(instant(AFTER - 1))).toBe(false);
    expect(item.isEffectiveAt(instant(AFTER - 1))).toBe(true);
    expect(item.isExpired(AFTER)).toBe(true);
    expect(item.isEffectiveAt(AFTER)).toBe(false);
  });
  it('supports an open-ended validity window', () => {
    expect(grant(10).isEffectiveAt(AFTER)).toBe(true);
  });
  it('revokes irreversibly and preserves the first timestamp on retry', () => {
    const original = grant(10);
    const revoked = original.revoke(NOW);
    expect(original.isRevoked).toBe(false);
    expect(revoked.isRevoked).toBe(true);
    expect(revoked.isEffectiveAt(NOW)).toBe(false);
    expect(revoked.revoke(AFTER)).toBe(revoked);
    expect(revoked.revokedAt).toBe(NOW);
    expect('unrevoke' in revoked).toBe(false);
    expect(Reflect.set(revoked, 'revokedAt', null)).toBe(false);
  });
  it.each([BEFORE, NOW])('rejects invalid validity end %s', (end) => {
    expectError(() => grant(10, { validFrom: NOW, validUntil: end }), 'INVALID_VALIDITY_WINDOW');
  });
  it('rejects time before creation and freezes scope', () => {
    expectError(() => grant(10, { createdAt: NOW, validFrom: BEFORE }), 'INVALID_TIME');
    const item = grant(10, { scope: tenantScope() });
    expect(Object.isFrozen(item.scope)).toBe(true);
    expectError(() => item.revoke(instant(BEFORE - 1)), 'INVALID_TIME');
  });
});
