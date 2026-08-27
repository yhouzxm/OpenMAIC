import type { ConceptErrorCode } from '@/lib/zhiban/learning-center';

export const SIGNAL_TRACE_PATH = ['S2', 'I0.2', 'PLC Logic', 'Q0.1', 'solenoid_valve', 'cylinder'] as const;
export const SIGNAL_TRACE_CONTRADICTION_NODE = 'cylinder' as const;

export function evaluateSignalTraceChoice(selectedNode: string) {
  const isCorrect = selectedNode === SIGNAL_TRACE_CONTRADICTION_NODE;
  return {
    isCorrect,
    conceptErrors: (isCorrect ? [] : ['EVIDENCE_SELECTION_ERROR']) as ConceptErrorCode[],
    message: isCorrect
      ? '已找到第一个状态矛盾节点：控制信号到达后，气缸仍未动作。'
      : '这个节点的前后状态仍一致，请继续沿信号链向后追踪。',
  };
}
