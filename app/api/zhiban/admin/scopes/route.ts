import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  authorizationErrorResponse,
  createAuthorizationScope,
  listAuthorizationScopes,
  requireRequestPermission,
} from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

const schema = z.object({
  scopeType: z.enum(['project_group', 'class', 'course']),
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  externalRef: z.string().trim().max(200).optional(),
});

export async function GET() {
  try {
    const principal = await requireRequestPermission('account:read');
    return NextResponse.json({
      scopes: await listAuthorizationScopes(getZhibanPool(), principal),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to load data scopes' }, { status: 500 })
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid data scope' }, { status: 400 });
    const scope = await createAuthorizationScope(getZhibanPool(), principal, parsed.data);
    return NextResponse.json({ scope }, { status: 201 });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create data scope' },
      { status: 409 },
    );
  }
}
