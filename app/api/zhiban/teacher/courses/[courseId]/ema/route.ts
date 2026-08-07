import { NextRequest, NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { listManagedCourseEma } from '@/lib/zhiban/ema';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId } = await context.params;
    return NextResponse.json({
      responses: await listManagedCourseEma(getZhibanPool(), principal, courseId),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load course EMA' },
        { status: 400 },
      )
    );
  }
}
