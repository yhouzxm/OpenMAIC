import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { AuthorizationError, authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { listStudentPblProjects, startStudentPblInstance } from '@/lib/zhiban/pbl';

export async function GET() {
  try {
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:read')) throw new AuthorizationError('Permission denied');
    return NextResponse.json({ projects: await listStudentPblProjects(getZhibanPool(), principal) });
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load PBL learning' }, { status: 400 }); }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = z.object({ projectId: z.uuid() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid project' }, { status: 400 });
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:read')) throw new AuthorizationError('Permission denied');
    return NextResponse.json({ instance: await startStudentPblInstance(getZhibanPool(), principal, parsed.data.projectId) });
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to start PBL project' }, { status: 400 }); }
}
