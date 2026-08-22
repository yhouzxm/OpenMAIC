import { NextRequest, NextResponse } from 'next/server';
import {
  createStudentDiscussionPost,
  getStudentCourseContent,
  reportDiscussionPost,
  recordStudentContentCompletion,
} from '@/lib/zhiban/content';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal(),
      { courseId } = await context.params;
    if (principal.accountType !== 'student')
      return NextResponse.json({ error: 'Student account required' }, { status: 403 });
    return NextResponse.json(await getStudentCourseContent(getZhibanPool(), principal, courseId));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load content' },
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
    const principal = await requireRequestPrincipal(),
      { courseId } = await context.params;
    if (principal.accountType !== 'student')
      return NextResponse.json({ error: 'Student account required' }, { status: 403 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (body?.action === 'post') {
      const content = String(body.content ?? '').trim();
      if (!content || content.length > 10000)
        return NextResponse.json({ error: '讨论内容长度无效' }, { status: 400 });
      return NextResponse.json(
        await createStudentDiscussionPost(getZhibanPool(), principal, courseId, {
          topicId: String(body.topicId),
          parentPostId: body.parentPostId ? String(body.parentPostId) : null,
          content,
        }),
      );
    }
    if (body?.action === 'report')
      return NextResponse.json(
        await reportDiscussionPost(getZhibanPool(), principal, courseId, {
          postId: String(body.postId),
          reason: String(body.reason ?? '').slice(0, 2000),
        }),
      );
    if (body?.action === 'complete_content')
      return NextResponse.json(
        await recordStudentContentCompletion(
          getZhibanPool(),
          principal,
          courseId,
          String(body.activityId),
        ),
      );
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to update discussion' },
        { status: 409 },
      )
    );
  }
}
