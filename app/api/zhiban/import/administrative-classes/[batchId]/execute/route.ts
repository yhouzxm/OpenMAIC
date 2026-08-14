import { NextRequest, NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { executeAdministrativeClassImport } from '@/lib/zhiban/ouc-import';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const principal = await requireRequestPermission('account:manage'),
      { batchId } = await params;
    return NextResponse.json(
      await executeAdministrativeClassImport(getZhibanPool(), principal, batchId),
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
