import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  isLocalAuthEnabled,
  requestFingerprints,
  sessionCookieOptions,
  ZHIBAN_SESSION_COOKIE,
} from '@/lib/zhiban/auth/http';
import { authenticateLocalByIdentifier } from '@/lib/zhiban/auth/service';

export const runtime = 'nodejs';

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(128),
});

export async function POST(request: NextRequest) {
  try {
    if (!isLocalAuthEnabled()) {
      return NextResponse.json({ error: 'Local authentication is disabled' }, { status: 503 });
    }
    const parsed = loginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid login request' }, { status: 400 });
    }

    const result = await authenticateLocalByIdentifier(getZhibanPool(), {
      ...parsed.data,
      ...requestFingerprints(request),
    });
    if (!result.ok) {
      return NextResponse.json({ error: 'Invalid login name or password' }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set(
      ZHIBAN_SESSION_COOKIE,
      result.sessionCookie,
      sessionCookieOptions(result.expiresAt),
    );
    return NextResponse.json({ account: result.account });
  } catch (error) {
    console.error('[ZhibanAuth] Login failed', error);
    return NextResponse.json({ error: '登录服务暂时不可用，请稍后重试' }, { status: 500 });
  }
}
