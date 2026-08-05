import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';
import { updateTeacherCourse } from '@/lib/zhiban/teacher-courses';

export const runtime = 'nodejs';

const trimmed = (max: number) => z.string().trim().max(max);
const schema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(4000),
    credits: z.number().nonnegative().max(99).nullable(),
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    deliveryMode: z.enum(['online', 'blended', 'face_to_face']),
    learningObjectives: z.array(z.string().trim().min(1).max(500)).max(30),
    teachingNotes: z.string().max(10000),
    pblEnabled: z.boolean(),
    pblProjects: z.array(z.object({ name: trimmed(200).min(1), description: trimmed(2000), deliverable: trimmed(500) })).max(30),
    sceneRules: z.array(z.object({
      sceneId: trimmed(128).min(1), name: trimmed(200).min(1),
      condition: z.enum(['always', 'date', 'previous_completed', 'score']), value: trimmed(500),
    })).max(100),
    courseResources: z.array(z.object({
      title: trimmed(200).min(1), type: z.enum(['document', 'video', 'link', 'dataset', 'other']),
      url: trimmed(2000),
    })).max(200),
    agentSettings: z.object({
      tutorEnabled: z.boolean(), peerEnabled: z.boolean(), monitorEnabled: z.boolean(), strategyEnabled: z.boolean(),
    }),
    promptStrategy: z.object({ version: trimmed(64).min(1), policy: trimmed(20000) }),
    gradingPolicy: z.object({
      formativeWeight: z.number().min(0).max(100), projectWeight: z.number().min(0).max(100), finalWeight: z.number().min(0).max(100),
    }),
    assignmentPolicy: z.object({ assignmentCount: z.number().int().min(0).max(200), maxAttempts: z.number().int().min(1).max(100) }),
    warningPolicy: z.object({
      scoreThreshold: z.number().min(0).max(100), inactivityDays: z.number().int().min(1).max(365), missedAssignments: z.number().int().min(0).max(200),
    }),
    interventionPolicy: z.object({
      strategy: z.enum(['notify_student', 'notify_teacher', 'agent_coaching', 'manual_follow_up']), message: trimmed(4000),
    }),
    publicationStatus: z.enum(['draft', 'published']),
    expectedVersion: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (value.startsAt && value.endsAt && value.endsAt < value.startsAt)
      context.addIssue({ code: 'custom', path: ['endsAt'], message: '课程结束时间不能早于开始时间' });
    const total = value.gradingPolicy.formativeWeight + value.gradingPolicy.projectWeight + value.gradingPolicy.finalWeight;
    if (Math.abs(total - 100) > 0.001)
      context.addIssue({ code: 'custom', path: ['gradingPolicy'], message: '成绩权重合计必须为100' });
  });

export async function PATCH(request: NextRequest, context: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '课程设置无效' }, { status: 400 });
    const principal = await requireRequestScopedPermission('course:manage', { courseIds: [courseId] });
    return NextResponse.json(await updateTeacherCourse(getZhibanPool(), principal, courseId, parsed.data));
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update course' }, { status: 409 });
  }
}
