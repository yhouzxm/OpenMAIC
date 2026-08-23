import { NextRequest, NextResponse } from 'next/server';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getTeacherVirtualLabAnalytics } from '@/lib/zhiban/virtual-lab/persistence';
import { getMechLabActivity } from '@/lib/zhiban/virtual-lab/registry';

export const runtime = 'nodejs';
export async function GET(_request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params;
    const activity = getMechLabActivity(courseId, 'mech-lab-line-stop');
    if (!activity) return NextResponse.json({ error: 'Unknown Virtual Lab activity' }, { status: 404 });
    const principal = await requireRequestPrincipal();
    const analytics = await getTeacherVirtualLabAnalytics(getZhibanPool(), principal, activity);
    return NextResponse.json(analytics);
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: '暂时无法读取虚拟实训学情，请稍后重试。' }, { status: 503 });
  }
}
