import { NextResponse } from 'next/server';

import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  authorizationErrorResponse,
  listAssignableRoles,
  requireRequestPermission,
} from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const principal = await requireRequestPermission('account:read');
    return NextResponse.json({ roles: await listAssignableRoles(getZhibanPool(), principal) });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to load roles' }, { status: 500 })
    );
  }
}
