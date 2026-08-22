import { createHmac, timingSafeEqual } from 'crypto';

/** Create an HMAC-signed token: `timestamp.signature` */
export function createAccessToken(accessCode: string): string {
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', accessCode).update(timestamp).digest('hex');
  return `${timestamp}.${signature}`;
}

/** Short-lived token issued after Zhiban RBAC authorizes an independent activity. */
export function createScopedAccessToken(accessCode: string, scope: string): string {
  const timestamp = Date.now().toString();
  const payload = `${timestamp}.${scope}`;
  const signature = createHmac('sha256', accessCode).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

/** Verify a short-lived scope token issued to an already-authorized portal user. */
export function verifyScopedAccessToken(
  token: string,
  accessCode: string,
  requiredScope: string,
  maxAgeMs = 2 * 60 * 60 * 1000,
): boolean {
  const [timestamp, scope, signature, ...extra] = token.split('.');
  if (extra.length || scope !== requiredScope || !/^\d+$/.test(timestamp ?? '')) return false;
  const issuedAt = Number(timestamp);
  if (
    !Number.isFinite(issuedAt) ||
    issuedAt > Date.now() + 60_000 ||
    Date.now() - issuedAt > maxAgeMs
  )
    return false;
  const expected = createHmac('sha256', accessCode).update(`${timestamp}.${scope}`).digest('hex');
  const actualBuffer = Buffer.from(signature ?? '', 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

/** Verify an HMAC-signed token against the access code */
export function verifyAccessToken(token: string, accessCode: string): boolean {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const expected = createHmac('sha256', accessCode).update(timestamp).digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return false;

  return timingSafeEqual(sigBuf, expBuf);
}
