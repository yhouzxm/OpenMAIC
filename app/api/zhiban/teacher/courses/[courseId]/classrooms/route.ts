import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import {
  createCourseClassroom,
  getManagedClassroomEvents,
  getManagedClassroomProgress,
  listManagedCourseClassrooms,
} from '@/lib/zhiban/classroom';
import { readClassroom } from '@/lib/server/classroom-storage';

const inputSchema = z
  .object({
    classroomId: z.string().min(1).max(160),
    title: z.string().min(1).max(300),
    description: z.string().max(3000),
    displayOrder: z.number().int().min(0).max(10000),
    opensAt: z.iso.datetime().nullable(),
    closesAt: z.iso.datetime().nullable(),
    status: z.enum(['draft', 'published']),
  })
  .refine((value) => !value.opensAt || !value.closesAt || value.opensAt < value.closesAt, {
    message: 'End time must be later than start time',
  });
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId } = await context.params;
    const [classrooms, progress, events] = await Promise.all([
      listManagedCourseClassrooms(getZhibanPool(), principal, courseId),
      getManagedClassroomProgress(getZhibanPool(), principal, courseId),
      getManagedClassroomEvents(getZhibanPool(), principal, courseId),
    ]);
    return NextResponse.json({ classrooms, progress, events });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load classroom bindings' },
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
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid classroom' },
        { status: 400 },
      );
    const principal = await requireRequestPrincipal();
    if (parsed.data.status === 'published' && !(await readClassroom(parsed.data.classroomId)))
      return NextResponse.json(
        { error: '课堂尚未保存到 OpenMAIC 服务端，不能发布' },
        { status: 400 },
      );
    const { courseId } = await context.params;
    return NextResponse.json(
      await createCourseClassroom(getZhibanPool(), principal, courseId, parsed.data),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to bind classroom' },
        { status: 400 },
      )
    );
  }
}
