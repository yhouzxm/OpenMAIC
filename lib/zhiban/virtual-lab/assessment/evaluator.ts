import { createFallbackAssessmentFeedback, EVALUATOR_BUSY_NOTICE } from './fallback';
import type { TrainingContext } from '../ai/types';
import type { AssessmentFeedback, VirtualLabAssessment } from './types';

export const VIRTUAL_LAB_EVALUATOR_SYSTEM_PROMPT = `你是“智伴·创学”机电虚拟实训过程评价员。只能依据输入的确定性评分、训练上下文和行为数据撰写评价；不得修改或重新计算分数，不得虚构行为，不评价人格。用专业、易懂的中文，输出严格JSON：{"summary":"","strengths":[""],"improvements":[""],"nextStep":""}。每项简洁、具体、可执行。`;

function parseFeedback(text: string): Omit<AssessmentFeedback, 'fallback' | 'notice'> | null {
  try {
    const value = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim()) as Record<string, unknown>;
    if (typeof value.summary !== 'string' || typeof value.nextStep !== 'string' || !Array.isArray(value.strengths) || !Array.isArray(value.improvements)) return null;
    return {
      summary: value.summary.slice(0, 220),
      strengths: value.strengths.filter((item): item is string => typeof item === 'string').slice(0, 3),
      improvements: value.improvements.filter((item): item is string => typeof item === 'string').slice(0, 3),
      nextStep: value.nextStep.slice(0, 180),
    };
  } catch { return null; }
}

export async function runAssessmentEvaluator(
  assessment: VirtualLabAssessment,
  trainingContext: TrainingContext,
  options: { generate?: (input: { system: string; prompt: string }) => Promise<string> } = {},
): Promise<AssessmentFeedback> {
  if (!options.generate) return createFallbackAssessmentFeedback(assessment);
  try {
    const text = await options.generate({
      system: VIRTUAL_LAB_EVALUATOR_SYSTEM_PROMPT,
      prompt: `确定性评分（不可修改）：${JSON.stringify(assessment)}\n训练过程：${JSON.stringify(trainingContext)}\n请输出评价JSON。`,
    });
    const feedback = parseFeedback(text);
    return feedback ? { ...feedback, fallback: false } : createFallbackAssessmentFeedback(assessment);
  } catch {
    return { ...createFallbackAssessmentFeedback(assessment), notice: EVALUATOR_BUSY_NOTICE };
  }
}
