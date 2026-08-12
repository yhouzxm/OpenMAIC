import { createHmac, hkdfSync } from 'node:crypto';

export type LoginIdentifierType =
  | 'mobile'
  | 'student_no'
  | 'employee_no'
  | 'admin_account'
  | 'login_name';

function lookupKey() {
  const encoded = process.env.ZHIBAN_PII_KEY;
  if (!encoded) throw new Error('ZHIBAN_PII_KEY is required for login identifiers');
  const master = Buffer.from(encoded, 'base64');
  if (master.length !== 32) throw new Error('ZHIBAN_PII_KEY must be a base64 encoded 32-byte key');
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'zhiban-login-identifier', 32));
}

export function normalizeLoginIdentifier(value: string) {
  const trimmed = value.trim();
  if (/^1\d{10}$/.test(trimmed.replace(/[\s()-]/g, ''))) return trimmed.replace(/[\s()-]/g, '');
  return trimmed.toLocaleLowerCase('en-US');
}

export function hashLoginIdentifier(value: string) {
  return createHmac('sha256', lookupKey()).update(normalizeLoginIdentifier(value)).digest('hex');
}

export function maskLoginIdentifier(type: LoginIdentifierType, value: string) {
  const normalized = normalizeLoginIdentifier(value);
  if (type === 'mobile') return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
  if (normalized.length <= 5) return normalized;
  return `${normalized.slice(0, 3)}***${normalized.slice(-3)}`;
}
