import { NextRequest, NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { listDirectoryUsers } from '@/lib/zhiban/admin-data';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function GET(r: NextRequest) {
  try {
    const p = await requireRequestPermission('account:read'),
      q = r.nextUrl.searchParams;
    return NextResponse.json(
      await listDirectoryUsers(getZhibanPool(), p, {
        keyword: q.get('keyword') || '',
        status: q.get('status') || '',
        organization: q.get('organization') || '',
        page: Number(q.get('page') || 1),
        pageSize: Number(q.get('pageSize') || 20),
      }),
    );
  } catch (e) {
    return (
      authorizationErrorResponse(e) ??
      NextResponse.json({ error: e instanceof Error ? e.message : '查询失败' }, { status: 400 })
    );
  }
}
