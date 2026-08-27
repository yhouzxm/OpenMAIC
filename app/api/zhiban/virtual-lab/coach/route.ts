import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { callLLM } from '@/lib/ai/llm';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { runTrainingCoach, type TrainingContext } from '@/lib/zhiban/virtual-lab/ai';

export const runtime = 'nodejs';
export const maxDuration = 30;

const CoachRequestSchema = z.object({
  mode: z.literal('training_coach').default('training_coach'),
  context: z.custom<TrainingContext>((value) => {
    if (!value || typeof value !== 'object') return false;
    const context = value as Partial<TrainingContext>;
    return Boolean(
      context.course?.courseId &&
      context.course?.activityId &&
      context.course?.scenarioId &&
      context.state?.currentPhase &&
      context.behavior &&
      context.evidence,
    );
  }),
  studentMessage: z.string().trim().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = CoachRequestSchema.parse(await request.json());
    const response = await runTrainingCoach(body.context, {
      studentMessage: body.studentMessage,
      generate: async ({ system, prompt }) => {
        const resolved = await resolveModelFromRequest(request, body, 'chat-adapter');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          const result = await callLLM(
            {
              model: resolved.model,
              system,
              prompt,
              maxOutputTokens: 180,
              abortSignal: controller.signal,
            },
            'virtual-lab-coach',
            { retries: 0 },
            resolved.thinkingConfig,
          );
          return result.text;
        } finally {
          clearTimeout(timeout);
        }
      },
    });
    return NextResponse.json(response);
  } catch (_error) {
    return NextResponse.json({ error: 'AI教练暂时繁忙，请稍后重试。' }, { status: 503 });
  }
}
