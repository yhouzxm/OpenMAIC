import { describe, expect, it } from 'vitest';
import { calculateLearningCenterProfile, type LearningEvent } from '@/lib/zhiban/learning-center';
import {
  deriveConceptErrorStates,
  deriveRemediationRuns,
  resolveRemediationScene,
  resolveVirtualLabRemediation,
  sanitizeRemediationExplanation,
} from '@/lib/zhiban/scene-orchestration';

const base = {
  currentSceneId: 'S02-03' as const,
  stationId: 'station-02-sensing' as const,
  currentCheckpoint: 'M04',
  contextMode: 'SELF_LEARNING' as const,
};

function learningEvent(eventType: LearningEvent['eventType'], payload: Record<string, unknown>, timestamp: string, isCorrect?: boolean): LearningEvent {
  return {
    id: `${eventType}-${timestamp}`,
    courseId: 'mech-mechatronics-system',
    stationId: 'station-02-sensing',
    knowledgePointId: 'K06',
    eventType,
    payload,
    isCorrect,
    timestamp,
  };
}

describe('deterministic smart remediation', () => {
  it.each([
    ['POWER_EQUALS_SENSOR_NORMAL', 'S02-03'],
    ['INPUT_OUTPUT_CONFUSION', 'S03-01'],
    ['FIELD_IO_MAPPING_ERROR', 'S03-02'],
    ['PLC_SCAN_SEQUENCE_ERROR', 'S03-03'],
    ['LADDER_LOGIC_CONFUSION', 'S03-04'],
    ['OUTPUT_EQUALS_ACTUATION_SUCCESS', 'S04-03'],
    ['SENSING_LAYER_CONFUSION', 'S05-02'],
    ['CONTROL_LAYER_CONFUSION', 'S05-03'],
    ['ACTUATION_LAYER_CONFUSION', 'S05-04'],
    ['EVIDENCE_SELECTION_ERROR', 'S05-01'],
  ] as const)('maps %s to %s', (code, sceneId) => {
    expect(resolveRemediationScene({ ...base, conceptErrors: [code] })?.sceneId).toBe(sceneId);
  });

  it('returns one stable primary scene for multiple errors', () => {
    const input = {
      ...base,
      conceptErrors: ['FIELD_IO_MAPPING_ERROR', 'INPUT_OUTPUT_CONFUSION'] as Array<
        'FIELD_IO_MAPPING_ERROR' | 'INPUT_OUTPUT_CONFUSION'
      >,
      attemptHistory: [
        { code: 'FIELD_IO_MAPPING_ERROR' as const, count: 4 },
        { code: 'INPUT_OUTPUT_CONFUSION' as const, count: 1 },
      ],
    };
    const first = resolveRemediationScene(input);
    const second = resolveRemediationScene(input);
    expect(first?.sceneId).toBe('S03-01');
    expect(second).toEqual(first);
    expect(first?.triggerConceptErrors).toHaveLength(2);
  });

  it('uses the same resolver for Virtual Lab process patterns', () => {
    expect(resolveVirtualLabRemediation(['SKIP_OUTPUT_MEASUREMENT'])?.sceneId).toBe('S02-03');
    expect(resolveVirtualLabRemediation(['SKIP_PLC_INSPECTION'])?.sceneId).toBe('S03-02');
    expect(resolveVirtualLabRemediation(['BLIND_GUESS'])?.sceneId).toBe('S05-01');
    expect(resolveVirtualLabRemediation(['OVER_RELIANCE_ON_HINTS'])).toBeNull();
  });

  it('does not let AI output modify the deterministic scene path', () => {
    const recommendation = resolveRemediationScene({ ...base, conceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'] })!;
    const output = sanitizeRemediationExplanation({
      message: '请改去 S07-03，模型认为那里更好。',
      guidingQuestion: 'S03-04 可以吗？',
      sceneId: 'S07-03',
    }, recommendation);
    expect(recommendation.sceneId).toBe('S02-03');
    expect(output.remediationMessage).not.toContain('S07-03');
    expect(output.guidingQuestion).not.toContain('S03-04');
  });

  it('tracks ACTIVE → IMPROVING → RESOLVED without deleting history', () => {
    const shared = {
      remediationRunId: 'run-1', sourceSceneId: 'S02-03', targetSceneId: 'S02-03',
      retryTarget: 'M04', returnSceneId: 'S02-03', contextMode: 'SELF_LEARNING',
      triggerConceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'],
    };
    const events = [
      learningEvent('SUBMIT_MICRO_EXERCISE', { exercise: 'M04', conceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'] }, '2026-08-27T01:00:00.000Z', false),
      learningEvent('REMEDIATION_RECOMMENDED', shared, '2026-08-27T01:00:01.000Z'),
      learningEvent('REMEDIATION_SCENE_ENTERED', shared, '2026-08-27T01:00:02.000Z'),
      learningEvent('REMEDIATION_SCENE_COMPLETED', shared, '2026-08-27T01:00:03.000Z', true),
      learningEvent('REMEDIATION_RETRY_STARTED', shared, '2026-08-27T01:00:04.000Z'),
      learningEvent('REMEDIATION_RETRY_COMPLETED', { ...shared, resolvedConceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'], newConceptErrors: [] }, '2026-08-27T01:00:05.000Z', true),
    ];
    expect(deriveConceptErrorStates(events)).toEqual([
      expect.objectContaining({ code: 'POWER_EQUALS_SENSOR_NORMAL', status: 'RESOLVED', occurrences: 1 }),
    ]);
    expect(deriveRemediationRuns(events)[0]).toMatchObject({ status: 'RESOLVED', retryTarget: 'M04' });
  });

  it('reopens a resolved misconception when a later real attempt repeats it', () => {
    const resolved = learningEvent('REMEDIATION_RETRY_COMPLETED', {
      remediationRunId: 'run-1', targetSceneId: 'S02-03', resolvedConceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'],
    }, '2026-08-27T01:00:02.000Z', true);
    const initial = learningEvent('SUBMIT_MICRO_EXERCISE', { conceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'] }, '2026-08-27T01:00:01.000Z', false);
    const repeated = learningEvent('SUBMIT_MICRO_EXERCISE', { conceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'] }, '2026-08-27T01:00:03.000Z', false);
    expect(deriveConceptErrorStates([initial, resolved, repeated])[0]).toMatchObject({ status: 'REOPENED', occurrences: 2 });
  });

  it('keeps classroom mode compatible without changing its API', () => {
    expect(resolveRemediationScene({
      ...base,
      conceptErrors: ['INPUT_OUTPUT_CONFUSION'],
      contextMode: 'CLASSROOM',
    })).toMatchObject({ sceneId: 'S03-01', contextMode: 'CLASSROOM' });
  });

  it('does not raise the learner profile merely for entering or completing remediation', () => {
    const wrong = learningEvent(
      'SUBMIT_MICRO_EXERCISE',
      { exercise: 'M04', conceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'] },
      '2026-08-27T02:00:00.000Z',
      false,
    );
    const shared = {
      remediationRunId: 'run-profile', sourceSceneId: 'S02-03', targetSceneId: 'S02-03',
      retryTarget: 'M04', returnSceneId: 'S02-03', contextMode: 'SELF_LEARNING',
      triggerConceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'],
    };
    const entered = learningEvent('REMEDIATION_SCENE_ENTERED', shared, '2026-08-27T02:00:01.000Z');
    const completed = learningEvent('REMEDIATION_SCENE_COMPLETED', shared, '2026-08-27T02:00:02.000Z', true);
    const before = calculateLearningCenterProfile('mech-mechatronics-system', [wrong], []);
    const afterEntry = calculateLearningCenterProfile('mech-mechatronics-system', [wrong, entered, completed], []);
    expect(afterEntry.dimensions.toolMeasurement.score).toBe(before.dimensions.toolMeasurement.score);

    const retry = learningEvent(
      'SUBMIT_MICRO_EXERCISE',
      { exercise: 'M04', conceptErrors: [] },
      '2026-08-27T02:00:03.000Z',
      true,
    );
    const afterRealRetry = calculateLearningCenterProfile('mech-mechatronics-system', [wrong, entered, completed, retry], []);
    expect(afterRealRetry.dimensions.toolMeasurement.score).toBeGreaterThan(afterEntry.dimensions.toolMeasurement.score);
  });
});
