import type { TrainingAction, TrainingContext } from '../ai/types';
import type {
  AssessmentDimension,
  AssessmentDimensionKey,
  AssessmentInput,
  ErrorPattern,
  RecommendedContent,
  StrengthPattern,
  VirtualLabAssessment,
  WeakPoint,
} from './types';

const MAX: Record<AssessmentDimensionKey, number> = {
  diagnosisAccuracy: 30,
  procedureQuality: 25,
  evidenceReasoning: 20,
  independence: 15,
  verification: 10,
};

function indexOfAction(actions: TrainingAction[], name: string) {
  return actions.findIndex((item) => item.action === name);
}

function actionBefore(actions: TrainingAction[], name: string, before: number) {
  const index = indexOfAction(actions, name);
  return index >= 0 && (before < 0 || index < before);
}

function clamp(value: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

export function identifyErrorPatterns(context: TrainingContext): ErrorPattern[] {
  const { actions, wrongActions, hintHistory } = context.behavior;
  const diagnosisAt = indexOfAction(actions, 'SUBMIT_DIAGNOSIS');
  const openedPlc = actionBefore(actions, 'OPEN_PLC_MONITOR', diagnosisAt);
  const powerMeasured = actionBefore(actions, 'MEASURE_SENSOR_POWER', diagnosisAt);
  const outputMeasured = actionBefore(actions, 'MEASURE_SENSOR_OUTPUT', diagnosisAt);
  const patterns: ErrorPattern[] = [];
  if (diagnosisAt >= 0 && (!openedPlc || !powerMeasured || !outputMeasured)) patterns.push('BLIND_GUESS');
  if (diagnosisAt >= 0 && !openedPlc) patterns.push('SKIP_PLC_INSPECTION');
  if (diagnosisAt >= 0 && !powerMeasured) patterns.push('SKIP_POWER_MEASUREMENT');
  if (diagnosisAt >= 0 && !outputMeasured) patterns.push('SKIP_OUTPUT_MEASUREMENT');
  if (wrongActions.filter((item) => item === 'RESTART_BEFORE_REPAIR').length >= 2) patterns.push('REPEATED_RESTART');
  if (hintHistory.filter((item) => item.hintLevel === 3).length >= 2 || hintHistory.length >= 5) patterns.push('OVER_RELIANCE_ON_HINTS');
  if (!context.evidence.verificationPassed) patterns.push('INSUFFICIENT_VERIFICATION');
  if (wrongActions.filter((item) => item === 'IRRELEVANT_INSPECTION').length >= 2) patterns.push('REPEATED_IRRELEVANT_INSPECTION');
  return patterns;
}

export function identifyStrengthPatterns(context: TrainingContext, durationSeconds: number): StrengthPattern[] {
  const { actions, wrongActions, hintsUsed } = context.behavior;
  const diagnosisAt = indexOfAction(actions, 'SUBMIT_DIAGNOSIS');
  const hasCompleteEvidence = context.evidence.workpieceAtS2 &&
    actionBefore(actions, 'OPEN_PLC_MONITOR', diagnosisAt) &&
    actionBefore(actions, 'MEASURE_SENSOR_POWER', diagnosisAt) &&
    actionBefore(actions, 'MEASURE_SENSOR_OUTPUT', diagnosisAt);
  const strengths: StrengthPattern[] = [];
  if (hasCompleteEvidence && context.evidence.diagnosisSubmitted) strengths.push('SYSTEMATIC_DIAGNOSIS');
  if (hasCompleteEvidence) strengths.push('EVIDENCE_BASED_REASONING');
  if (hintsUsed === 0 && wrongActions.length === 0 && context.evidence.verificationPassed) strengths.push('INDEPENDENT_COMPLETION');
  if (context.evidence.verificationPassed && durationSeconds <= 15 * 60 && context.behavior.actionsCount <= 14) strengths.push('EFFICIENT_TROUBLESHOOTING');
  if (context.evidence.verificationPassed) strengths.push('COMPLETE_VERIFICATION');
  return strengths;
}

export function mapWeakPoints(errorPatterns: ErrorPattern[]): WeakPoint[] {
  const result: WeakPoint[] = [];
  const add = (point: WeakPoint) => { if (!result.some((item) => item.code === point.code)) result.push(point); };
  if (errorPatterns.includes('SKIP_PLC_INSPECTION') || errorPatterns.includes('BLIND_GUESS')) add({
    code: 'PLC_IO_ANALYSIS', knowledgePoint: '现场工件到位与 PLC I0.2 输入对应关系', chapter: '第5章 系统控制技术', capability: 'PLC I/O状态分析', reason: '未先利用 PLC 输入状态缩小故障范围。',
  });
  if (errorPatterns.includes('SKIP_POWER_MEASUREMENT') || errorPatterns.includes('SKIP_OUTPUT_MEASUREMENT')) add({
    code: 'SENSOR_MEASUREMENT', knowledgePoint: '光电传感器供电与输出状态判断', chapter: '第3章 传感检测与转换技术', capability: '传感器状态判断与检测', reason: '未通过供电、输出测量建立完整证据链。',
  });
  if (errorPatterns.includes('INSUFFICIENT_VERIFICATION')) add({
    code: 'VERIFICATION_PROCESS', knowledgePoint: '机电系统故障诊断规范流程', chapter: '综合实践区：自动输送系统故障诊断', capability: '结果验证', reason: '维修后未完成重新启动与生产恢复验证。',
  });
  if (errorPatterns.includes('OVER_RELIANCE_ON_HINTS')) add({
    code: 'DIAGNOSIS_INDEPENDENCE', knowledgePoint: '故障诊断证据链构建', chapter: '综合实践区：自动输送系统故障诊断', capability: '自主诊断', reason: '诊断过程中多次需要高层级提示支架。',
  });
  return result;
}

export function mapRecommendations(weakPoints: WeakPoint[]): RecommendedContent[] {
  return weakPoints.map((point) => ({
    knowledgePoint: point.knowledgePoint,
    chapter: point.chapter,
    reason: point.reason,
    recommendationType: point.code === 'VERIFICATION_PROCESS' ? 'practice' : 'review',
    title: point.code === 'SENSOR_MEASUREMENT' ? '复习光电传感器供电与输出判断' : `补强：${point.capability}`,
    priority: point.code === 'VERIFICATION_PROCESS' ? 'medium' : 'high',
    chapterId: point.chapter.includes('第3章') ? 'mech-chapter-sensing' : point.chapter.includes('第5章') ? 'mech-chapter-control' : 'mech-chapter-comprehensive-practice',
  }));
}

function dimension(score: number, key: AssessmentDimensionKey, reason: string): AssessmentDimension {
  return { score: clamp(score, MAX[key]), maxScore: MAX[key], reason };
}

export function calculateAssessment(input: AssessmentInput): VirtualLabAssessment {
  const { trainingContext: context } = input;
  const actions = context.behavior.actions;
  const errors = identifyErrorPatterns(context);
  const wrongDiagnosisCount = context.behavior.wrongActions.filter((item) => item === 'WRONG_DIAGNOSIS').length;
  const correctDiagnosis = context.behavior.diagnosisAttempts.includes('S2_OUTPUT_ABNORMAL') ||
    (context.evidence.repairCompleted && context.evidence.verificationPassed);
  const durationSeconds = input.durationSeconds ?? Math.round(context.behavior.elapsedTime / 1000);
  const diagnosisAccuracy = correctDiagnosis
    ? 30 - Math.min(15, wrongDiagnosisCount * 5)
    : Math.max(0, 10 - wrongDiagnosisCount * 2);
  const diagnosisAt = indexOfAction(actions, 'SUBMIT_DIAGNOSIS');
  const requiredBeforeDiagnosis = ['OPEN_PLC_MONITOR', 'INSPECT_COMPONENT', 'MEASURE_SENSOR_POWER', 'MEASURE_SENSOR_OUTPUT']
    .filter((name) => !actionBefore(actions, name, diagnosisAt)).length;
  const invalidRestartCount = context.behavior.wrongActions.filter((item) => item === 'RESTART_BEFORE_REPAIR').length;
  const irrelevantCount = context.behavior.wrongActions.filter((item) => item === 'IRRELEVANT_INSPECTION').length;
  const procedureQuality = 25 - requiredBeforeDiagnosis * 4 - Math.min(5, invalidRestartCount * 2) - Math.min(4, irrelevantCount * 2);
  const evidence = [
    context.evidence.workpieceAtS2,
    actions.some((item) => item.action === 'OPEN_PLC_MONITOR'),
    context.evidence.powerMeasured,
    context.evidence.outputMeasured,
  ];
  const evidenceReasoning = evidence.filter(Boolean).length * 5;
  const highestHint = Math.max(0, ...context.behavior.hintHistory.map((item) => item.hintLevel));
  const levelThreeCount = context.behavior.hintHistory.filter((item) => item.hintLevel === 3).length;
  const independence = highestHint === 0 ? 15 : highestHint === 1 ? 13 : highestHint === 2 ? 11 : Math.max(7, 9 - Math.max(0, levelThreeCount - 1));
  const didRestart = actions.some((item) => item.action === 'RESTART_MACHINE');
  const verification = context.evidence.verificationPassed ? 10 : didRestart ? 6 : context.evidence.repairCompleted ? 4 : 0;
  const dimensions = {
    diagnosisAccuracy: dimension(diagnosisAccuracy, 'diagnosisAccuracy', correctDiagnosis ? `最终诊断正确；错误诊断 ${wrongDiagnosisCount} 次。` : '未完成正确故障定位。'),
    procedureQuality: dimension(procedureQuality, 'procedureQuality', requiredBeforeDiagnosis ? `诊断前缺少 ${requiredBeforeDiagnosis} 项关键流程步骤。` : '诊断流程已覆盖 PLC、检查与测量关键步骤。'),
    evidenceReasoning: dimension(evidenceReasoning, 'evidenceReasoning', `已获取 ${evidence.filter(Boolean).length}/4 项关键证据。`),
    independence: dimension(independence, 'independence', context.behavior.hintsUsed ? `使用提示 ${context.behavior.hintsUsed} 次，最高 ${highestHint} 级。` : '全程未使用 AI 提示，独立完成。'),
    verification: dimension(verification, 'verification', context.evidence.verificationPassed ? '已完成重新启动、I0.2恢复和生产恢复验证。' : '尚未完成完整生产恢复验证。'),
  };
  const strengths = identifyStrengthPatterns(context, durationSeconds);
  const weakPoints = mapWeakPoints(errors);
  return {
    overallScore: clamp(Object.values(dimensions).reduce((sum, item) => sum + item.score, 0), 100),
    dimensions,
    durationSeconds,
    actionsCount: context.behavior.actionsCount,
    wrongActions: context.behavior.wrongActions,
    hintsUsed: context.behavior.hintsUsed,
    diagnosisAttempts: context.behavior.diagnosisAttempts,
    keyEvidenceCollected: ['工件到达S2', 'PLC I0.2检查', 'S2供电24V', 'S2输出0V'].filter((_, index) => evidence[index]),
    errorPatterns: errors,
    strengthPatterns: strengths,
    weakPoints,
    recommendedContent: mapRecommendations(weakPoints),
    attemptNumber: input.attemptNumber,
    ...(input.previousAttemptSummary ? { previousAttemptSummary: input.previousAttemptSummary } : {}),
  };
}
