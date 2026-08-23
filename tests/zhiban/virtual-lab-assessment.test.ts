import { describe, expect, it } from 'vitest';
import {
  calculateAssessment,
  createFallbackAssessmentFeedback,
  identifyErrorPatterns,
  mapRecommendations,
  mapWeakPoints,
  runAssessmentEvaluator,
  type AssessmentInput,
} from '@/lib/zhiban/virtual-lab/assessment';
import { buildTrainingContext } from '@/lib/zhiban/virtual-lab/ai/context';
import type { TrainingAction, TrainingHintRecord } from '@/lib/zhiban/virtual-lab/ai/types';
import { getMechLabActivity, MECH_LAB_ACTIVITY_ID, MECH_LAB_SAMPLE_COURSE_ID } from '@/lib/zhiban/virtual-lab/registry';

const activity = getMechLabActivity(MECH_LAB_SAMPLE_COURSE_ID, MECH_LAB_ACTIVITY_ID)!;

function action(name: string, value?: string | number): TrainingAction {
  return { timestamp: '2026-08-23T12:00:00.000Z', action: name, ...(value !== undefined ? { value } : {}), phase: 'inspection' };
}

function input(options: {
  actions?: TrainingAction[];
  hints?: TrainingHintRecord[];
  wrongActions?: string[];
  power?: boolean;
  output?: boolean;
  repaired?: boolean;
  verified?: boolean;
  attemptNumber?: number;
  previousAttemptSummary?: AssessmentInput['previousAttemptSummary'];
} = {}): AssessmentInput {
  const trainingContext = buildTrainingContext({
    activity,
    snapshot: {
      phase: options.verified ? 'completed' : options.repaired ? 'verification' : 'fault',
      operationalPhase: options.verified ? 'completed' : 'fault_waiting',
      systemRunning: false,
      workpiece: { detectedByS1: true, detectedByS2: true, position: { x: 1.35, y: 0.48, z: 0 } },
      sensors: { s1: false, s2: Boolean(options.repaired), s2Powered: true, s2Output: Boolean(options.repaired), s2Faulty: !options.repaired },
      motor: false, conveyor: false, cylinder: false,
      plc: { inputs: { s1: false, s2: Boolean(options.repaired) }, outputs: { motor: false, cylinder: false } },
      faultActive: !options.repaired,
      training: {
        measurements: { ...(options.power ? { s2Power: 24 } : {}), ...(options.output ? { s2Output: 0 } : {}) },
        wrongActions: options.wrongActions ?? [],
        repaired: options.repaired ?? false,
        verificationPassed: options.verified ?? false,
        elapsedMs: 85_000,
      },
    },
    actions: options.actions ?? [],
    hintHistory: options.hints ?? [],
  });
  return { trainingContext, attemptNumber: options.attemptNumber ?? 1, durationSeconds: 210, ...(options.previousAttemptSummary ? { previousAttemptSummary: options.previousAttemptSummary } : {}) };
}

const completeActions = [
  action('OPEN_PLC_MONITOR'), action('INSPECT_COMPONENT'), action('MEASURE_SENSOR_POWER'), action('MEASURE_SENSOR_OUTPUT'),
  action('SUBMIT_DIAGNOSIS', 'S2_OUTPUT_ABNORMAL'), action('REPLACE_COMPONENT'), action('RESTART_MACHINE'),
];

describe('Virtual Lab deterministic assessment', () => {
  it('scores a complete, systematic, no-hint path highly', () => {
    const assessment = calculateAssessment(input({ actions: completeActions, power: true, output: true, repaired: true, verified: true }));
    expect(assessment.overallScore).toBeGreaterThanOrEqual(95);
    expect(assessment.dimensions.evidenceReasoning.score).toBe(20);
    expect(assessment.strengthPatterns).toContain('SYSTEMATIC_DIAGNOSIS');
  });

  it('keeps correct guessing accurate but lowers evidence and procedure scores', () => {
    const assessment = calculateAssessment(input({ actions: [action('SUBMIT_DIAGNOSIS', 'S2_OUTPUT_ABNORMAL')], repaired: true, verified: true }));
    expect(assessment.dimensions.diagnosisAccuracy.score).toBe(30);
    expect(assessment.dimensions.evidenceReasoning.score).toBeLessThan(20);
    expect(assessment.dimensions.procedureQuality.score).toBeLessThan(20);
    expect(assessment.errorPatterns).toContain('BLIND_GUESS');
  });

  it('reduces diagnosis accuracy after multiple wrong diagnoses', () => {
    const assessment = calculateAssessment(input({ actions: completeActions, power: true, output: true, repaired: true, verified: true, wrongActions: ['WRONG_DIAGNOSIS', 'WRONG_DIAGNOSIS'] }));
    expect(assessment.dimensions.diagnosisAccuracy.score).toBe(20);
  });

  it('reduces independence after repeated level-3 hints', () => {
    const hints: TrainingHintRecord[] = [1, 2, 3].map((hintLevel) => ({ timestamp: `2026-08-23T12:00:0${hintLevel}.000Z`, hintLevel: 3, trainingPhase: 'inspection', diagnosisState: 'MEASUREMENT', message: '提示', actionsCountAtHint: 1, wrongActionsAtHint: 0, fallback: false }));
    const assessment = calculateAssessment(input({ actions: completeActions, hints, power: true, output: true, repaired: true, verified: true }));
    expect(assessment.dimensions.independence.score).toBeLessThanOrEqual(8);
    expect(assessment.errorPatterns).toContain('OVER_RELIANCE_ON_HINTS');
  });

  it('clearly deducts verification that was not completed', () => {
    const assessment = calculateAssessment(input({ actions: completeActions.slice(0, -1), power: true, output: true, repaired: true }));
    expect(assessment.dimensions.verification.score).toBe(4);
    expect(assessment.errorPatterns).toContain('INSUFFICIENT_VERIFICATION');
  });

  it('recognizes a full evidence chain', () => {
    const assessment = calculateAssessment(input({ actions: completeActions, power: true, output: true, repaired: true, verified: true }));
    expect(assessment.keyEvidenceCollected).toEqual(expect.arrayContaining(['工件到达S2', 'PLC I0.2检查', 'S2供电24V', 'S2输出0V']));
  });

  it('identifies skip patterns from a premature diagnosis', () => {
    const patterns = identifyErrorPatterns(input({ actions: [action('SUBMIT_DIAGNOSIS', 'S2_OUTPUT_ABNORMAL')] }).trainingContext);
    expect(patterns).toEqual(expect.arrayContaining(['BLIND_GUESS', 'SKIP_PLC_INSPECTION', 'SKIP_POWER_MEASUREMENT', 'SKIP_OUTPUT_MEASUREMENT']));
  });

  it('maps weak points to chapter recommendations', () => {
    const weakPoints = mapWeakPoints(['SKIP_PLC_INSPECTION', 'SKIP_OUTPUT_MEASUREMENT']);
    const recommendations = mapRecommendations(weakPoints);
    expect(weakPoints.map((item) => item.chapter)).toEqual(expect.arrayContaining(['第5章 系统控制技术', '第3章 传感检测与转换技术']));
    expect(recommendations[0]).toMatchObject({ recommendationType: 'review', priority: 'high' });
  });

  it('returns a complete deterministic evaluator fallback when AI fails', async () => {
    const assessment = calculateAssessment(input({ actions: completeActions, power: true, output: true, repaired: true, verified: true }));
    const feedback = await runAssessmentEvaluator(assessment, input().trainingContext, { generate: async () => { throw new Error('offline'); } });
    expect(feedback.fallback).toBe(true);
    expect(feedback.summary).toBeTruthy();
    expect(createFallbackAssessmentFeedback(assessment).nextStep).toBeTruthy();
  });

  it('keeps the total score inside 0 through 100 for adverse paths', () => {
    const assessment = calculateAssessment(input({ actions: [action('SUBMIT_DIAGNOSIS', 'PLC_PROGRAM')], wrongActions: ['WRONG_DIAGNOSIS', 'WRONG_DIAGNOSIS', 'RESTART_BEFORE_REPAIR', 'RESTART_BEFORE_REPAIR', 'IRRELEVANT_INSPECTION', 'IRRELEVANT_INSPECTION'] }));
    expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
    expect(assessment.overallScore).toBeLessThanOrEqual(100);
  });

  it('carries attempt number and prior-attempt comparison summary into retry assessment', () => {
    const assessment = calculateAssessment(input({ actions: completeActions, power: true, output: true, repaired: true, verified: true, attemptNumber: 2, previousAttemptSummary: { attemptNumber: 1, overallScore: 72, durationSeconds: 360, wrongActions: 2, hintsUsed: 3 } }));
    expect(assessment.attemptNumber).toBe(2);
    expect(assessment.previousAttemptSummary).toMatchObject({ overallScore: 72, hintsUsed: 3 });
  });
});
