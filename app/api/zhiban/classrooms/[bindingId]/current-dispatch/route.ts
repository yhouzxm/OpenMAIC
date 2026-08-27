import { NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { getStudentCurrentClassroomDispatch } from '@/lib/zhiban/classroom';

export async function GET(_: Request, { params }: { params: Promise<{ bindingId: string }> }) {
  try {
    const principal = await requireRequestPrincipal();
    const { bindingId } = await params;
    return NextResponse.json({
      session: await getStudentCurrentClassroomDispatch(getZhibanPool(), principal, bindingId),
    });
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: '课堂任务暂时无法同步' }, { status: 400 });
  }
}
