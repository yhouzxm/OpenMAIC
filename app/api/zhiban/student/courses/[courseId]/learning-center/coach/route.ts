import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { requireMechatronicsStudentEnrollment } from '@/lib/zhiban/mechatronics-course';
import {
  AI_LEARNING_MODES,
  createLearningCenterAiFallback,
  getKnowledgePoint,
  getStation,
  normalizeAiStudentAttempts,
  type AiLearningMode,
} from '@/lib/zhiban/learning-center';

export const runtime = 'nodejs';
export const maxDuration = 30;

const log = createLogger('ZhibanLearningCenterCoach');

const InputSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  mode: z.enum(AI_LEARNING_MODES).default('knowledge_companion'),
  stationId: z.string(),
  knowledgePointId: z.string().optional(),
  currentInteraction: z.string().max(8000).default(''),
  studentAttempts: z
    .number()
    .int()
    .min(0)
    .default(0)
    .transform(normalizeAiStudentAttempts),
  incorrectConcepts: z.array(z.string().max(100)).max(20).default([]),
  conceptErrors: z.array(z.string().max(100)).max(20).default([]),
  microExercise: z.string().max(80).optional(),
  predictionHistory: z.array(z.record(z.string(), z.unknown())).max(20).default([]),
  selectedEvidence: z.array(z.string().max(100)).max(20).default([]),
  selectedLayer: z.string().max(50).optional(),
});

function strategy(mode: AiLearningMode) {
  if (mode === 'cognitive_diagnosis')
    return '你处于认知诊断模式。依据现场、PLC输入、PLC输出、证据选择和概念误区进行短追问；不得直接说出感知层、控制层或执行层答案。';
  if (mode === 'assessment_mentor')
    return '你处于评价导师模式。只能解释输入中已有的确定性六维分数、优势、薄弱点和推荐，不得修改分数，不得虚构学习行为。输出包含简短总结和一个可执行的下一步行动。';
  return '你处于知识学伴模式。可以解释当前知识，但不得替学生完成分类、预测、连线或选择练习。';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  let responseMode: AiLearningMode = 'knowledge_companion';
  let principal: Awaited<ReturnType<typeof requireRequestPrincipal>>;
  try {
    principal = await requireRequestPrincipal();
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: '需要登录后使用知识学伴' }, { status: 401 })
    );
  }
  if (principal.accountType !== 'student')
    return NextResponse.json({ error: '仅学生可以使用知识学伴' }, { status: 403 });
  try {
    const { courseId } = await params;
    await requireMechatronicsStudentEnrollment(getZhibanPool(), principal, courseId);
    const input = InputSchema.parse(await request.json());
    responseMode = input.mode;
    const station = getStation(input.stationId);
    const point = input.knowledgePointId ? getKnowledgePoint(input.knowledgePointId) : null;
    if (!station) return NextResponse.json({ error: '学习站不存在' }, { status: 400 });
    const system = [
      '你是“智伴·创学”的知识学伴，负责帮助成人学习者理解自动生产线机理。',
      `课程：机电一体化系统；课程代码：${courseId}`,
      `当前学习站：${station.title}；学习目标：${station.objective}`,
      `当前知识点：${point?.title ?? '系统认知'}；交互：${input.currentInteraction}`,
      `教学模式：${input.mode}。${strategy(input.mode)}`,
      `学生尝试次数：${input.studentAttempts}；可能的错误概念：${input.incorrectConcepts.join('、') || '暂无'}`,
      `概念误区：${input.conceptErrors.join('、') || '暂无'}；当前微练习：${input.microExercise ?? '无'}；预测记录数：${input.predictionHistory.length}`,
      `学生当前选择层级：${input.selectedLayer ?? '未选择'}；已选证据：${input.selectedEvidence.join('、') || '无'}`,
      '只回答当前知识点，使用简洁中文，不超过120字。通过类比、追问和澄清帮助理解，不直接替学生完成分类、预测或选择练习，不编造设备状态。若出现“供电正常等于传感器正常”的误区，只追问输出端和 PLC 输入是否已验证。若混淆 I/Q，只追问信号是进入 PLC 还是由 PLC 发往现场；若把 Q0.1 ON 等同于气缸成功动作，只追问是否已经观察到真实机械动作。不得直接公布答案。',
    ].join('\n');
    const resolved = await resolveModelFromRequest(request, {}, 'chat-adapter');
    const result = await callLLM(
      {
        model: resolved.model,
        system,
        prompt: `学习者问题：${input.question}`,
        maxOutputTokens: 180,
      },
      'learning-center-coach',
      { retries: 0 },
      resolved.thinkingConfig,
    );
    const message = result.text.trim();
    if (!message) throw new Error('empty model response');
    return NextResponse.json({ message, fallback: false });
  } catch (error) {
    const summary =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: 'UnknownError', message: String(error) };
    log.warn('Knowledge companion switched to deterministic fallback.', summary);
    return NextResponse.json({
      message: createLearningCenterAiFallback(responseMode),
      fallback: true,
      notice: '知识学伴暂时繁忙，已切换至学习提示模式。',
    });
  }
}
