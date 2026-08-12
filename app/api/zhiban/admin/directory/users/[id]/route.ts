import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { updateDirectoryUser } from '@/lib/zhiban/admin-data';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
const schema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  mobile: z
    .string()
    .regex(/^1\d{10}$/)
    .optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: z.string().min(12).max(128).optional(),
});
export async function PATCH(r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const p = await requireRequestPermission('account:manage'),
      body = schema.parse(await r.json());
    return NextResponse.json(
      await updateDirectoryUser(getZhibanPool(), p, (await params).id, body),
    );
  } catch (e) {
    return (
      authorizationErrorResponse(e) ??
      NextResponse.json({ error: e instanceof Error ? e.message : '修改失败' }, { status: 400 })
    );
  }
}
