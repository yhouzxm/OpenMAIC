import { NextResponse } from 'next/server';

import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { executeImport } from '@/lib/zhiban/import';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';
export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const { jobId } = await context.params;
    return NextResponse.json(await executeImport(getZhibanPool(), principal, jobId));
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '执行失败' },
      { status: 409 },
    );
  }
}
