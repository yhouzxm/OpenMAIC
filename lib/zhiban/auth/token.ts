import { createHash, randomBytes } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SessionTokenParts {
  tenantId: string;
  secret: string;
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createSessionToken(tenantId: string): {
  cookieValue: string;
  tokenHash: string;
} {
  if (!UUID_PATTERN.test(tenantId)) throw new Error('tenantId must be a valid UUID');
  const secret = randomBytes(32).toString('base64url');
  return {
    cookieValue: `${tenantId}.${secret}`,
    tokenHash: hashOpaqueToken(secret),
  };
}

export function parseSessionToken(cookieValue: string): SessionTokenParts | null {
  const separator = cookieValue.indexOf('.');
  if (separator < 0) return null;
  const tenantId = cookieValue.slice(0, separator);
  const secret = cookieValue.slice(separator + 1);
  if (!UUID_PATTERN.test(tenantId) || !/^[A-Za-z0-9_-]{40,64}$/.test(secret)) return null;
  return { tenantId, secret };
}
