import { createCipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

export interface ProtectedMobile {
  encrypted: Buffer;
  lookupHash: string;
  last4: string;
}

function normalizeMobile(mobile: string): string {
  const normalized = mobile.trim().replace(/[\s()-]/g, '');
  if (!/^\+?[0-9]{7,20}$/.test(normalized)) throw new Error('Mobile number format is invalid');
  return normalized;
}

function readMasterKey(encodedKey = process.env.ZHIBAN_PII_KEY): Buffer {
  if (!encodedKey) throw new Error('ZHIBAN_PII_KEY is required when storing mobile numbers');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new Error('ZHIBAN_PII_KEY must be a base64 encoded 32-byte key');
  return key;
}

export function protectMobile(mobile: string, encodedKey?: string): ProtectedMobile {
  const normalized = normalizeMobile(mobile);
  const masterKey = readMasterKey(encodedKey);
  const encryptionKey = Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.alloc(0), 'zhiban-mobile-encryption', 32),
  );
  const lookupKey = Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.alloc(0), 'zhiban-mobile-lookup', 32),
  );
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]),
    lookupHash: createHmac('sha256', lookupKey).update(normalized).digest('hex'),
    last4: normalized.slice(-4),
  };
}
