import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONCEPT_ERROR_STATION_MAP,
  DIAGNOSIS_SCENARIOS,
  aiModeForStation,
  buildTeacherLearningCenterAnalytics,
  calculateLearningCenterProfile,
  createLearningCenterAiFallback,
  deriveDiagnosisLearningMilestones,
  deriveLearningCenterProgress,
  evaluateM08,
  mapVirtualLabPhaseToDiagnosisStep,
  type LearningEvent,
} from '@/lib/zhiban/learning-center';
import type { VirtualLabAssessment } from '@/lib/zhiban/virtual-lab/assessment';
import type { PersistedVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence/types';

const courseId = 'mech-mechatronics-system';
function event(overrides: Partial<LearningEvent>): LearningEvent {
  return {
    id: crypto.randomUUID(),
    courseId,
    stationId: 'station-05-diagnosis',
    knowledgePointId: 'K15',
    eventType: 'VIEW_DIAGNOSIS_SCENARIO',
    payload: {},
    timestamp: '2026-08-25T08:00:00.000Z',
    ...overrides,
  };
}

function assessment(score = 90): VirtualLabAssessment {
  const dimension = (value: number, maxScore: number) => ({
    score: value,
    maxScore,
    reason: '真实过程证据',
  });
  return {
    overallScore: score,
    dimensions: {
      diagnosisAccuracy: dimension(27, 30),
      procedureQuality: dimension(22, 25),
      evidenceReasoning: dimension(18, 20),
      independence: dimension(13, 15),
      verification: dimension(10, 10),
    },
    durationSeconds: 240,
    actionsCount: 8,
    wrongActions: [],
    hintsUsed: 1,
    diagnosisAttempts: ['S2_OUTPUT_ABNORMAL'],
    keyEvidenceCollected: ['WORKPIECE_AT_S2', 'PLC_I02_OFF', 'S2_POWER_24V', 'S2_OUTPUT_0V'],
    errorPatterns: [],
    strengthPatterns: ['SYSTEMATIC_DIAGNOSIS'],
    weakPoints: [],
    recommendedContent: [],
    attemptNumber: 2,
  };
}

function session(attemptNumber: number, score: number): PersistedVirtualLabSession {
  return {
    id: `session-${attemptNumber}`,
    courseId,
    chapterId: 'chapter-3-5',
    activityId: 'mech-lab-line-stop',
    scenarioId: 'line-stop-001',
    attemptNumber,
    status: 'completed',
    startedAt: '2026-08-25T08:00:00.000Z',
    completedAt: '2026-08-25T08:04:00.000Z',
    durationSeconds: attemptNumber === 2 ? 240 : 360,
    overallScore: score,
    assessment: assessment(score),
    hintsUsed: attemptNumber === 2 ? 1 : 3,
    wrongActions: [],
    actionsCount: 8,
    verificationPassed: true,
  };
}

describe('Learning Center final diagnosis and assessment integration', () => {
  it('keeps Station 05 writes alive and merges slow persisted hydration with local progress', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'components/zhiban/diagnosis-assessment-learning-stations.tsx',
      ),
      'utf8',
    );
    const service = readFileSync(
      resolve(process.cwd(), 'lib/zhiban/learning-center/service.ts'),
      'utf8',
    );
    expect(source).toContain('keepalive: true');
    expect(source).toContain('body.diagnosisMilestones ??');
    expect(source).toContain('...new Set([...milestones.methodSteps, ...current])');
    expect(source).toContain('...milestones.completedScenarios');
    expect(source).toContain('...current');
    expect(service).toContain('diagnosisMilestones: deriveDiagnosisLearningMilestones(events)');
  });

  it('distinguishes sensing, control and actuation scenarios from evidence', () => {
    for (const scenario of DIAGNOSIS_SCENARIOS) {
      expect(evaluateM08(scenario, scenario.correctLayer, scenario.keyEvidence)).toMatchObject({
        isCorrect: true,
        correctLayer: scenario.correctLayer,
        conceptErrors: [],
      });
    }
    expect(evaluateM08(DIAGNOSIS_SCENARIOS[0], 'control', ['i02_off']).conceptErrors).toContain(
      'SENSING_LAYER_CONFUSION',
    );
    expect(evaluateM08(DIAGNOSIS_SCENARIOS[2], 'actuation', ['i02_on']).conceptErrors).toContain(
      'EVIDENCE_SELECTION_ERROR',
    );
  });

  it('maps internal phases to 察查测断验 without exposing phase names', () => {
    expect(mapVirtualLabPhaseToDiagnosisStep('fault')).toBe('observe');
    expect(mapVirtualLabPhaseToDiagnosisStep('inspection')).toBe('inspect');
    expect(mapVirtualLabPhaseToDiagnosisStep('measurement')).toBe('measure');
    expect(mapVirtualLabPhaseToDiagnosisStep('diagnosis')).toBe('diagnose');
    expect(mapVirtualLabPhaseToDiagnosisStep('verification')).toBe('verify');
  });

  it('uses one AI base with four explicit teaching modes', () => {
    expect(aiModeForStation('station-01-system')).toBe('knowledge_companion');
    expect(aiModeForStation('station-05-diagnosis')).toBe('cognitive_diagnosis');
    expect(aiModeForStation('station-06-virtual-lab')).toBe('training_coach');
    expect(aiModeForStation('station-07-assessment')).toBe('assessment_mentor');
    expect(createLearningCenterAiFallback('assessment_mentor')).toContain('最低能力维度');
    expect(createLearningCenterAiFallback('cognitive_diagnosis')).not.toContain('感知层故障');
  });

  it('completes Station 05 from explicit completion while preserving mistakes', () => {
    const events = [
      event({
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: false,
        payload: { exercise: 'M08', conceptErrors: ['CONTROL_LAYER_CONFUSION'] },
      }),
      event({ eventType: 'COMPLETE_KNOWLEDGE_POINT' }),
      event({ eventType: 'COMPLETE_STATION', knowledgePointId: undefined }),
    ];
    const progress = deriveLearningCenterProgress(courseId, events);
    expect(progress.stations['station-05-diagnosis'].status).toBe('completed');
    expect(progress.knowledgePoints.K15.correct).toBe(false);
  });

  it('restores Station 05 milestones without completing it after only one M08 scenario', () => {
    const events = [
      event({ eventType: 'SEQUENCE_STEP', payload: { step: 'observe' } }),
      event({
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: true,
        payload: { exercise: 'M08', scenarioType: 'sensing' },
      }),
    ];
    expect(deriveDiagnosisLearningMilestones(events)).toEqual({
      methodSteps: ['observe'],
      completedScenarios: { sensing: true },
      progressPercent: 25,
      completed: false,
    });
    const progress = deriveLearningCenterProgress(courseId, events);
    expect(progress.stations['station-05-diagnosis'].status).toBe('in_progress');
    expect(progress.stations['station-05-diagnosis'].progressPercent).toBe(25);
  });

  it('calculates transparent six-dimensional values and persistent retry improvement', () => {
    const events = [
      event({
        stationId: 'station-02-sensing',
        knowledgePointId: 'K06',
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: true,
        payload: { exercise: 'M04' },
      }),
      event({
        stationId: 'station-03-control',
        knowledgePointId: 'K10',
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: true,
        payload: { exercise: 'M06' },
      }),
      event({ eventType: 'SUBMIT_MICRO_EXERCISE', isCorrect: true, payload: { exercise: 'M08' } }),
    ];
    const profile = calculateLearningCenterProfile(courseId, events, [
      session(2, 90),
      session(1, 75),
    ]);
    expect(Object.keys(profile.dimensions)).toHaveLength(6);
    expect(profile.dimensions.plcSignalAnalysis.sources).toContain('最近一次 Virtual Lab PLC检查');
    expect(profile.dimensions.evidenceReasoning.evidenceCount).toBeGreaterThan(0);
    expect(profile.virtualLab).toMatchObject({
      attempts: 2,
      scoreChange: 15,
      durationChangeSeconds: -120,
      hintsChange: -2,
    });
  });

  it('maps concept errors to real remediation stations', () => {
    expect(CONCEPT_ERROR_STATION_MAP.POWER_EQUALS_SENSOR_NORMAL).toBe('station-02-sensing');
    expect(CONCEPT_ERROR_STATION_MAP.INPUT_OUTPUT_CONFUSION).toBe('station-03-control');
    expect(CONCEPT_ERROR_STATION_MAP.OUTPUT_EQUALS_ACTUATION_SUCCESS).toBe('station-04-actuation');
    expect(CONCEPT_ERROR_STATION_MAP.EVIDENCE_SELECTION_ERROR).toBe('station-05-diagnosis');
  });

  it('builds real teacher aggregates and never fabricates no-data percentages', () => {
    const empty = buildTeacherLearningCenterAnalytics([], [], []);
    expect(empty.enrolledStudents).toBe(0);
    expect(empty.participatingStudents).toBe(0);
    expect(empty.stationCompletion.every((item) => item.rate === null)).toBe(true);
    expect(empty.conceptErrors).toEqual([]);

    const aggregate = buildTeacherLearningCenterAnalytics(
      [
        {
          learnerId: 'student-1',
          stationId: 'station-02-sensing',
          eventType: 'COMPLETE_STATION',
          payload: {},
        },
        {
          learnerId: 'student-1',
          stationId: 'station-02-sensing',
          eventType: 'SUBMIT_MICRO_EXERCISE',
          payload: { conceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'] },
        },
        {
          learnerId: 'student-1',
          stationId: 'station-02-sensing',
          eventType: 'SUBMIT_MICRO_EXERCISE',
          payload: { conceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'] },
        },
      ],
      [{ userId: 'student-1', dimensions: { sensorDetection: 82 } }],
      ['student-1'],
      ['student-1', 'student-2'],
    );
    expect(aggregate.enrolledStudents).toBe(2);
    expect(aggregate.participatingStudents).toBe(1);
    expect(
      aggregate.stationCompletion.find((item) => item.stationId === 'station-02-sensing'),
    ).toMatchObject({ completedStudents: 1, totalStudents: 2, rate: 50 });
    expect(aggregate.dimensions.find((item) => item.key === 'sensorDetection')?.average).toBe(82);
    expect(aggregate.dimensions.find((item) => item.key === 'sensorDetection')).toMatchObject({
      evidenceStudents: 1,
      totalStudents: 2,
    });
    expect(aggregate.conceptErrors[0]).toMatchObject({ count: 1, percent: 50 });
    expect(aggregate.interventions[0]).toContain('感知探秘');
  });
});
