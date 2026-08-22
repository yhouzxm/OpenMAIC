import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { addManualTutorDocument, getTeacherTutorDashboard, saveCourseTutorConfig, syncCourseTutorKnowledge } from '@/lib/zhiban/tutor';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';
async function auth(raw: string) { const courseId = z.uuid().parse(raw); return { courseId, principal: await requireRequestScopedPermission('course:manage', { courseIds: [courseId] }) }; }

export async function GET(_: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try { const { courseId, principal } = await auth((await params).courseId); return NextResponse.json(await getTeacherTutorDashboard(getZhibanPool(), principal, courseId)); }
  catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Tutor' }, { status: 400 }); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId, principal } = await auth((await params).courseId), body = await request.json();
    if (body.action === 'sync') {
      const result = await syncCourseTutorKnowledge(getZhibanPool(), principal, courseId);
      return NextResponse.json(result, { status: result.failed ? 500 : 200 });
    }
    if (body.action === 'manual_document') {
      const input = z.object({ title: z.string().trim().min(1).max(300), content: z.string().trim().min(1).max(500000) }).parse(body);
      return NextResponse.json(await addManualTutorDocument(getZhibanPool(), principal, courseId, input));
    }
    const input = z.object({ enabled: z.boolean(), displayName: z.string().trim().min(1).max(120), welcomeMessage: z.string().max(5000),
      systemPrompt: z.string().max(20000), retrievalTopK: z.number().int().min(1).max(12), citationRequired: z.boolean(),
      answerScope: z.enum(['course_only','course_first']), maxHistoryMessages: z.number().int().min(2).max(40),
      status: z.enum(['draft','published','disabled']), autoSync: z.boolean().default(true) }).parse(body);
    return NextResponse.json(await saveCourseTutorConfig(getZhibanPool(), principal, courseId, input));
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update Tutor' }, { status: 400 }); }
}
