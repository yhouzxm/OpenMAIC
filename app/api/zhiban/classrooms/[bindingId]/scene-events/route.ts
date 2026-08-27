import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { recordClassroomSceneLearningEvent } from '@/lib/zhiban/classroom';

const schema = z.object({
  sceneId: z.string().min(1),
  classroomSceneSessionId: z.string().uuid(),
  eventType: z.enum(['ENTER_SCENE', 'INTERACTING', 'COMPLETE_SCENE', 'REMEDIATION_SCENE_ENTERED']),
  isCorrect: z.boolean().nullable().optional(),
  firstChoice: z.string().max(200).nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  conceptErrors: z.array(z.string()).max(30).default([]),
  attempt: z.number().int().positive().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.iso.datetime(),
});

export async function POST(request: Request, { params }: { params: Promise<{ bindingId: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '无效的课堂学习事件' }, { status: 400 });
    const principal = await requireRequestPrincipal();
    const { bindingId } = await params;
    return NextResponse.json(await recordClassroomSceneLearningEvent(getZhibanPool(), principal, bindingId, parsed.data));
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: '学习记录暂未同步，不影响当前任务' }, { status: 400 });
  }
}
