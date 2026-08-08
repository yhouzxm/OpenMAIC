import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { listTeacherInterventions, manageTeacherIntervention } from '@/lib/zhiban/agents';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

export async function GET(_: NextRequest, context: { params: Promise<{ courseId: string }> }) {
  try {
    const courseId = z.uuid().parse((await context.params).courseId);
    const principal = await requireRequestScopedPermission('course:manage', { courseIds: [courseId] });
    return NextResponse.json({ interventions: await listTeacherInterventions(getZhibanPool(), principal, courseId) });
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load interventions' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ courseId: string }> }) {
  try {
    const courseId = z.uuid().parse((await context.params).courseId);
    const principal = await requireRequestScopedPermission('course:manage', { courseIds: [courseId] });
    const body = z.object({ briefId: z.uuid(), action: z.enum(['escalate', 'resolve', 'retry', 'assign']), note: z.string().max(2000).optional(), assignedTo: z.uuid().optional() }).parse(await request.json());
    return NextResponse.json(await manageTeacherIntervention(getZhibanPool(), principal, { courseId, ...body }));
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update intervention' }, { status: 400 });
  }
}
