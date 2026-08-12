import { NextRequest, NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { exportDirectoryStudents } from '@/lib/zhiban/admin-data';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function GET(r: NextRequest) {
  try {
    const p = await requireRequestPermission('account:read'),
      q = r.nextUrl.searchParams,
      b = await exportDirectoryStudents(getZhibanPool(), p, {
        keyword: q.get('keyword') || '',
        status: q.get('status') || '',
        organization: q.get('organization') || '',
        admissionTerm: q.get('admissionTerm') || '',
      });
    return new NextResponse(new Uint8Array(b), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('学生信息.xlsx')}`,
      },
    });
  } catch (e) {
    return (
      authorizationErrorResponse(e) ?? NextResponse.json({ error: '导出失败' }, { status: 400 })
    );
  }
}
