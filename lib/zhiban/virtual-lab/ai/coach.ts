import { buildCoachPrompt, VIRTUAL_LAB_COACH_SYSTEM_PROMPT } from './prompt';
import { determineHintLevel, diagnoseTrainingState } from './diagnosis';
import { COACH_BUSY_NOTICE, getFallbackHint } from './fallback';
import type { CoachResponse, TrainingContext } from './types';

const DIRECT_ANSWER_PATTERNS = [
  /S2\s*(?:传感器)?\s*(?:故障|坏了|损坏)/i,
  /正确答案(?:是|为)/,
  /更换\s*S2\s*(?:即可|就能|就可以)/i,
  /答案(?:是|为)\s*S2/i,
  /S2\s*(?:光电)?(?:传感器)?\s*(?:的)?输出(?:信号)?(?:异常|故障|损坏)/i,
  /(?:故障点|故障原因).{0,8}S2/i,
];

export function leaksDirectAnswer(text: string): boolean {
  return DIRECT_ANSWER_PATTERNS.some((pattern) => pattern.test(text));
}

function safeText(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, 120);
  return !normalized || leaksDirectAnswer(normalized) ? fallback : normalized;
}

export async function runTrainingCoach(
  context: TrainingContext,
  options: {
    studentMessage?: string;
    generate?: (input: { system: string; prompt: string }) => Promise<string>;
  } = {},
): Promise<CoachResponse> {
  const diagnosis = diagnoseTrainingState(context);
  const hintLevel = determineHintLevel(context);
  const fallbackHint = getFallbackHint(context, hintLevel);
  if (!options.generate) {
    return { message: fallbackHint, hintLevel, diagnosisState: diagnosis.stage, diagnosisFlags: diagnosis.flags, fallback: true, notice: COACH_BUSY_NOTICE };
  }
  try {
    const text = await options.generate({
      system: VIRTUAL_LAB_COACH_SYSTEM_PROMPT,
      prompt: buildCoachPrompt(context, diagnosis, hintLevel, options.studentMessage),
    });
    const message = safeText(text, fallbackHint);
    const filtered = !text.trim() || leaksDirectAnswer(text);
    return {
      message,
      hintLevel,
      diagnosisState: diagnosis.stage,
      diagnosisFlags: diagnosis.flags,
      fallback: filtered,
      ...(filtered ? { notice: 'AI回答已按教学规则转换为分层提示。' } : {}),
    };
  } catch {
    return { message: fallbackHint, hintLevel, diagnosisState: diagnosis.stage, diagnosisFlags: diagnosis.flags, fallback: true, notice: COACH_BUSY_NOTICE };
  }
}
