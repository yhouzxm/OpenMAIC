import { NextRequest, NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { exportLearnerProfile } from '@/lib/zhiban/profile';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId } = await context.params;
    const data = await exportLearnerProfile(getZhibanPool(), principal, principal.id, courseId);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="zhiban-profile-${courseId}.json"`,
      },
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to export profile' },
        { status: 400 },
      )
    );
  }
}
