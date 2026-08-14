import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { setAdministrativeClassHeadTeacher } from '@/lib/zhiban/academic';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
const schema = z.object({ teacherId: z.uuid().nullable() });
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> },
) {
  try {
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '请选择有效教师' }, { status: 400 });
    const principal = await requireRequestPermission('class:manage'),
      { classId } = await params;
    return NextResponse.json({
      result: await setAdministrativeClassHeadTeacher(
        getZhibanPool(),
        principal,
        classId,
        input.data.teacherId,
      ),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '班主任操作失败' },
        { status: 409 },
      )
    );
  }
}
