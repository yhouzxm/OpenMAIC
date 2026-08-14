import { NextRequest, NextResponse } from 'next/server';
import { exportAdministrativeClasses } from '@/lib/zhiban/academic';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const p = await requireRequestPermission('class:read'),
      q = request.nextUrl.searchParams,
      b = await exportAdministrativeClasses(getZhibanPool(), p, {
        keyword: q.get('keyword') || undefined,
        admissionTerm: q.get('admissionTerm') || undefined,
        major: q.get('major') || undefined,
        organization: q.get('organization') || undefined,
        headTeacher: q.get('headTeacher') || undefined,
      });
    return new NextResponse(new Uint8Array(b), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('行政班级.xlsx')}`,
      },
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ?? NextResponse.json({ error: '导出失败' }, { status: 400 })
    );
  }
}
