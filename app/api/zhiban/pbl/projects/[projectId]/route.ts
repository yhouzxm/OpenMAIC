import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { AuthorizationError, authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { setPblProjectStatus, updatePblProjectDefinition } from '@/lib/zhiban/pbl';

const definitionSchema = z.object({
  courseId: z.uuid(), code: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200),
  description: z.string().max(10000), learningObjective: z.string().max(4000),
  targetSkills: z.array(z.string().trim().min(1).max(200)).min(1).max(30), deliverable: z.string().max(2000),
  scenarioRoleplay: z.boolean(), scenarioBrief: z.string().max(4000),
  opensAt: z.iso.datetime().nullable(), closesAt: z.iso.datetime().nullable(), status: z.enum(['draft', 'published']),
}).refine((value) => !value.opensAt || !value.closesAt || value.closesAt >= value.opensAt, { message: '项目结束时间不能早于开始时间' });
const statusSchema = z.object({ status: z.enum(['draft', 'published']) });

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:manage')) throw new AuthorizationError('Permission denied');
    const { projectId } = await context.params;
    const definition = definitionSchema.safeParse(body);
    if (definition.success)
      return NextResponse.json({ project: await updatePblProjectDefinition(getZhibanPool(), principal, projectId, definition.data) });
    const status = statusSchema.safeParse(body);
    if (status.success)
      return NextResponse.json({ project: await setPblProjectStatus(getZhibanPool(), principal, projectId, status.data.status) });
    return NextResponse.json({ error: definition.error.issues[0]?.message ?? 'Invalid project update' }, { status: 400 });
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update project' }, { status: 400 });
  }
}
