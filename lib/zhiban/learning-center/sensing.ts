import type { ConceptErrorCode, LearningEvent } from './types';

export const SENSING_POSITIONS = ['before', 'inside', 'after'] as const;
export type SensingPosition = (typeof SENSING_POSITIONS)[number];
export const SENSING_OUTPUT_MODES = ['NORMAL_OUTPUT', 'NO_OUTPUT_DEMO'] as const;
export type SensingOutputMode = (typeof SENSING_OUTPUT_MODES)[number];

export interface SensingState {
  position: SensingPosition;
  outputMode: SensingOutputMode;
  sensorActive: boolean;
  poweredVoltage: 24;
  outputVoltage: 0 | 24;
  plcI02: boolean;
}

export function deriveSensingState(
  position: SensingPosition,
  outputMode: SensingOutputMode = 'NORMAL_OUTPUT',
): SensingState {
  const sensorActive = position === 'inside';
  const outputVoltage = sensorActive && outputMode === 'NORMAL_OUTPUT' ? 24 : 0;
  return {
    position,
    outputMode,
    sensorActive,
    poweredVoltage: 24,
    outputVoltage,
    plcI02: outputVoltage === 24,
  };
}

export function evaluateM03(predictedOn: boolean, state: SensingState) {
  return {
    predictedState: predictedOn ? 'ON' : 'OFF',
    actualState: state.sensorActive ? 'ON' : 'OFF',
    isCorrect: predictedOn === state.sensorActive,
  };
}

export function evaluateM04(option: string): {
  isCorrect: boolean;
  conceptError?: ConceptErrorCode;
} {
  if (option === 'B') return { isCorrect: true };
  return option === 'A'
    ? { isCorrect: false, conceptError: 'POWER_EQUALS_SENSOR_NORMAL' }
    : { isCorrect: false };
}

export function evaluateM05(option: string) {
  return {
    isCorrect: option === 'B',
    evidenceUsed: ['workpieceAtS2', 's2Power24V', 's2Output0V', 'plcI02Off'],
  };
}

export interface SensingKnowledgeProfile {
  sensorDetection: number | null;
  toolMeasurement: number | null;
  plcSignalAnalysis: number | null;
  sourceLabel: 'Knowledge Station 02';
  sourceAttempts: number;
}

/** Uses all recorded Station 02 micro-exercise attempts so one answer never overwrites an ability. */
export function calculateSensingKnowledgeProfile(events: LearningEvent[]): SensingKnowledgeProfile {
  const scores = (exercise: string) =>
    events
      .filter(
        (event) =>
          event.eventType === 'SUBMIT_MICRO_EXERCISE' &&
          event.payload?.exercise === exercise &&
          typeof event.isCorrect === 'boolean',
      )
      .map((event) => (event.isCorrect ? 100 : 0));
  const average = (values: number[]) =>
    values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;
  const m03 = scores('M03');
  const m04 = scores('M04');
  const m05 = scores('M05');
  return {
    sensorDetection: average(m03),
    toolMeasurement: average(m04),
    plcSignalAnalysis: average(m05),
    sourceLabel: 'Knowledge Station 02',
    sourceAttempts: m03.length + m04.length + m05.length,
  };
}
