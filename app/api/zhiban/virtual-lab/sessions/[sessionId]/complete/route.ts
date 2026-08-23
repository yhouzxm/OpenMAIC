import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { completeVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence';
import type { TrainingContext } from '@/lib/zhiban/virtual-lab/ai/types';

export const runtime = 'nodejs';
const CompleteSchema = z.object({ durationSeconds: z.number().int().nonnegative().max(24 * 60 * 60), trainingContext: z.custom<TrainingContext>((value) => Boolean(value && typeof value === 'object' && (value as Partial<TrainingContext>).course && (value as Partial<TrainingContext>).behavior && (value as Partial<TrainingContext>).evidence)) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const [{ sessionId }, body, principal] = await Promise.all([params, CompleteSchema.parseAsync(await request.json()), requireRequestPrincipal()]);
    const result = await completeVirtualLabSession(getZhibanPool(), principal, sessionId, body.trainingContext, body.durationSeconds);
    return NextResponse.json(result);
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: '学习结果暂未同步，但本次评价可正常查看。' }, { status: 503 });
  }
}
