import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { streamLLM } from '@/lib/ai/llm';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { enqueueLearningAnalysis, processAnalysisJobs } from '@/lib/zhiban/analysis';
import { recordInterventionOutcome, respondToIntervention } from '@/lib/zhiban/agents';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  archivePeerSession,
  getStudentPeerState,
  preparePeerTurn,
  ratePeerAnswer,
  reviewPeerOutput,
  savePeerAnswer,
} from '@/lib/zhiban/peer';
import { authorizationErrorResponse, requireRequestGrantedPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(_: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const principal = await requireRequestGrantedPermission('course:read');
    const courseId = z.uuid().parse((await params).courseId);
    return NextResponse.json(await getStudentPeerState(getZhibanPool(), principal, courseId));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load Peer' },
        { status: 400 },
      )
    );
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const started = Date.now();
  try {
    const principal = await requireRequestGrantedPermission('course:read');
    const courseId = z.uuid().parse((await params).courseId);
    const body = await request.json();
    if (body.action === 'feedback') {
      const input = z
        .object({
          messageId: z.uuid(),
          rating: z.union([z.literal(-1), z.literal(1)]),
          comment: z.string().max(2000).default(''),
        })
        .parse(body);
      return NextResponse.json(await ratePeerAnswer(getZhibanPool(), principal, courseId, input));
    }
    if (body.action === 'new_session') {
      const input = z.object({ sessionId: z.uuid() }).parse(body);
      return NextResponse.json(
        await archivePeerSession(getZhibanPool(), principal, courseId, input.sessionId),
      );
    }
    if (body.action === 'proactive_seen') {
      const input = z.object({ briefId: z.uuid() }).parse(body);
      await respondToIntervention(getZhibanPool(), principal, input.briefId, courseId, 'accept');
      await recordInterventionOutcome(getZhibanPool(), principal, {
        briefId: input.briefId,
        courseId,
        outcome: 'start',
      });
      return NextResponse.json(
        await recordInterventionOutcome(getZhibanPool(), principal, {
          briefId: input.briefId,
          courseId,
          outcome: 'deliver',
        }),
      );
    }
    const input = z
      .object({
        message: z.string().trim().min(1).max(5000),
        sessionId: z.uuid().nullable().default(null),
        requestId: z.uuid(),
      })
      .parse(body);
    const pool = getZhibanPool();
    const turn = await preparePeerTurn(pool, principal, courseId, input);
    const analysis = await enqueueLearningAnalysis(pool, principal, {
      learnerId: principal.id,
      courseId,
      sourceEventId: input.requestId,
    });
    after(() => processAnalysisJobs(pool, principal.tenantId, { limit: analysis.jobs.length }));
    if ('duplicate' in turn)
      return NextResponse.json({
        sessionId: turn.sessionId,
        message: turn.duplicate,
        duplicate: true,
      });
    if ('immediate' in turn)
      return NextResponse.json({
        sessionId: turn.sessionId,
        message: turn.immediate,
        escalated: true,
      });
    const resolved = await resolveModelFromRequest(request, body, 'chat-adapter');
    const history = turn.history
      .map(
        (message) => `${message.role === 'user' ? '学习者' : 'Peer'}：${String(message.content)}`,
      )
      .join('\n');
    const result = streamLLM(
      {
        model: resolved.model,
        system: turn.system,
        prompt: `最近交流：\n${history}\n\n请回应学习者刚才的感受。`,
      },
      'chat-adapter',
      resolved.thinkingConfig,
    );
    let generated = '';
    try {
      for await (const delta of result.textStream) generated += delta;
    } catch {
      generated = '我暂时没能组织好回应。你可以稍后再试，或联系老师获得支持。';
    }
    const reviewed = reviewPeerOutput(generated);
    const status = reviewed.safe ? ('completed' as const) : ('blocked' as const);
    const saved = await savePeerAnswer(pool, principal, courseId, {
      sessionId: turn.sessionId,
      requestId: input.requestId,
      content: reviewed.content,
      emotion: turn.assessment.emotion,
      status,
      safetyCategory: reviewed.category,
      modelId: resolved.modelString,
      latencyMs: Date.now() - started,
    });
    return NextResponse.json({
      sessionId: turn.sessionId,
      message: {
        id: saved.id,
        role: 'assistant',
        content: reviewed.content,
        emotion: turn.assessment.emotion,
        riskLevel: turn.assessment.riskLevel,
        status,
        safetyCategory: reviewed.category,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Peer response failed' },
        { status: 400 },
      )
    );
  }
}
