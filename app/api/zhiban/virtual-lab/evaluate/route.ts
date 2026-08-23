import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { callLLM } from '@/lib/ai/llm';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import {
  createFallbackAssessmentFeedback,
  runAssessmentEvaluator,
  type VirtualLabAssessment,
} from '@/lib/zhiban/virtual-lab/assessment';
import type { TrainingContext } from '@/lib/zhiban/virtual-lab/ai/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

const EvaluationRequestSchema = z.object({
  assessment: z.custom<VirtualLabAssessment>((value) => Boolean(value && typeof value === 'object' &&
    typeof (value as Partial<VirtualLabAssessment>).overallScore === 'number' &&
    (value as Partial<VirtualLabAssessment>).dimensions)),
  trainingContext: z.custom<TrainingContext>((value) => Boolean(value && typeof value === 'object' &&
    (value as Partial<TrainingContext>).course && (value as Partial<TrainingContext>).state)),
});

export async function POST(request: NextRequest) {
  let body: z.infer<typeof EvaluationRequestSchema>;
  try {
    body = EvaluationRequestSchema.parse(await request.json());
  } catch (_error) {
    return NextResponse.json({ error: '评价请求暂时无法处理。' }, { status: 400 });
  }
  const feedback = await runAssessmentEvaluator(body.assessment, body.trainingContext, {
    generate: async ({ system, prompt }) => {
      const resolved = await resolveModelFromRequest(request, body, 'chat-adapter');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const result = await callLLM({ model: resolved.model, system, prompt, maxOutputTokens: 400, abortSignal: controller.signal }, 'virtual-lab-evaluator', { retries: 0 }, resolved.thinkingConfig);
        return result.text;
      } finally { clearTimeout(timeout); }
    },
  });
  return NextResponse.json(feedback ?? createFallbackAssessmentFeedback(body.assessment));
}
