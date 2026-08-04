import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { isLocalAuthEnabled, ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getAccountForSession } from '@/lib/zhiban/auth/service';
import { getZhibanPool } from '@/lib/zhiban/db/connection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!isLocalAuthEnabled()) {
    return NextResponse.json({ error: 'Local authentication is disabled' }, { status: 503 });
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const account = await getAccountForSession(getZhibanPool(), token);
  if (!account) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  return NextResponse.json({ account });
}
