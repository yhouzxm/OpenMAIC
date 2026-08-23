import type { AssessmentFeedback, VirtualLabAssessment } from './types';

export const EVALUATOR_BUSY_NOTICE = 'AI过程评价暂时繁忙，已切换至规则评价模式。';

const strengthText: Record<string, string> = {
  SYSTEMATIC_DIAGNOSIS: '能够按诊断步骤逐步缩小范围。',
  EVIDENCE_BASED_REASONING: '能够用 PLC 与测量事实建立证据链。',
  INDEPENDENT_COMPLETION: '能够在较少支架下独立完成任务。',
  EFFICIENT_TROUBLESHOOTING: '能够在合理操作次数内完成排查。',
  COMPLETE_VERIFICATION: '能够在维修后完成恢复验证。',
};

export function createFallbackAssessmentFeedback(assessment: VirtualLabAssessment): AssessmentFeedback {
  const strengths = assessment.strengthPatterns.map((item) => strengthText[item]).filter(Boolean);
  const improvements = assessment.weakPoints.map((item) => item.reason);
  return {
    summary: `本次实训得分 ${assessment.overallScore} 分，已完成 ${assessment.diagnosisAttempts.includes('S2_OUTPUT_ABNORMAL') ? '故障定位' : '部分诊断'}与${assessment.dimensions.verification.score === 10 ? '恢复验证' : '过程练习'}。`,
    strengths: strengths.length ? strengths : ['已进入故障诊断流程，并保留了后续改进空间。'],
    improvements: improvements.length ? improvements : ['下次可进一步减少无效操作，提高诊断效率。'],
    nextStep: assessment.recommendedContent[0]?.title ?? '建议再次实训，巩固“观察—测量—判断—验证”流程。',
    fallback: true,
    notice: EVALUATOR_BUSY_NOTICE,
  };
}
