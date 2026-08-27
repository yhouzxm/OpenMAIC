import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import {
  dispatchClassroomScene,
  endClassroomSceneSession,
  getClassroomSceneAnalytics,
  getManagedClassroomSceneSession,
  listDispatchableScenes,
} from '@/lib/zhiban/classroom';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['dispatch', 'remediate', 'challenge']), sceneId: z.string().min(1), prepared: z.boolean().optional() }),
  z.object({ action: z.literal('virtual_lab'), prepared: z.boolean().optional() }),
  z.object({ action: z.literal('end') }),
]);

type Context = { params: Promise<{ courseId: string; bindingId: string }> };

async function responseFor(principal: Awaited<ReturnType<typeof requireRequestPrincipal>>, courseId: string, bindingId: string) {
  const pool = getZhibanPool();
  const session = await getManagedClassroomSceneSession(pool, principal, courseId, bindingId);
  const analytics = session
    ? await getClassroomSceneAnalytics(pool, principal, courseId, bindingId, session.id)
    : null;
  return { session, analytics, scenes: listDispatchableScenes() };
}

export async function GET(_: Request, context: Context) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId, bindingId } = await context.params;
    return NextResponse.json(await responseFor(principal, courseId, bindingId));
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : '课堂任务加载失败' }, { status: 400 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '无效的课堂调度请求' }, { status: 400 });
    const principal = await requireRequestPrincipal();
    const { courseId, bindingId } = await context.params;
    const pool = getZhibanPool();
    if (parsed.data.action === 'end')
      await endClassroomSceneSession(pool, principal, courseId, bindingId);
    else if (parsed.data.action === 'virtual_lab')
      await dispatchClassroomScene(pool, principal, courseId, bindingId, {
        dispatchType: 'VIRTUAL_LAB',
        status: parsed.data.prepared ? 'PREPARED' : 'ACTIVE',
      });
    else
      await dispatchClassroomScene(pool, principal, courseId, bindingId, {
        dispatchType: 'SCENE',
        sceneId: parsed.data.sceneId,
        status: parsed.data.prepared ? 'PREPARED' : 'ACTIVE',
        remediation: parsed.data.action === 'remediate',
      });
    return NextResponse.json(await responseFor(principal, courseId, bindingId));
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : '课堂调度保存失败' }, { status: 400 });
  }
}
