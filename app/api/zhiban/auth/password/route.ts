import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { isLocalAuthEnabled, ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { changeLocalPassword } from '@/lib/zhiban/auth/service';
import { getZhibanPool } from '@/lib/zhiban/db/connection';

export const runtime = 'nodejs';

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
});

export async function POST(request: NextRequest) {
  if (!isLocalAuthEnabled()) {
    return NextResponse.json({ error: 'Local authentication is disabled' }, { status: 503 });
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const parsed = passwordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid password change request' }, { status: 400 });
  }
  try {
    const changed = await changeLocalPassword(
      getZhibanPool(),
      token,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    if (!changed)
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Password change failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
