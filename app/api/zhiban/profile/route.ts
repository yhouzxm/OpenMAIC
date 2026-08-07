import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  AuthorizationError,
  authorizationErrorResponse,
  requireRequestPrincipal,
} from '@/lib/zhiban/rbac';
import { listOwnProfiles } from '@/lib/zhiban/profile';
import { enqueueProfileRebuild, processAnalysisJobs } from '@/lib/zhiban/analysis';
export async function GET() {
  try {
    const p = await requireRequestPrincipal();
    if (!p.permissions.includes('course:read')) throw new AuthorizationError('Permission denied');
    return NextResponse.json({ profiles: await listOwnProfiles(getZhibanPool(), p) });
  } catch (e) {
    return (
      authorizationErrorResponse(e) ??
      NextResponse.json(
        { error: e instanceof Error ? e.message : 'Unable to load profile' },
        { status: 400 },
      )
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    const parsed = z
      .object({ courseId: z.uuid() })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid course' }, { status: 400 });
    const p = await requireRequestPrincipal();
    if (!p.permissions.includes('course:read')) throw new AuthorizationError('Permission denied');
    const pool = getZhibanPool();
    const result = await enqueueProfileRebuild(pool, p, p.id, parsed.data.courseId);
    after(() => processAnalysisJobs(pool, p.tenantId, { limit: 1 }));
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    return (
      authorizationErrorResponse(e) ??
      NextResponse.json(
        { error: e instanceof Error ? e.message : 'Unable to rebuild profile' },
        { status: 400 },
      )
    );
  }
}
