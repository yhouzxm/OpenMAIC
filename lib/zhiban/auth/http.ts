import { createHash } from 'node:crypto';

import type { NextRequest } from 'next/server';

export const ZHIBAN_SESSION_COOKIE = 'zhiban_session';

export function isLocalAuthEnabled(): boolean {
  return ['true', '1'].includes(process.env.ZHIBAN_AUTH_ENABLED ?? '');
}

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
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
