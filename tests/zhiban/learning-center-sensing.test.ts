import { describe, expect, it } from 'vitest';
import {
  calculateSensingKnowledgeProfile,
  deriveLearningCenterProgress,
  deriveSensingState,
  evaluateM03,
  evaluateM04,
  evaluateM05,
  type LearningEvent,
} from '@/lib/zhiban/learning-center';

function event(overrides: Partial<LearningEvent>): LearningEvent {
  return {
    id: crypto.randomUUID(),
    courseId: 'mech-mechatronics-system',
    stationId: 'station-02-sensing',
    knowledgePointId: 'K04',
    eventType: 'VIEW_KNOWLEDGE_POINT',
    payload: {},
    timestamp: '2026-08-24T12:00:00.000Z',
    ...overrides,
  };
}

describe('Station 02 sensing knowledge model', () => {
  it('links workpiece position, S2 output and PLC I0.2 in normal mode', () => {
    expect(deriveSensingState('before')).toMatchObject({
      sensorActive: false,
      outputVoltage: 0,
      plcI02: false,
    });
    expect(deriveSensingState('inside')).toMatchObject({
      sensorActive: true,
      outputVoltage: 24,
      plcI02: true,
    });
    expect(deriveSensingState('after')).toMatchObject({
      sensorActive: false,
      outputVoltage: 0,
      plcI02: false,
    });
  });

  it('keeps 24V supply while the no-output knowledge demo leaves I0.2 off', () => {
    expect(deriveSensingState('inside', 'NO_OUTPUT_DEMO')).toMatchObject({
      poweredVoltage: 24,
      sensorActive: true,
      outputVoltage: 0,
      plcI02: false,
    });
  });

  it('scores M03 predictions against the real sensor state', () => {
    expect(evaluateM03(true, deriveSensingState('inside')).isCorrect).toBe(true);
    expect(evaluateM03(true, deriveSensingState('before')).isCorrect).toBe(false);
  });

  it('records the 24V equals sensor normal misconception for M04', () => {
    expect(evaluateM04('B')).toEqual({ isCorrect: true });
    expect(evaluateM04('A')).toEqual({
      isCorrect: false,
      conceptError: 'POWER_EQUALS_SENSOR_NORMAL',
    });
  });

  it('uses the full evidence chain for M05', () => {
    expect(evaluateM05('B')).toMatchObject({
      isCorrect: true,
      evidenceUsed: expect.arrayContaining(['s2Power24V', 's2Output0V', 'plcI02Off']),
    });
    expect(evaluateM05('C').isCorrect).toBe(false);
  });

  it('completes Station 02 only after K04 through K08 are completed', () => {
    const events = (['K04', 'K05', 'K06', 'K07', 'K08'] as const).map((knowledgePointId, index) =>
      event({
        knowledgePointId,
        eventType: 'COMPLETE_KNOWLEDGE_POINT',
        timestamp: `2026-08-24T12:0${index}:00.000Z`,
      }),
    );
    const progress = deriveLearningCenterProgress('mech-mechatronics-system', events);
    expect(progress.stations['station-02-sensing']).toMatchObject({
      status: 'completed',
      progressPercent: 100,
    });
  });

  it('aggregates profile dimensions across attempts instead of using one result', () => {
    const profile = calculateSensingKnowledgeProfile([
      event({
        knowledgePointId: 'K05',
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: true,
        payload: { exercise: 'M03' },
      }),
      event({
        knowledgePointId: 'K05',
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: false,
        payload: { exercise: 'M03' },
      }),
      event({
        knowledgePointId: 'K06',
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: true,
        payload: { exercise: 'M04' },
      }),
      event({
        knowledgePointId: 'K07',
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: true,
        payload: { exercise: 'M05' },
      }),
    ]);
    expect(profile).toMatchObject({
      sensorDetection: 50,
      toolMeasurement: 100,
      plcSignalAnalysis: 100,
      sourceLabel: 'Knowledge Station 02',
      sourceAttempts: 4,
    });
  });
});
