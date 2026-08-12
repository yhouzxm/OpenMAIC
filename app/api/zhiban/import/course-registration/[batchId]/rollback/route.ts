import { NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { rollbackCourseRegistrationImport } from '@/lib/zhiban/ouc-import';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function POST(_: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    const p = await requireRequestPermission('account:manage');
    return NextResponse.json(
      await rollbackCourseRegistrationImport(getZhibanPool(), p, (await context.params).batchId),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '回滚失败' },
        { status: 409 },
      )
    );
  }
}
