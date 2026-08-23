import { describe, expect, it } from 'vitest';
import { createMechLabInteractiveContent } from '@/lib/zhiban/virtual-lab/interactive-template';
import { getMechLabActivity, getMechLabSampleCourseStructure, MECH_LAB_ACTIVITY_ID, MECH_LAB_SAMPLE_COURSE_ID } from '@/lib/zhiban/virtual-lab/registry';
import {
  advanceLineStopState,
  applyLineStopAction,
  buildLineStopCompletionPayload,
  createLineStopInitialState,
  pauseLineStopSystem,
  resumeLineStopSystem,
  startLineStopSystem,
} from '@/lib/zhiban/virtual-lab/scenarios';
import { createMechLabMessage, isMechLabMessage, isMechLabMessageForContext, MECH_LAB_MESSAGE_SOURCE } from '@/lib/zhiban/virtual-lab/types';

describe('formal Virtual Lab activity', () => {
  const context = getMechLabActivity(MECH_LAB_SAMPLE_COURSE_ID, MECH_LAB_ACTIVITY_ID)!;

  it('exposes the minimal course entry with the prescribed context', () => {
    const structure = getMechLabSampleCourseStructure(MECH_LAB_SAMPLE_COURSE_ID);
    expect(context.scenarioId).toBe('line-stop-001');
    expect(context.title).toContain('自动输送系统智能故障诊断');
    expect(context.relatedChapterIds).toEqual(['mech-chapter-sensing', 'mech-chapter-control']);
    expect(structure?.modules[0]?.chapters[0]?.activities[0]?.activityType).toBe('virtual_lab');
  });

  it('accepts only structured protocol messages for the active activity', () => {
    const ready = createMechLabMessage(context, 'MECH_READY', { status: 'ready', rotation: 'running' });
    expect(ready.source).toBe(MECH_LAB_MESSAGE_SOURCE);
    expect(isMechLabMessage(ready)).toBe(true);
    expect(isMechLabMessageForContext(ready, context)).toBe(true);
    expect(isMechLabMessage({ type: 'MECH_READY' })).toBe(false);
    expect(isMechLabMessageForContext({ ...ready, activityId: 'other' }, context)).toBe(false);
  });

  it('builds the formal diagnostic WebGL scene with no test protocol', () => {
    const html = createMechLabInteractiveContent(context).html!;
    expect(html).toContain('光电传感器 S1');
    expect(html).toContain('PLC I/O 监控');
    expect(html).toContain('万用表测量');
    expect(html).toContain('开始新一轮实训');
    expect(html).toContain('重新启动验证');
    expect(html).toContain('MECH_READY');
    expect(html).toContain('MECH_REQUEST_HINT');
    expect(html).toContain('MECH_AI_HINT');
    expect(html).toContain('MECH_COMPLETE');
    expect(html).not.toContain('MECH_TEST_');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });

  it('runs a deterministic normal segment, then stops with physical S2 arrival but PLC I0.2 OFF', () => {
    let state = startLineStopSystem(createLineStopInitialState());
    expect(state.trainingPhase).toBe('running');
    expect(state.phase).toBe('feeding');
    expect(state.motor.running).toBe(true);

    state = advanceLineStopState(state, 900);
    expect(state.phase).toBe('s1_detected');
    expect(state.sensorS1.active).toBe(true);
    state = advanceLineStopState(state, 700);
    expect(state.phase).toBe('conveying');
    expect(state.conveyor.running).toBe(true);
    state = advanceLineStopState(state, 2100);

    expect(state.phase).toBe('fault_waiting');
    expect(state.trainingPhase).toBe('fault');
    expect(state.workpiece.detectedByS2).toBe(true);
    expect(state.sensorS2.powered).toBe(true);
    expect(state.sensorS2.output).toBe(false);
    expect(state.sensorS2.faulty).toBe(true);
    expect(state.plc.inputs.s2).toBe(false);
    expect(state.motor.running).toBe(false);
  });

  it('records PLC and meter evidence and does not accept an unsupported or wrong diagnosis', () => {
    let state = faultedState();
    state = applyLineStopAction(state, { type: 'SUBMIT_DIAGNOSIS', diagnosis: 'S2_OUTPUT_ABNORMAL' });
    expect(state.training.wrongActions).toContain('DIAGNOSIS_WITHOUT_EVIDENCE');
    expect(state.trainingPhase).not.toBe('completed');

    state = applyLineStopAction(state, { type: 'OPEN_PLC_MONITOR', target: 'plc' });
    state = applyLineStopAction(state, { type: 'INSPECT_COMPONENT', target: 'sensor_s2' });
    state = applyLineStopAction(state, { type: 'MEASURE_SENSOR_POWER', target: 'sensor_s2' });
    state = applyLineStopAction(state, { type: 'MEASURE_SENSOR_OUTPUT', target: 'sensor_s2' });
    expect(state.training.hasOpenedPlcMonitor).toBe(true);
    expect(state.training.inspectedComponents).toContain('sensor_s2');
    expect(state.training.measurements).toEqual({ s2Power: 24, s2Output: 0 });
    expect(state.trainingPhase).toBe('inspection');
    state = applyLineStopAction(state, { type: 'BEGIN_DIAGNOSIS' });
    expect(state.trainingPhase).toBe('diagnosis');

    state = applyLineStopAction(state, { type: 'SUBMIT_DIAGNOSIS', diagnosis: 'MOTOR_FAULT' });
    expect(state.training.wrongActions).toContain('WRONG_DIAGNOSIS');
    expect(state.trainingPhase).toBe('diagnosis');
  });

  it('requires repair before restart, restores I0.2 after S2 repair, and completes only after verification', () => {
    let state = evidenceReadyState();
    state = applyLineStopAction(state, { type: 'RESTART_MACHINE' });
    expect(state.training.wrongActions).toContain('RESTART_BEFORE_REPAIR');
    expect(state.phase).toBe('fault_waiting');

    state = applyLineStopAction(state, { type: 'SUBMIT_DIAGNOSIS', diagnosis: 'S2_OUTPUT_ABNORMAL' });
    expect(state.trainingPhase).toBe('repair');
    state = applyLineStopAction(state, { type: 'REPLACE_COMPONENT', target: 'sensor_s2' });
    expect(state.sensorS2.faulty).toBe(false);
    expect(state.sensorS2.output).toBe(true);
    expect(state.plc.inputs.s2).toBe(true);
    expect(state.trainingPhase).toBe('verification');

    state = applyLineStopAction(state, { type: 'RESTART_MACHINE' });
    expect(state.phase).toBe('s2_detected');
    state = advanceLineStopState(state, 700 + 900 + 800);
    expect(state.phase).toBe('completed');
    expect(state.trainingPhase).toBe('completed');
    expect(state.training.verificationPassed).toBe(true);

    expect(buildLineStopCompletionPayload(state)).toMatchObject({
      success: true,
      scenarioId: 'line-stop-001',
      activityId: 'mech-lab-line-stop',
      diagnosis: 'S2_OUTPUT_ABNORMAL',
      verificationPassed: true,
      hintsUsed: 0,
      measurements: { s2Power: 24, s2Output: 0 },
    });
  });

  it('pauses without advancing and reset clears fault evidence, records, and repair state', () => {
    let state = startLineStopSystem(createLineStopInitialState());
    state = advanceLineStopState(state, 300);
    const paused = pauseLineStopSystem(state);
    expect(advanceLineStopState(paused, 1_000)).toEqual(paused);
    expect(resumeLineStopSystem(paused).phase).toBe('feeding');

    state = evidenceReadyState();
    state = applyLineStopAction(state, { type: 'RESET_SYSTEM' });
    expect(state.phase).toBe('idle');
    expect(state.trainingPhase).toBe('intro');
    expect(state.fault.active).toBe(false);
    expect(state.sensorS2.faulty).toBe(true);
    expect(state.training.measurements).toEqual({});
    expect(state.training.actions).toEqual([]);
    expect(state.training.wrongActions).toEqual([]);
    expect(state.training.repaired).toBe(false);
  });
});

function faultedState() {
  let state = startLineStopSystem(createLineStopInitialState());
  state = advanceLineStopState(state, 900 + 700 + 2100);
  return state;
}

function evidenceReadyState() {
  let state = faultedState();
  state = applyLineStopAction(state, { type: 'OPEN_PLC_MONITOR', target: 'plc' });
  state = applyLineStopAction(state, { type: 'INSPECT_COMPONENT', target: 'sensor_s2' });
  state = applyLineStopAction(state, { type: 'MEASURE_SENSOR_POWER', target: 'sensor_s2' });
  state = applyLineStopAction(state, { type: 'MEASURE_SENSOR_OUTPUT', target: 'sensor_s2' });
  return applyLineStopAction(state, { type: 'BEGIN_DIAGNOSIS' });
}
