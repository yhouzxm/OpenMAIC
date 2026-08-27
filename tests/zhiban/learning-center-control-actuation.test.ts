import { describe, expect, it } from 'vitest';
import {
  calculateActuationKnowledgeProfile,
  calculateControlKnowledgeProfile,
  deriveControlState,
  deriveExecutionState,
  deriveLearningCenterProgress,
  evaluateExecutionCheckpoint,
  evaluateM06,
  evaluateM07,
  type LearningEvent,
} from '@/lib/zhiban/learning-center';

function event(overrides: Partial<LearningEvent>): LearningEvent {
  return {
    id: crypto.randomUUID(),
    courseId: 'mech-mechatronics-system',
    stationId: 'station-03-control',
    knowledgePointId: 'K09',
    eventType: 'VIEW_KNOWLEDGE_POINT',
    payload: {},
    timestamp: '2026-08-24T15:00:00.000Z',
    ...overrides,
  };
}

describe('Station 03 control and Station 04 actuation knowledge models', () => {
  it('keeps PLC input, ladder state and Q0.1 output consistent', () => {
    expect(deriveControlState(false)).toEqual({ i02: false, q01: false, ladderConducting: false });
    expect(deriveControlState(true)).toEqual({ i02: true, q01: true, ladderConducting: true });
  });

  it('scores M06 mappings and distinguishes I/Q confusion from field mapping errors', () => {
    expect(evaluateM06('s2', 'I0.2')).toMatchObject({ correctIo: 'I0.2', isCorrect: true });
    expect(evaluateM06('s2', 'Q0.1').conceptErrors).toEqual(['INPUT_OUTPUT_CONFUSION']);
    expect(evaluateM06('s2', 'I0.0').conceptErrors).toEqual(['FIELD_IO_MAPPING_ERROR']);
  });

  it('scores M07 against the actual I0.2 to Q0.1 ladder relationship', () => {
    expect(evaluateM07(true, true).isCorrect).toBe(true);
    expect(evaluateM07(false, true)).toMatchObject({
      actualOutput: false,
      isCorrect: false,
      conceptErrors: ['LADDER_LOGIC_CONFUSION'],
    });
  });

  it('has a normal execution chain and a separate no-motion demonstration', () => {
    expect(deriveExecutionState(true, 'NORMAL_EXECUTION')).toMatchObject({
      q01: true,
      solenoidEnergized: true,
      cylinderExtended: true,
    });
    expect(deriveExecutionState(true, 'ACTUATION_FAILURE_DEMO')).toMatchObject({
      q01: true,
      solenoidEnergized: true,
      cylinderExtended: false,
    });
  });

  it('records the output equals action misconception for the execution checkpoint', () => {
    expect(evaluateExecutionCheckpoint('actuation').isCorrect).toBe(true);
    expect(evaluateExecutionCheckpoint('control').conceptErrors).toEqual([
      'OUTPUT_EQUALS_ACTUATION_SUCCESS',
      'CONTROL_EXECUTION_CONFUSION',
    ]);
  });

  it('marks Stations 03 and 04 complete only after their registered knowledge points', () => {
    const progress = deriveLearningCenterProgress('mech-mechatronics-system', [
      ...(['K09', 'K10', 'K11', 'K12'] as const).map((knowledgePointId) =>
        event({ knowledgePointId, eventType: 'COMPLETE_KNOWLEDGE_POINT' }),
      ),
      ...(['K13', 'K14'] as const).map((knowledgePointId) =>
        event({
          stationId: 'station-04-actuation',
          knowledgePointId,
          eventType: 'COMPLETE_KNOWLEDGE_POINT',
        }),
      ),
    ]);
    expect(progress.stations['station-03-control'].status).toBe('completed');
    expect(progress.stations['station-04-actuation'].status).toBe('completed');
  });

  it('aggregates Station 03 and 04 results into existing profile dimensions', () => {
    const events = [
      event({ eventType: 'SUBMIT_MICRO_EXERCISE', isCorrect: true, payload: { exercise: 'M06' } }),
      event({ eventType: 'SUBMIT_MICRO_EXERCISE', isCorrect: false, payload: { exercise: 'M07' } }),
      event({
        stationId: 'station-04-actuation',
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: true,
        payload: { exercise: 'K14-checkpoint' },
      }),
    ];
    expect(calculateControlKnowledgeProfile(events)).toMatchObject({
      dimensions: { plcSignalAnalysis: 50, systemUnderstanding: 0 },
      sourceLabel: 'Knowledge Station 03',
      sourceAttempts: 2,
    });
    expect(calculateActuationKnowledgeProfile(events)).toMatchObject({
      dimensions: { systemUnderstanding: 100, actuationChain: 100 },
      sourceLabel: 'Knowledge Station 04',
      sourceAttempts: 1,
    });
  });
});
