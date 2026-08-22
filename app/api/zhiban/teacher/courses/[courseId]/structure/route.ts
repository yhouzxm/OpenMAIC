import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  createCourseActivity,
  createCourseChapter,
  createCourseModule,
  deleteCourseStructureItem,
  getTeacherCourseStructure,
  moveCourseStructureItem,
  publishCourseStructure,
  rollbackPublishedCourseStructureVersion,
  restoreCourseStructureVersion,
  updateCourseActivity,
  updateCourseStructureItem,
} from '@/lib/zhiban/curriculum';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';
import {
  createOpenMaicActivityDocument,
  deleteOpenMaicActivityDocument,
  OPENMAIC_ACTIVITY_KIND_BY_TYPE,
  type OpenMaicCourseActivityType,
} from '@/lib/zhiban/openmaic-activity';

const openMaicActivityTypes = [
  'openmaic_slide',
  'openmaic_quiz',
  'openmaic_interactive',
  'openmaic_pbl',
  'openmaic_3d',
] as const;

const baseText = z.string().trim();
const itemKind = z.enum(['module', 'chapter', 'activity']);
const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_module'),
    title: baseText.min(1).max(200),
    description: baseText.max(4000).default(''),
  }),
  z
    .object({
      action: z.literal('update_activity'),
      id: z.uuid(),
      chapterId: z.uuid(),
      title: baseText.min(1).max(240),
      description: baseText.max(10000).default(''),
      activityType: z.enum([
        'content',
        'resource',
        'classroom',
        'pbl',
        'assignment',
        'quiz',
        'discussion',
        'ema',
        'practice',
        'summary',
        'ai_support',
        ...openMaicActivityTypes,
      ]),
      referenceId: baseText.max(200).nullable(),
      estimatedMinutes: z.number().int().min(0).max(100000),
      required: z.boolean(),
      opensAt: z.iso.datetime().nullable(),
      closesAt: z.iso.datetime().nullable(),
      openingRule: z.object({ type: z.enum(['always', 'date', 'prerequisite']) }).passthrough(),
      completionRule: z
        .object({ type: z.enum(['manual', 'view', 'reference_completed']) })
        .passthrough(),
      prerequisiteActivityIds: z.array(z.uuid()).max(100),
    })
    .refine((value) => !value.opensAt || !value.closesAt || value.opensAt <= value.closesAt, {
      message: '截止时间不能早于开放时间',
    }),
  z.object({
    action: z.literal('create_chapter'),
    moduleId: z.uuid(),
    title: baseText.min(1).max(200),
    description: baseText.max(4000).default(''),
    estimatedMinutes: z.number().int().min(0).max(100000).default(0),
  }),
  z
    .object({
      action: z.literal('create_activity'),
      chapterId: z.uuid(),
      title: baseText.min(1).max(240),
      description: baseText.max(10000).default(''),
      activityType: z.enum([
        'content',
        'resource',
        'classroom',
        'pbl',
        'assignment',
        'quiz',
        'discussion',
        'ema',
        'practice',
        'summary',
        'ai_support',
        ...openMaicActivityTypes,
      ]),
      referenceId: baseText.max(200).nullable().default(null),
      estimatedMinutes: z.number().int().min(0).max(100000).default(0),
      required: z.boolean().default(true),
      opensAt: z.iso.datetime().nullable().default(null),
      closesAt: z.iso.datetime().nullable().default(null),
    })
    .refine((value) => !value.opensAt || !value.closesAt || value.opensAt <= value.closesAt, {
      message: '截止时间不能早于开放时间',
    }),
  z.object({ action: z.literal('delete'), kind: itemKind, id: z.uuid() }),
  z.object({
    action: z.literal('update'),
    kind: itemKind,
    id: z.uuid(),
    title: baseText.min(1).max(240),
    description: baseText.max(10000).default(''),
  }),
  z.object({
    action: z.literal('move'),
    kind: itemKind,
    id: z.uuid(),
    direction: z.enum(['up', 'down']),
  }),
  z.object({ action: z.literal('publish'), changeNote: baseText.max(1000).default('') }),
  z.object({ action: z.literal('restore'), versionId: z.uuid() }),
  z.object({ action: z.literal('rollback_version'), versionId: z.uuid() }),
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
    return NextResponse.json(await getTeacherCourseStructure(getZhibanPool(), principal, courseId));
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
    const { courseId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '课程结构参数无效' },
        { status: 400 },
      );
    const principal = await requireRequestScopedPermission('course:manage', {
      courseIds: [courseId],
    });
    const pool = getZhibanPool();
    const input = parsed.data;
    if (input.action === 'create_module')
      return NextResponse.json(await createCourseModule(pool, principal, courseId, input));
    if (input.action === 'create_chapter')
      return NextResponse.json(await createCourseChapter(pool, principal, courseId, input));
    if (input.action === 'create_activity') {
      const activity = await createCourseActivity(pool, principal, courseId, input);
      if ((openMaicActivityTypes as readonly string[]).includes(input.activityType)) {
        try {
          await createOpenMaicActivityDocument(
            pool,
            principal,
            courseId,
            activity.id,
            OPENMAIC_ACTIVITY_KIND_BY_TYPE[input.activityType as OpenMaicCourseActivityType],
          );
        } catch (error) {
          await deleteCourseStructureItem(pool, principal, courseId, {
            kind: 'activity',
            id: activity.id,
          });
          throw error;
        }
      }
      return NextResponse.json(activity);
    }
    if (input.action === 'delete')
      return NextResponse.json(await deleteCourseStructureItem(pool, principal, courseId, input));
    if (input.action === 'update')
      return NextResponse.json(await updateCourseStructureItem(pool, principal, courseId, input));
    if (input.action === 'update_activity') {
      const result = await updateCourseActivity(pool, principal, courseId, input);
      if ((openMaicActivityTypes as readonly string[]).includes(input.activityType))
        await createOpenMaicActivityDocument(
          pool,
          principal,
          courseId,
          input.id,
          OPENMAIC_ACTIVITY_KIND_BY_TYPE[input.activityType as OpenMaicCourseActivityType],
        );
      else await deleteOpenMaicActivityDocument(pool, principal, courseId, input.id);
      return NextResponse.json(result);
    }
    if (input.action === 'move')
      return NextResponse.json(await moveCourseStructureItem(pool, principal, courseId, input));
    if (input.action === 'restore')
      return NextResponse.json(
        await restoreCourseStructureVersion(pool, principal, courseId, input.versionId),
      );
    if (input.action === 'rollback_version')
      return NextResponse.json(
        await rollbackPublishedCourseStructureVersion(pool, principal, courseId, input.versionId),
      );
    return NextResponse.json(
      await publishCourseStructure(pool, principal, courseId, input.changeNote),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to update course structure' },
        { status: 409 },
      )
    );
  }
}
