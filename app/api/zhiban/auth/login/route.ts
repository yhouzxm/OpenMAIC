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
import { authenticateLocal } from '@/lib/zhiban/auth/service';

export const runtime = 'nodejs';

const loginSchema = z.object({
  tenantId: z.uuid(),
  loginName: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(128),
});

export async function POST(request: NextRequest) {
  if (!isLocalAuthEnabled()) {
    return NextResponse.json({ error: 'Local authentication is disabled' }, { status: 503 });
  }
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid login request' }, { status: 400 });
  }

  const result = await authenticateLocal(getZhibanPool(), {
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
}
