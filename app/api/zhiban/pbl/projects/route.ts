import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { AuthorizationError, authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { createPblProject, listManagedPblProjects } from '@/lib/zhiban/pbl';

const schema = z.object({
  courseId: z.uuid(), code: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200),
  description: z.string().max(10000), learningObjective: z.string().max(4000),
  targetSkills: z.array(z.string().trim().min(1).max(200)).min(1).max(30), deliverable: z.string().max(2000),
  scenarioRoleplay: z.boolean(), scenarioBrief: z.string().max(4000),
  opensAt: z.iso.datetime().nullable(), closesAt: z.iso.datetime().nullable(), status: z.enum(['draft', 'published']),
}).refine((value) => !value.opensAt || !value.closesAt || value.closesAt >= value.opensAt, { message: '项目结束时间不能早于开始时间' });

export async function GET(request: NextRequest) {
  try {
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:manage')) throw new AuthorizationError('Permission denied');
    return NextResponse.json({ projects: await listManagedPblProjects(getZhibanPool(), principal, request.nextUrl.searchParams.get('courseId') ?? undefined) });
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load projects' }, { status: 400 }); }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid project' }, { status: 400 });
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:manage')) throw new AuthorizationError('Permission denied');
    return NextResponse.json({ project: await createPblProject(getZhibanPool(), principal, parsed.data) }, { status: 201 });
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create project' }, { status: 400 }); }
}
