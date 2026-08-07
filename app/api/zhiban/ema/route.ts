import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { listOwnPendingEma, submitOwnEma } from '@/lib/zhiban/ema';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export async function GET() {
  try {
    const principal = await requireRequestPrincipal();
    return NextResponse.json({
      questionnaires: await listOwnPendingEma(getZhibanPool(), principal),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load EMA' },
        { status: 400 },
      )
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireRequestPrincipal();
    const parsed = z
      .object({
        instanceId: z.uuid(),
        answers: z.record(z.string(), z.unknown()).default({}),
        skipped: z.boolean().default(false),
        skipReason: z.string().max(1000).optional(),
      })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid EMA response' }, { status: 400 });
    return NextResponse.json(
      await submitOwnEma(getZhibanPool(), principal, parsed.data.instanceId, parsed.data),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to submit EMA' },
        { status: 400 },
      )
    );
  }
}
