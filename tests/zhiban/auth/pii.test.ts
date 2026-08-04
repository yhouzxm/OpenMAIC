import { createDecipheriv, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { protectMobile } from '@/lib/zhiban/auth/pii';

describe('mobile number protection', () => {
  const masterKey = Buffer.alloc(32, 7);
  const encodedKey = masterKey.toString('base64');

  it('encrypts the number with AES-GCM and produces stable lookup metadata', () => {
    const first = protectMobile('138 0013 8000', encodedKey);
    const second = protectMobile('13800138000', encodedKey);

    expect(first.encrypted.equals(second.encrypted)).toBe(false);
    expect(first.lookupHash).toBe(second.lookupHash);
    expect(first.last4).toBe('8000');

    const version = first.encrypted[0];
    const iv = first.encrypted.subarray(1, 13);
    const tag = first.encrypted.subarray(13, 29);
    const ciphertext = first.encrypted.subarray(29);
    const key = Buffer.from(
      hkdfSync('sha256', masterKey, Buffer.alloc(0), 'zhiban-mobile-encryption', 32),
    );
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString();
    expect(version).toBe(1);
    expect(plaintext).toBe('13800138000');
  });

  it('requires a valid mobile format and a 32-byte key', () => {
    expect(() => protectMobile('not-a-phone', encodedKey)).toThrow('format');
    expect(() => protectMobile('13800138000', Buffer.alloc(16).toString('base64'))).toThrow(
      '32-byte',
    );
  });
});
