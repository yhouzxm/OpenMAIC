import { determineHintLevel, diagnoseTrainingState } from './diagnosis';
import type { CoachResponse, TrainingContext } from './types';

export const COACH_BUSY_NOTICE = 'AI教练暂时繁忙，已切换至教学提示模式。';

function profileDirection(context: TrainingContext): 'plc' | 'sensor' | 'open' {
  const profile = context.learningProfile;
  if (!profile) return 'open';
  if ((profile.plcKnowledgeMastery ?? 1) < (profile.sensorKnowledgeMastery ?? 1)) return 'plc';
  if ((profile.sensorKnowledgeMastery ?? 1) < (profile.plcKnowledgeMastery ?? 1)) return 'sensor';
  return 'open';
}

export function getFallbackHint(context: TrainingContext, level: 1 | 2 | 3): string {
  const diagnosis = diagnoseTrainingState(context);
  const profile = profileDirection(context);
  if (diagnosis.flags.includes('READY_TO_VERIFY')) return '维修完成后还不能结束，请重新启动并观察PLC输入和推料动作是否恢复。';
  if (diagnosis.flags.includes('READY_TO_REPAIR')) return '你已经形成了有证据的判断。下一步应执行必要处理，并保留验证环节。';
  if (diagnosis.flags.includes('WRONG_DIRECTION')) return '当前已有现场测量证据，请重新比较传感器供电、输出与PLC输入之间的对应关系。';
  if (context.evidence.powerMeasured && context.evidence.outputMeasured) return '供电与输出证据已经齐全。请结合两项结果，自己判断故障范围并提交判断。';
  if (context.evidence.powerMeasured) return '供电状态已经确认。下一步还需要获取输出端证据，才能判断信号链是否成立。';
  if (context.behavior.actions.some((item) => item.action === 'OPEN_PLC_MONITOR')) {
    return level >= 3
      ? 'I0.2没有输入。请检查它对应的现场检测元件，并依次确认供电与输出。'
      : 'PLC中I0.2当前没有输入。这个输入点对应哪个现场检测元件？';
  }
  if (level === 1) return profile === 'plc'
    ? '先比较现场工件位置与PLC输入状态，找出两者是否一致。'
    : '现场工件已经到达检测位，请比较现场现象与PLC输入状态。';
  if (level === 2) return '先查看PLC输入监控，确认工件到位时相关输入点是否发生变化。';
  return profile === 'sensor'
    ? '建议检查S2光电传感器：先确认24V供电，再检测输出端状态。'
    : '请依次查看PLC I0.2、现场检测元件供电和输出，建立完整证据链。';
}

export function createFallbackCoachResponse(context: TrainingContext): CoachResponse {
  const diagnosis = diagnoseTrainingState(context);
  const hintLevel = determineHintLevel(context);
  return {
    message: getFallbackHint(context, hintLevel),
    hintLevel,
    diagnosisState: diagnosis.stage,
    diagnosisFlags: diagnosis.flags,
    fallback: true,
    notice: COACH_BUSY_NOTICE,
  };
}
