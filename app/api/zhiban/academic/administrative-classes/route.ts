import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { listAdministrativeClasses } from '@/lib/zhiban/academic';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const principal = await requireRequestPermission('class:manage'),
      q = request.nextUrl.searchParams;
    return NextResponse.json(
      await listAdministrativeClasses(getZhibanPool(), principal, {
        keyword: q.get('keyword') || undefined,
        admissionTerm: q.get('admissionTerm') || undefined,
        major: q.get('major') || undefined,
        organization: q.get('organization') || undefined,
        headTeacher: q.get('headTeacher') || undefined,
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
      NextResponse.json({ error: '无法查询行政班' }, { status: 500 })
    );
  }
}
