import { NextRequest, NextResponse } from 'next/server';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getTeacherVirtualLabStudent } from '@/lib/zhiban/virtual-lab/persistence';
import { getMechLabActivity } from '@/lib/zhiban/virtual-lab/registry';

export const runtime = 'nodejs';
export async function GET(_request: NextRequest, { params }: { params: Promise<{ courseId: string; studentId: string }> }) {
  try {
    const { courseId, studentId } = await params;
    const activity = getMechLabActivity(courseId, 'mech-lab-line-stop');
    if (!activity) return NextResponse.json({ error: 'Unknown Virtual Lab activity' }, { status: 404 });
    const principal = await requireRequestPrincipal();
    const sessions = await getTeacherVirtualLabStudent(getZhibanPool(), principal, activity, studentId);
    return NextResponse.json({ sessions });
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: '暂时无法读取该学生的实训记录，请稍后重试。' }, { status: 503 });
  }
}
