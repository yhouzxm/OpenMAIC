import { randomUUID } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { isPBLProjectV2 } from '@/lib/pbl/v2/types';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  AuthorizationError,
  authorizationErrorResponse,
  requireRequestPrincipal,
} from '@/lib/zhiban/rbac';
import { getStudentPblInstance, syncStudentPblInstance } from '@/lib/zhiban/pbl';
import { enqueueLearningAnalysis, processAnalysisJobs } from '@/lib/zhiban/analysis';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ instanceId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:read'))
      throw new AuthorizationError('Permission denied');
    const { instanceId } = await context.params;
    return NextResponse.json({
      instance: await getStudentPblInstance(getZhibanPool(), principal, instanceId),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load PBL instance' },
        { status: 400 },
      )
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ instanceId: string }> },
) {
  try {
    const body = (await request.json().catch(() => null)) as { projectState?: unknown } | null;
    if (!body || !isPBLProjectV2(body.projectState))
      return NextResponse.json({ error: 'Invalid PBL state' }, { status: 400 });
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:read'))
      throw new AuthorizationError('Permission denied');
    const { instanceId } = await context.params;
    const pool = getZhibanPool();
    const result = await syncStudentPblInstance(pool, principal, instanceId, body.projectState);
    if (result.courseId) {
      const sourceEventId = body.projectState.runtimeEvents?.at(-1)?.id ?? randomUUID();
      const analysis = await enqueueLearningAnalysis(pool, principal, {
        learnerId: principal.id,
        courseId: result.courseId,
        sourceEventId,
      });
      after(() => processAnalysisJobs(pool, principal.tenantId, { limit: analysis.jobs.length }));
      return NextResponse.json({ ...result, analysisJobIds: analysis.jobs }, { status: 202 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to save PBL progress' },
        { status: 400 },
      )
    );
  }
}
