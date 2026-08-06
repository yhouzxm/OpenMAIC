import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { resolveProfileCorrection } from '@/lib/zhiban/profile';

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ courseId: string; correctionId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId, correctionId } = await context.params;
    const parsed = z
      .object({
        status: z.enum(['accepted', 'rejected']),
        resolution: z.string().trim().min(2).max(2000),
      })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid correction resolution' }, { status: 400 });
    return NextResponse.json(
      await resolveProfileCorrection(
        getZhibanPool(),
        principal,
        courseId,
        correctionId,
        parsed.data,
      ),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to resolve correction' },
        { status: 400 },
      )
    );
  }
}
