import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  assignRole,
  authorizationErrorResponse,
  requireRequestPermission,
} from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

const schema = z.object({ accountId: z.uuid(), roleCode: z.string().trim().min(1).max(64) });

export async function POST(request: NextRequest) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid role assignment' }, { status: 400 });
    const assignment = await assignRole(getZhibanPool(), principal, parsed.data);
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to assign role' },
      { status: 409 },
    );
  }
}
