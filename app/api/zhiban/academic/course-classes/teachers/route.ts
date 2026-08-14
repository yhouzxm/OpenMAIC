import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assignCourseClassTeacher, listCourseClassTeachers } from '@/lib/zhiban/academic';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function GET(r: NextRequest) {
  try {
    const p = await requireRequestPermission('course:manage'),
      q = r.nextUrl.searchParams,
      offeringIds = (q.get('offeringIds') || '').split(',').filter(Boolean);
    if (!offeringIds.length) return NextResponse.json({ error: '请选择课程班' }, { status: 400 });
    return NextResponse.json(
      await listCourseClassTeachers(getZhibanPool(), p, {
        offeringIds,
        employeeNo: q.get('employeeNo') || undefined,
        teacherName: q.get('teacherName') || undefined,
        sameSchool: q.get('sameSchool') !== 'false',
        page: Number(q.get('page') || 1),
      }),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '查询失败' },
        { status: 400 },
      )
    );
  }
}
export async function PUT(r: NextRequest) {
  try {
    const body = z
      .object({ offeringIds: z.array(z.uuid()).min(1), teacherId: z.uuid() })
      .safeParse(await r.json());
    if (!body.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });
    const p = await requireRequestPermission('course:manage');
    return NextResponse.json({
      result: await assignCourseClassTeacher(
        getZhibanPool(),
        p,
        body.data.offeringIds,
        body.data.teacherId,
      ),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '安排失败' },
        { status: 409 },
      )
    );
  }
}
