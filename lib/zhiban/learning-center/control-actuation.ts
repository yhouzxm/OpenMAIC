import type { ConceptErrorCode, LearningEvent } from './types';

export type PlcIoAddress = 'I0.0' | 'I0.1' | 'I0.2' | 'Q0.0' | 'Q0.1';
export type PlcScanStep = 'input' | 'logic' | 'output';
export type ExecutionMode = 'NORMAL_EXECUTION' | 'ACTUATION_FAILURE_DEMO';

export const PLC_IO_MAP: Record<PlcIoAddress, { label: string; kind: 'input' | 'output' }> = {
  'I0.0': { label: '启动按钮', kind: 'input' },
  'I0.1': { label: '停止按钮', kind: 'input' },
  'I0.2': { label: '光电传感器 S2', kind: 'input' },
  'Q0.0': { label: '输送电机', kind: 'output' },
  'Q0.1': { label: '推料控制', kind: 'output' },
};

export function deriveControlState(i02: boolean) {
  return { i02, q01: i02, ladderConducting: i02 };
}

export function evaluateM06(fieldDevice: string, selectedIo: string) {
  const correctIo: Record<string, PlcIoAddress> = {
    s2: 'I0.2',
    pusher: 'Q0.1',
    start: 'I0.0',
  };
  const expected = correctIo[fieldDevice];
  const isCorrect = expected === selectedIo;
  const expectedKind = expected?.startsWith('I') ? 'input' : 'output';
  const selectedKind = selectedIo.startsWith('I')
    ? 'input'
    : selectedIo.startsWith('Q')
      ? 'output'
      : null;
  const conceptErrors: ConceptErrorCode[] = !isCorrect
    ? selectedKind && expectedKind !== selectedKind
      ? ['INPUT_OUTPUT_CONFUSION']
      : ['FIELD_IO_MAPPING_ERROR']
    : [];
  return { correctIo: expected, isCorrect, conceptErrors };
}

export function evaluateM07(inputState: boolean, predictedOutput: boolean) {
  const actualOutput = inputState;
  return {
    inputState,
    predictedOutput,
    actualOutput,
    isCorrect: predictedOutput === actualOutput,
    conceptErrors:
      predictedOutput === actualOutput ? [] : (['LADDER_LOGIC_CONFUSION'] as ConceptErrorCode[]),
  };
}

export function deriveExecutionState(q01: boolean, mode: ExecutionMode) {
  return {
    q01,
    solenoidEnergized: q01,
    cylinderExtended: q01 && mode === 'NORMAL_EXECUTION',
    mode,
  };
}

export function evaluateExecutionCheckpoint(selectedLayer: string) {
  const isCorrect = selectedLayer === 'actuation';
  return {
    isCorrect,
    conceptErrors: isCorrect
      ? []
      : (['OUTPUT_EQUALS_ACTUATION_SUCCESS', 'CONTROL_EXECUTION_CONFUSION'] as ConceptErrorCode[]),
  };
}

export interface KnowledgeStationProfile {
  dimensions: Record<string, number | null>;
  sourceLabel: 'Knowledge Station 03' | 'Knowledge Station 04';
  sourceAttempts: number;
}

function average(scores: number[]) {
  return scores.length
    ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
    : null;
}

function exerciseScores(events: LearningEvent[], exercise: string) {
  return events
    .filter(
      (event) =>
        event.eventType === 'SUBMIT_MICRO_EXERCISE' &&
        event.payload?.exercise === exercise &&
        typeof event.isCorrect === 'boolean',
    )
    .map((event) => (event.isCorrect ? 100 : 0));
}

export function calculateControlKnowledgeProfile(events: LearningEvent[]): KnowledgeStationProfile {
  const m06 = exerciseScores(events, 'M06');
  const m07 = exerciseScores(events, 'M07');
  return {
    dimensions: {
      plcSignalAnalysis: average([...m06, ...m07]),
      systemUnderstanding: average(m07),
    },
    sourceLabel: 'Knowledge Station 03',
    sourceAttempts: m06.length + m07.length,
  };
}

export function calculateActuationKnowledgeProfile(
  events: LearningEvent[],
): KnowledgeStationProfile {
  const checkpoint = exerciseScores(events, 'K14-checkpoint');
  return {
    dimensions: {
      systemUnderstanding: average(checkpoint),
      actuationChain: average(checkpoint),
    },
    sourceLabel: 'Knowledge Station 04',
    sourceAttempts: checkpoint.length,
  };
}
