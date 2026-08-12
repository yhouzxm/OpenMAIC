import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

function key(info: string) {
  const encoded = process.env.ZHIBAN_PII_KEY;
  if (!encoded) throw new Error('ZHIBAN_PII_KEY is required');
  const master = Buffer.from(encoded, 'base64');
  if (master.length !== 32) throw new Error('ZHIBAN_PII_KEY must be a base64 encoded 32-byte key');
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
}
export function sealImport(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key('zhiban-ouc-import'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { encrypted: Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64') };
}
export function openImport<T>(value: { encrypted: string }): T {
  const packed = Buffer.from(value.encrypted, 'base64');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key('zhiban-ouc-import'),
    packed.subarray(0, 12),
  );
  decipher.setAuthTag(packed.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8'),
  ) as T;
}
export function protectIdentityNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^\d{17}[0-9X]$/.test(normalized)) throw new Error('身份证号格式无效');
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key('zhiban-identity-encryption'), iv);
  const data = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  return {
    encrypted: Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), data]),
    lookupHash: createHmac('sha256', key('zhiban-identity-lookup'))
      .update(normalized)
      .digest('hex'),
    last4: normalized.slice(-4),
    birthDate: `${normalized.slice(6, 10)}-${normalized.slice(10, 12)}-${normalized.slice(12, 14)}`,
  };
}
