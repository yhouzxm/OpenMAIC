import { NextRequest, NextResponse } from 'next/server';
import { completeStudentCourseActivity, getStudentCourseStructure } from '@/lib/zhiban/curriculum';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    if (principal.accountType !== 'student')
      return NextResponse.json({ error: 'Student account required' }, { status: 403 });
    const { courseId } = await context.params;
    return NextResponse.json({
      structure: await getStudentCourseStructure(getZhibanPool(), principal, courseId),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load course structure' },
        { status: 400 },
      )
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    if (principal.accountType !== 'student')
      return NextResponse.json({ error: 'Student account required' }, { status: 403 });
    const body = (await request.json().catch(() => null)) as { activityId?: string } | null;
    if (!body?.activityId || !/^[0-9a-f-]{36}$/i.test(body.activityId))
      return NextResponse.json({ error: 'Invalid activity' }, { status: 400 });
    const { courseId } = await context.params;
    return NextResponse.json(
      await completeStudentCourseActivity(getZhibanPool(), principal, courseId, body.activityId),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to complete activity' },
        { status: 409 },
      )
    );
  }
}
