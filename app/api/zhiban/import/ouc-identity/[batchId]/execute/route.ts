import { NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { executeOucIdentityImport } from '@/lib/zhiban/ouc-import';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function POST(_: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    const p = await requireRequestPermission('account:manage');
    return NextResponse.json(
      await executeOucIdentityImport(getZhibanPool(), p, (await context.params).batchId),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '执行失败' },
        { status: 400 },
      )
    );
  }
}
