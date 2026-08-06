import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { updateCourseClassroom } from '@/lib/zhiban/classroom';
import { readClassroom } from '@/lib/server/classroom-storage';
const schema = z.object({
  classroomId: z.string().min(1).max(160),
  title: z.string().min(1).max(300),
  description: z.string().max(3000),
  displayOrder: z.number().int().min(0).max(10000),
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
  status: z.enum(['draft', 'published']),
});
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ bindingId: string }> },
) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
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
    const { bindingId } = await context.params;
    return NextResponse.json(
      await updateCourseClassroom(getZhibanPool(), principal, bindingId, parsed.data),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to update classroom' },
        { status: 400 },
      )
    );
  }
}
