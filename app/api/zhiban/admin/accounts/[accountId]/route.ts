import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  authorizationErrorResponse,
  requireRequestPermission,
  updateManagedAccountStatus,
} from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

const schema = z.object({ status: z.enum(['active', 'disabled']) });

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid account status' }, { status: 400 });
    const { accountId } = await context.params;
    const updated = await updateManagedAccountStatus(
      getZhibanPool(),
      principal,
      accountId,
      parsed.data.status,
    );
    if (!updated) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update account' },
      { status: 409 },
    );
  }
}
