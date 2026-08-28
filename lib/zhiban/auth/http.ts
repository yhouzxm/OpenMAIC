import { createHash } from 'node:crypto';

import type { NextRequest } from 'next/server';

export const ZHIBAN_SESSION_COOKIE = 'zhiban_session';

export function isLocalAuthEnabled(): boolean {
  return ['true', '1'].includes(process.env.ZHIBAN_AUTH_ENABLED ?? '');
}

export function shouldUseSecureSessionCookie(request?: NextRequest): boolean {
  const configured = process.env.ZHIBAN_SECURE_COOKIES?.trim().toLowerCase();
  if (['true', '1'].includes(configured ?? '')) return true;
  if (['false', '0'].includes(configured ?? '')) return false;

  if (request?.nextUrl.protocol === 'https:') return true;
  const forwardedProtocol = request?.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProtocol) return forwardedProtocol === 'https';

  // A production build can still be run locally over plain HTTP for validation.
  // In deployed environments the reverse proxy should forward the public protocol.
  if (request) return false;
  return process.env.NODE_ENV === 'production';
}

export function sessionCookieOptions(expires?: Date, request?: NextRequest) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: shouldUseSecureSessionCookie(request),
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

function digest(value: string | null): string | undefined {
  return value ? createHash('sha256').update(value).digest('hex') : undefined;
}

export function requestFingerprints(request: NextRequest): {
  ipHash?: string;
  userAgentHash?: string;
} {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  return {
    ipHash: digest(forwarded),
    userAgentHash: digest(request.headers.get('user-agent')),
  };
}
