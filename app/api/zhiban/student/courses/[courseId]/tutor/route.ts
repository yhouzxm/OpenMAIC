import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { streamLLM } from '@/lib/ai/llm';
import { isZhibanCourseTutorEnabled } from '@/lib/config/feature-flags';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestGrantedPermission } from '@/lib/zhiban/rbac';
import { getStudentTutorState, prepareTutorTurn, rateTutorAnswer, saveTutorAnswer } from '@/lib/zhiban/tutor';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try { if (!isZhibanCourseTutorEnabled()) return NextResponse.json({ disabled: true });
    const courseId = z.uuid().parse((await params).courseId), principal = await requireRequestGrantedPermission('course:read');
    return NextResponse.json(await getStudentTutorState(getZhibanPool(), principal, courseId,
      request.nextUrl.searchParams.get('sessionId') ?? undefined, request.nextUrl.searchParams.get('activityId') ?? undefined)); }
  catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Tutor' }, { status: 400 }); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const started = Date.now();
  try {
    const courseId = z.uuid().parse((await params).courseId), principal = await requireRequestGrantedPermission('course:read'), body = await request.json();
    if (body.action === 'feedback') {
      const input = z.object({ messageId: z.uuid(), rating: z.union([z.literal(-1),z.literal(1)]), comment: z.string().max(2000).default('') }).parse(body);
      return NextResponse.json(await rateTutorAnswer(getZhibanPool(), principal, courseId, input));
    }
    const input = z.object({ message: z.string().trim().min(1).max(10000), sessionId: z.uuid().nullable().default(null),
      requestId: z.uuid(), activityId: z.uuid().nullable().optional() }).parse(body);
    const turn = await prepareTutorTurn(getZhibanPool(), principal, courseId, input);
    if ('duplicate' in turn) return NextResponse.json({ sessionId: turn.sessionId, message: turn.duplicate, duplicate: true });
    if (turn.safety.blocked) {
      const content = turn.safety.response ?? '该请求需要人工协助。';
      const saved = await saveTutorAnswer(getZhibanPool(), principal, courseId, { sessionId: turn.sessionId, content,
        citations: [], promptVersion: turn.promptVersion, latencyMs: Date.now() - started, status: 'blocked', requestId: input.requestId,
        safetyCategory: turn.safety.category, context: { activityId: input.activityId ?? null } });
      return NextResponse.json({ sessionId: turn.sessionId, message: { id: saved.id, role: 'assistant', content, citations: [], status: 'blocked', safetyCategory: turn.safety.category, createdAt: new Date().toISOString() } });
    }
    const resolved = await resolveModelFromRequest(request, body, 'chat-adapter');
    const history = turn.history.slice(0, -1).map((item) => `${item.role === 'user' ? '学习者' : 'Tutor'}：${item.content}`).join('\n');
    const result = streamLLM({ model: resolved.model, system: turn.system, prompt: `${history ? `最近对话：\n${history}\n\n` : ''}学习者问题：${input.message}` }, 'chat-adapter', resolved.thinkingConfig);
    const encoder = new TextEncoder();
    const event = (type: string, data: unknown) => encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const stream = new ReadableStream<Uint8Array>({ async start(controller) {
      let content = '';
      controller.enqueue(event('start', { sessionId: turn.sessionId, requestId: input.requestId }));
      try {
        for await (const delta of result.textStream) { content += delta; controller.enqueue(event('delta', { delta })); }
        const saved = await saveTutorAnswer(getZhibanPool(), principal, courseId, { sessionId: turn.sessionId, content,
          citations: turn.citations, promptVersion: turn.promptVersion, modelId: resolved.modelString, latencyMs: Date.now() - started,
          requestId: input.requestId, context: { activityId: input.activityId ?? null, activity: turn.activityContext } });
        controller.enqueue(event('done', { sessionId: turn.sessionId, message: { id: saved.id, role: 'assistant', content,
          citations: turn.citations, status: 'completed', createdAt: new Date().toISOString() } }));
      } catch (error) {
        await saveTutorAnswer(getZhibanPool(), principal, courseId, { sessionId: turn.sessionId, content: content || '模型暂时不可用，请稍后重试。',
          citations: [], promptVersion: turn.promptVersion, modelId: resolved.modelString, latencyMs: Date.now() - started,
          status: 'failed', requestId: input.requestId, context: { error: error instanceof Error ? error.message.slice(0, 500) : 'unknown' } }).catch(() => undefined);
        controller.enqueue(event('error', { error: '模型暂时不可用，请稍后重试。', retryable: true }));
      } finally { controller.close(); }
    }});
    return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Tutor response failed' }, { status: 400 }); }
}
