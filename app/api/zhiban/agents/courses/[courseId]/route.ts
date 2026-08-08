import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getCourseAgentRuntime, listPendingInterventions, recordInterventionOutcome, respondToIntervention } from '@/lib/zhiban/agents';
import { AuthorizationError, authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export async function GET(_: NextRequest, context: { params: Promise<{ courseId: string }> }) {
  try {
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:read')) throw new AuthorizationError('Permission denied');
    const parsed = z.uuid().safeParse((await context.params).courseId);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid course' }, { status: 400 });
    const pool = getZhibanPool();
    const [runtime, interventions] = await Promise.all([
      getCourseAgentRuntime(pool, principal, parsed.data),
      listPendingInterventions(pool, principal, parsed.data),
    ]);
    return NextResponse.json({ runtime, interventions });
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load agents' }, { status: 400 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ courseId: string }> }) {
  try {
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:read')) throw new AuthorizationError('Permission denied');
    const courseId = z.uuid().safeParse((await context.params).courseId);
    const body = z.object({ briefId: z.uuid(), action: z.enum(['accept', 'dismiss', 'start', 'deliver', 'fail']), latencyMs: z.number().int().nonnegative().optional(), error: z.string().max(2000).optional() }).safeParse(await request.json().catch(() => null));
    if (!courseId.success || !body.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const result = body.data.action === 'accept' || body.data.action === 'dismiss'
      ? await respondToIntervention(getZhibanPool(), principal, body.data.briefId, courseId.data, body.data.action)
      : await recordInterventionOutcome(getZhibanPool(), principal, { briefId: body.data.briefId, courseId: courseId.data, outcome: body.data.action, latencyMs: body.data.latencyMs, error: body.data.error });
    return NextResponse.json(result);
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update intervention' }, { status: 400 });
  }
}
