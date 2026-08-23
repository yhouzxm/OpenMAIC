import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { saveVirtualLabAction } from '@/lib/zhiban/virtual-lab/persistence';

export const runtime = 'nodejs';
const ActionSchema = z.object({ action: z.string().min(1).max(100), target: z.string().max(128).optional(), value: z.union([z.string(), z.number()]).optional(), unit: z.string().max(32).optional(), phase: z.string().max(64).optional(), timestamp: z.string().datetime().optional(), payload: z.record(z.string(), z.unknown()).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const [{ sessionId }, action, principal] = await Promise.all([params, ActionSchema.parseAsync(await request.json()), requireRequestPrincipal()]);
    await saveVirtualLabAction(getZhibanPool(), principal, sessionId, action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: '学习操作暂未同步，不影响继续实训。' }, { status: 503 });
  }
}
