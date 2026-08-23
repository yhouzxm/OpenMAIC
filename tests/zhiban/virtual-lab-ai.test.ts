import { describe, expect, it } from 'vitest';
import {
  buildTrainingContext,
  determineHintLevel,
  getFallbackHint,
  runTrainingCoach,
  type BuildTrainingContextInput,
  type TrainingAction,
} from '@/lib/zhiban/virtual-lab/ai';
import {
  getMechLabActivity,
  MECH_LAB_ACTIVITY_ID,
  MECH_LAB_SAMPLE_COURSE_ID,
} from '@/lib/zhiban/virtual-lab/registry';
import type { MechLabSceneStatePayload } from '@/lib/zhiban/virtual-lab/types';

const activity = getMechLabActivity(MECH_LAB_SAMPLE_COURSE_ID, MECH_LAB_ACTIVITY_ID)!;

function action(actionName: string, value?: string | number): TrainingAction {
  return { timestamp: '2026-08-23T00:00:00.000Z', action: actionName, value, phase: 'inspection' };
}

function context(options: {
  actions?: TrainingAction[];
  measurements?: { s2Power?: number; s2Output?: number };
  wrongActions?: string[];
  repaired?: boolean;
  verificationPassed?: boolean;
  diagnosis?: string | null;
} = {}) {
  const snapshot: MechLabSceneStatePayload = {
    phase: options.repaired ? 'verification' : 'fault',
    operationalPhase: 'fault_waiting',
    systemRunning: false,
    workpiece: { detectedByS1: true, detectedByS2: true, position: { x: 1.35, y: 0.48, z: 0 } },
    sensors: { s1: false, s2: false, s2Powered: true, s2Output: Boolean(options.repaired), s2Faulty: !options.repaired },
    motor: false,
    conveyor: false,
    cylinder: false,
    plc: { inputs: { s1: false, s2: Boolean(options.repaired) }, outputs: { motor: false, cylinder: false } },
    faultActive: !options.repaired,
    training: {
      inspectedComponents: options.measurements ? ['sensor_s2'] : [],
      measurements: options.measurements ?? {},
      wrongActions: options.wrongActions ?? [],
      diagnosis: options.diagnosis ?? null,
      repaired: options.repaired ?? false,
      verificationPassed: options.verificationPassed ?? false,
      elapsedMs: 65_000,
    },
  };
  const input: BuildTrainingContextInput = { activity, snapshot, actions: options.actions ?? [] };
  return buildTrainingContext(input);
}

describe('state-aware Virtual Lab AI coach', () => {
  it('keeps a first no-evidence hint at observation level without exposing S2', () => {
    const training = context();
    expect(determineHintLevel(training)).toBe(1);
    expect(getFallbackHint(training, 1)).not.toContain('S2');
  });

  it('uses I0.2 as the next scaffold after PLC monitor inspection', () => {
    const training = context({ actions: [action('OPEN_PLC_MONITOR')] });
    expect(determineHintLevel(training)).toBe(2);
    expect(getFallbackHint(training, 2)).toContain('I0.2');
  });

  it('guides output measurement after 24V power evidence', () => {
    const training = context({ actions: [action('OPEN_PLC_MONITOR')], measurements: { s2Power: 24 } });
    expect(getFallbackHint(training, 2)).toContain('输出端证据');
  });

  it('asks the learner to form a diagnosis after 24V and 0V evidence', () => {
    const training = context({ actions: [action('OPEN_PLC_MONITOR')], measurements: { s2Power: 24, s2Output: 0 } });
    const hint = getFallbackHint(training, 2);
    expect(hint).toContain('自己判断');
    expect(hint).not.toContain('正确答案');
  });

  it('corrects a wrong diagnosis using existing evidence without revealing the answer', () => {
    const training = context({
      actions: [action('OPEN_PLC_MONITOR'), action('SUBMIT_DIAGNOSIS', 'PLC_PROGRAM')],
      measurements: { s2Power: 24, s2Output: 0 },
      wrongActions: ['WRONG_DIAGNOSIS'],
    });
    const hint = getFallbackHint(training, 2);
    expect(hint).toContain('重新比较');
    expect(hint).not.toMatch(/S2\s*(?:故障|坏了)/);
  });

  it('guides verification after a correct repair', () => {
    const training = context({
      actions: [action('SUBMIT_DIAGNOSIS', 'S2_OUTPUT_ABNORMAL')],
      measurements: { s2Power: 24, s2Output: 0 },
      repaired: true,
      diagnosis: 'S2_OUTPUT_ABNORMAL',
    });
    expect(getFallbackHint(training, 2)).toContain('重新启动');
  });

  it('escalates to level 3 after repeated wrong actions', () => {
    const training = context({ wrongActions: ['WRONG_DIAGNOSIS', 'RESTART_BEFORE_REPAIR'] });
    expect(determineHintLevel(training)).toBe(3);
  });

  it('falls back without blocking when the provider throws', async () => {
    const response = await runTrainingCoach(context(), { generate: async () => { throw new Error('provider down'); } });
    expect(response.fallback).toBe(true);
    expect(response.notice).toContain('已切换至教学提示模式');
    expect(response.message).toBeTruthy();
  });

  it('filters a provider response that directly leaks the answer', async () => {
    const response = await runTrainingCoach(context(), { generate: async () => 'S2输出异常，更换S2即可。' });
    expect(response.fallback).toBe(true);
    expect(response.message).not.toMatch(/S2输出异常|更换S2即可/);
  });

  it('builds current PLC, measurement, behavior, evidence and optional profile context', () => {
    const training = buildTrainingContext({
      activity,
      snapshot: {
        ...context({ measurements: { s2Power: 24, s2Output: 0 } }).state,
        phase: 'inspection',
        systemRunning: false,
        sensors: { s1: false, s2: false, s2Powered: true, s2Output: false, s2Faulty: true },
        motor: false,
        conveyor: false,
        cylinder: false,
        plc: { inputs: { s1: false, s2: false }, outputs: { motor: false, cylinder: false } },
        training: { measurements: { s2Power: 24, s2Output: 0 }, elapsedMs: 65_000 },
      },
      actions: [action('OPEN_PLC_MONITOR')],
      learningProfile: { plcKnowledgeMastery: 0.3, sensorKnowledgeMastery: 0.7, weakPoints: ['PLC I/O对应'] },
    });
    expect(training.state.plc.inputs.s2).toBe(false);
    expect(training.behavior.measurements).toEqual({ s2Power: 24, s2Output: 0 });
    expect(training.evidence).toMatchObject({ plcI02: false, powerMeasured: true, outputMeasured: true });
    expect(training.learningProfile?.plcKnowledgeMastery).toBe(0.3);
  });
});
