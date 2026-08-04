import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  isLocalAuthEnabled,
  sessionCookieOptions,
  ZHIBAN_SESSION_COOKIE,
} from '@/lib/zhiban/auth/http';
import { revokeLocalSession } from '@/lib/zhiban/auth/service';
import { getZhibanPool } from '@/lib/zhiban/db/connection';

export const runtime = 'nodejs';

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ZHIBAN_SESSION_COOKIE)?.value;
  if (token && isLocalAuthEnabled()) await revokeLocalSession(getZhibanPool(), token);
  cookieStore.set(ZHIBAN_SESSION_COOKIE, '', {
    ...sessionCookieOptions(new Date(0)),
    maxAge: 0,
  });
  return NextResponse.json({ success: true });
}
