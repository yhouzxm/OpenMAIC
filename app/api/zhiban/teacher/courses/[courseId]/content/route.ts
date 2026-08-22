import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createDiscussionTopic,
  createTeacherDiscussionPost,
  createLinkResource,
  getTeacherCourseContent,
  moderateDiscussionPost,
  restoreResourceVersion,
  scoreDiscussionParticipant,
  saveActivityContent,
  updateDiscussionTopic,
  updateResource,
} from '@/lib/zhiban/content';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';

const text = z.string().trim();
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save_content'),
    activityId: z.uuid(),
    format: z.enum(['plain_text', 'markdown', 'html']),
    body: z.string().max(200_000),
    status: z.enum(['draft', 'published']),
  }),
  z.object({
    action: z.literal('create_link_resource'),
    title: text.min(1).max(240),
    description: z.string().max(4000),
    url: z.url(),
    resourceType: z.enum(['video', 'audio', 'image', 'link', 'dataset', 'other']),
    activityIds: z.array(z.uuid()).max(100),
    downloadAllowed: z.boolean(),
    aiIndexEnabled: z.boolean(),
  }),
  z.object({
    action: z.literal('update_resource'),
    id: z.uuid(),
    title: text.min(1).max(240),
    description: z.string().max(4000),
    status: z.enum(['draft', 'published', 'archived']),
    activityIds: z.array(z.uuid()).max(100),
    downloadAllowed: z.boolean(),
    aiIndexEnabled: z.boolean(),
  }),
  z.object({
    action: z.literal('create_topic'),
    activityId: z.uuid().nullable(),
    title: text.min(1).max(240),
    description: z.string().max(10000),
    status: z.enum(['draft', 'open', 'closed', 'archived']),
    pinned: z.boolean(),
    graded: z.boolean(),
    gradeItemId: z.uuid().nullable().optional(),
  }),
  z.object({
    action: z.literal('update_topic'),
    id: z.uuid(),
    title: text.min(1).max(240),
    description: z.string().max(10000),
    status: z.enum(['draft', 'open', 'closed', 'archived']),
    pinned: z.boolean(),
    graded: z.boolean(),
    gradeItemId: z.uuid().nullable().optional(),
  }),
  z.object({
    action: z.literal('moderate_post'),
    postId: z.uuid(),
    moderationAction: z.enum(['hide', 'restore', 'delete']),
    reason: z.string().max(2000),
  }),
  z.object({ action: z.literal('restore_resource'), resourceId: z.uuid(), versionId: z.uuid() }),
  z.object({
    action: z.literal('teacher_post'),
    topicId: z.uuid(),
    parentPostId: z.uuid().nullable(),
    content: z.string().trim().min(1).max(10000),
  }),
  z.object({
    action: z.literal('score_discussion'),
    topicId: z.uuid(),
    studentId: z.uuid(),
    score: z.number().min(0).max(100),
    feedback: z.string().max(5000),
  }),
]);

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await context.params;
    const principal = await requireRequestScopedPermission('course:manage', {
      courseIds: [courseId],
    });
    return NextResponse.json(await getTeacherCourseContent(getZhibanPool(), principal, courseId));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load course content' },
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
    const { courseId } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '参数无效' },
        { status: 400 },
      );
    const principal = await requireRequestScopedPermission('course:manage', {
      courseIds: [courseId],
    });
    const pool = getZhibanPool(),
      input = parsed.data;
    if (input.action === 'save_content')
      return NextResponse.json(await saveActivityContent(pool, principal, courseId, input));
    if (input.action === 'create_link_resource')
      return NextResponse.json(await createLinkResource(pool, principal, courseId, input));
    if (input.action === 'update_resource')
      return NextResponse.json(await updateResource(pool, principal, courseId, input));
    if (input.action === 'create_topic')
      return NextResponse.json(await createDiscussionTopic(pool, principal, courseId, input));
    if (input.action === 'update_topic')
      return NextResponse.json(await updateDiscussionTopic(pool, principal, courseId, input));
    if (input.action === 'restore_resource')
      return NextResponse.json(
        await restoreResourceVersion(pool, principal, courseId, input.resourceId, input.versionId),
      );
    if (input.action === 'teacher_post')
      return NextResponse.json(await createTeacherDiscussionPost(pool, principal, courseId, input));
    if (input.action === 'score_discussion')
      return NextResponse.json(await scoreDiscussionParticipant(pool, principal, courseId, input));
    return NextResponse.json(
      await moderateDiscussionPost(pool, principal, courseId, {
        postId: input.postId,
        action: input.moderationAction,
        reason: input.reason,
      }),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to update course content' },
        { status: 409 },
      )
    );
  }
}
