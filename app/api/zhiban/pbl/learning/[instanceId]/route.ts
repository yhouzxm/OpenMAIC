import { NextRequest, NextResponse } from 'next/server';
import { isPBLProjectV2 } from '@/lib/pbl/v2/types';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { AuthorizationError, authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { getStudentPblInstance, syncStudentPblInstance } from '@/lib/zhiban/pbl';

export async function GET(_request: NextRequest, context: { params: Promise<{ instanceId: string }> }) {
  try {
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:read')) throw new AuthorizationError('Permission denied');
    const { instanceId } = await context.params;
    return NextResponse.json({ instance: await getStudentPblInstance(getZhibanPool(), principal, instanceId) });
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load PBL instance' }, { status: 400 }); }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ instanceId: string }> }) {
  try {
    const body = await request.json().catch(() => null) as { projectState?: unknown } | null;
    if (!body || !isPBLProjectV2(body.projectState)) return NextResponse.json({ error: 'Invalid PBL state' }, { status: 400 });
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:read')) throw new AuthorizationError('Permission denied');
    const { instanceId } = await context.params;
    return NextResponse.json(await syncStudentPblInstance(getZhibanPool(), principal, instanceId, body.projectState));
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save PBL progress' }, { status: 400 }); }
}
