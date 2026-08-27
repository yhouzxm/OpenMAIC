import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  createVirtualLabSession,
  getStudentVirtualLabHistory,
} from '@/lib/zhiban/virtual-lab/persistence';
import { getMechLabActivity } from '@/lib/zhiban/virtual-lab/registry';
import { requireMechatronicsStudentEnrollment } from '@/lib/zhiban/mechatronics-course';

export const runtime = 'nodejs';

const ContextSchema = z.object({
  courseId: z.string().min(1).max(128),
  chapterId: z.string().min(1).max(128),
  activityId: z.string().min(1).max(128),
  scenarioId: z.string().min(1).max(128),
});
function valid(context: z.infer<typeof ContextSchema>) {
  return Boolean(
    getMechLabActivity(context.courseId, context.activityId)?.scenarioId === context.scenarioId,
  );
}

export async function GET(request: NextRequest) {
  try {
    const context = ContextSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    if (!valid(context))
      return NextResponse.json({ error: 'Unknown Virtual Lab activity' }, { status: 404 });
    const principal = await requireRequestPrincipal();
    const pool = getZhibanPool();
    const course = await requireMechatronicsStudentEnrollment(pool, principal, context.courseId);
    const history = await getStudentVirtualLabHistory(pool, principal, {
      ...context,
      courseId: course.id,
    });
    return NextResponse.json(history);
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: '暂时无法读取学习记录，请稍后重试。' }, { status: 503 })
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = ContextSchema.parse(await request.json());
    if (!valid(context))
      return NextResponse.json({ error: 'Unknown Virtual Lab activity' }, { status: 404 });
    const principal = await requireRequestPrincipal();
    const pool = getZhibanPool();
    const course = await requireMechatronicsStudentEnrollment(pool, principal, context.courseId);
    const session = await createVirtualLabSession(pool, principal, {
      ...context,
      courseId: course.id,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: '暂时无法同步学习记录，不影响本次实训。' }, { status: 503 })
    );
  }
}
