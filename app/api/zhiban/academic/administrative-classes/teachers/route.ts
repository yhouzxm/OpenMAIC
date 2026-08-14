import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listAdministrativeClassTeachers } from '@/lib/zhiban/academic';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const principal = await requireRequestPermission('class:manage'),
      q = request.nextUrl.searchParams;
    const classIds = (q.get('classIds') || '').split(',').filter(Boolean);
    if (!classIds.length || classIds.some((id) => !z.uuid().safeParse(id).success))
      return NextResponse.json({ error: '请选择有效行政班' }, { status: 400 });
    return NextResponse.json(
      await listAdministrativeClassTeachers(getZhibanPool(), principal, {
        classIds,
        employeeNo: q.get('employeeNo') || undefined,
        teacherName: q.get('teacherName') || undefined,
        sameSchool: q.get('sameSchool') !== 'false',
        page: z.coerce
          .number()
          .int()
          .positive()
          .catch(1)
          .parse(q.get('page') || 1),
      }),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '教师查询失败' },
        { status: 400 },
      )
    );
  }
}
