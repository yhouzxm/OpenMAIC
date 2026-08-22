import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  getTeacherCoursework,
  reviewActivityAssignment,
  saveActivityAssignment,
} from '@/lib/zhiban/coursework';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

async function auth(raw: string) {
  const courseId = z.uuid().parse(raw);
  return {
    courseId,
    principal: await requireRequestScopedPermission('course:manage', { courseIds: [courseId] }),
  };
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId, principal } = await auth((await params).courseId);
    return NextResponse.json(await getTeacherCoursework(getZhibanPool(), principal, courseId));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load coursework' },
        { status: 400 },
      )
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId, principal } = await auth((await params).courseId),
      data = await request.json();
    if (data.action === 'save_assignment') {
      const input = z
        .object({
          activityId: z.uuid(),
          title: z.string().trim().min(1).max(240),
          instructions: z.string().max(20000),
          submissionType: z.enum(['text', 'file', 'mixed']),
          maxFiles: z.number().int().min(0).max(20),
          maxFileSize: z.number().int().min(1).max(52428800),
          maxAttempts: z.number().int().min(1).max(100),
          opensAt: z.iso.datetime().nullable(),
          dueAt: z.iso.datetime().nullable(),
          allowLate: z.boolean(),
          status: z.enum(['draft', 'published', 'closed', 'archived']),
          gradeItemId: z.uuid().nullable(),
        })
        .parse(data);
      return NextResponse.json(
        await saveActivityAssignment(getZhibanPool(), principal, courseId, input),
      );
    }
    const input = z
      .object({
        submissionId: z.uuid(),
        action: z.enum(['return', 'grade']),
        feedback: z.string().max(10000),
        score: z.number().min(0).max(100).nullable(),
      })
      .parse(data);
    return NextResponse.json(
      await reviewActivityAssignment(getZhibanPool(), principal, courseId, input),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to update coursework' },
        { status: 400 },
      )
    );
  }
}
