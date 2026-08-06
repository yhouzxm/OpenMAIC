import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { AuthorizationError, authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { changePblGroupRole, createPblGroups, createPblTemplateFromProject, createProjectRubric, getPblCollaborationOverview, reviewPblSubmission, scorePblSubmission, updatePblTaskPolicy } from '@/lib/zhiban/pbl';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('task_policy'), taskId: z.uuid(), taskScope: z.enum(['individual','group']), dependencies: z.array(z.uuid()).max(100) }),
  z.object({ action: z.literal('group'), method: z.enum(['manual','random','class','balanced']), groupSize: z.number().int().min(2).max(20), name: z.string().max(200).optional(), studentIds: z.array(z.uuid()).optional() }),
  z.object({ action: z.literal('group_role'), memberId: z.uuid(), role: z.enum(['leader','member','recorder','presenter']) }),
  z.object({ action: z.literal('review'), submissionId: z.uuid(), status: z.enum(['changes_requested','approved']), feedback: z.string().max(5000) }),
  z.object({ action: z.literal('rubric_score'), submissionId: z.uuid(), feedback: z.string().max(5000), scores: z.array(z.object({ criterionId: z.uuid(), score: z.number().min(0).max(1000), feedback: z.string().max(2000) })).min(1).max(30) }),
  z.object({ action: z.literal('rubric'), name: z.string().min(1).max(200), description: z.string().max(2000), gradeItemCode: z.string().min(1).max(80), gradeItemName: z.string().min(1).max(200), gradeWeight: z.number().min(0).max(100), criteria: z.array(z.object({ code: z.string().min(1).max(80), name: z.string().min(1).max(200), description: z.string().max(1000), weight: z.number().gt(0).max(100), maxScore: z.number().gt(0).max(1000) })).min(1).max(30) }),
  z.object({ action: z.literal('template'), code: z.string().min(1).max(80), name: z.string().min(1).max(200) }),
]);

async function teacher() { const principal = await requireRequestPrincipal(); if (!principal.permissions.includes('course:manage')) throw new AuthorizationError('Permission denied'); return principal; }

export async function GET(_request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try { const principal = await teacher(); const { projectId } = await context.params; return NextResponse.json(await getPblCollaborationOverview(getZhibanPool(), principal, projectId)); }
  catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load collaboration' }, { status: 400 }); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid action' }, { status: 400 });
    const principal = await teacher(); const { projectId } = await context.params; const input = parsed.data;
    let result: unknown;
    if (input.action === 'task_policy') result = await updatePblTaskPolicy(getZhibanPool(), principal, projectId, input);
    else if (input.action === 'group') result = await createPblGroups(getZhibanPool(), principal, projectId, input);
    else if (input.action === 'group_role') result = await changePblGroupRole(getZhibanPool(), principal, projectId, input.memberId, input.role);
    else if (input.action === 'review') result = await reviewPblSubmission(getZhibanPool(), principal, projectId, input);
    else if (input.action === 'rubric_score') result = await scorePblSubmission(getZhibanPool(), principal, projectId, input);
    else if (input.action === 'rubric') result = await createProjectRubric(getZhibanPool(), principal, projectId, input);
    else result = await createPblTemplateFromProject(getZhibanPool(), principal, projectId, input);
    return NextResponse.json({ result });
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update collaboration' }, { status: 400 }); }
}
