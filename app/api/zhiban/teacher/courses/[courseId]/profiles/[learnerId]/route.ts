import { NextRequest, NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { getLearnerProfileDetail } from '@/lib/zhiban/profile';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ courseId: string; learnerId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId, learnerId } = await context.params;
    return NextResponse.json(
      await getLearnerProfileDetail(getZhibanPool(), principal, learnerId, courseId),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load learner profile' },
        { status: 400 },
      )
    );
  }
}
