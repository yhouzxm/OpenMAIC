import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveVirtualLabGuidanceView,
  getScene,
  resolveVirtualLabActionFeedback,
  virtualLabErrorPatternMessage,
} from '@/lib/zhiban/scene-orchestration';
import type { TrainingAction } from '@/lib/zhiban/virtual-lab/ai/types';
import type { MechLabSceneStatePayload } from '@/lib/zhiban/virtual-lab/types';

const timestamp = '2026-08-30T08:00:00.000Z';

function action(actionName: string, value?: string | number): TrainingAction {
  return { timestamp, action: actionName, ...(value === undefined ? {} : { value }) };
}

function snapshot(
  training: NonNullable<MechLabSceneStatePayload['training']> = {},
): Partial<MechLabSceneStatePayload> {
  return {
    phase: 'fault',
    operationalPhase: 'fault_waiting',
    systemRunning: false,
    workpiece: { detectedByS1: true, detectedByS2: true },
    sensors: { s1: false, s2: false, s2Powered: true, s2Output: false, s2Faulty: true },
    motor: false,
    conveyor: false,
    cylinder: false,
    plc: {
      inputs: { s1: false, s2: false },
      outputs: { motor: false, cylinder: false },
    },
    faultActive: true,
    training,
  };
}

const start = action('START_TRAINING');
const plc = action('OPEN_PLC_MONITOR');
const power = action('MEASURE_SENSOR_POWER', 24);
const output = action('MEASURE_SENSOR_OUTPUT', 0);
const diagnosis = action('SUBMIT_DIAGNOSIS', 'S2_OUTPUT_ABNORMAL');
const repair = action('REPLACE_COMPONENT');
const restart = action('RESTART_MACHINE');

describe('Station 06 Virtual Lab teaching guidance', () => {
  it('registers complete guidance for S06-01 through S06-03', () => {
    for (const sceneId of ['S06-01', 'S06-02', 'S06-03'] as const) {
      const guidance = getScene(sceneId)?.guidance;
      expect(guidance?.task.trim()).toBeTruthy();
      expect(guidance?.objective?.trim()).toBeTruthy();
      expect(guidance?.observeItems?.length).toBeGreaterThan(0);
      expect(guidance?.operableTargets?.length).toBeGreaterThan(0);
      expect(guidance?.completionCriteria.length).toBeGreaterThan(0);
      expect(guidance?.completionFeedback?.trim()).toBeTruthy();
    }
  });

  it('does not reveal the S2 fault or measurement values in S06-01 briefing', () => {
    const guidance = JSON.stringify(getScene('S06-01')?.guidance);
    expect(guidance).not.toMatch(/S2故障|S2坏了|24\.0|0 V|正确答案/);
    expect(guidance).toContain('AI学习伙伴只提供提示');
  });

  it('does not complete observation merely because the page is open', () => {
    const view = deriveVirtualLabGuidanceView({ started: true, snapshot: {}, actions: [] });
    expect(view.currentStage).toBe('observe');
    expect(view.stages[0].status).toBe('current');
    expect(view.obtainedEvidence).toEqual([]);
  });

  it('completes observation only after a real start and the workpiece reaches S2', () => {
    const view = deriveVirtualLabGuidanceView({ started: true, snapshot: snapshot(), actions: [start] });
    expect(view.stages.find((item) => item.id === 'observe')?.status).toBe('completed');
    expect(view.currentStage).toBe('inspect');
    expect(view.obtainedEvidence).toContain('工件已到达检测位置');
  });

  it('requires a real PLC inspection before completing 查', () => {
    const before = deriveVirtualLabGuidanceView({ started: true, snapshot: snapshot(), actions: [start] });
    const after = deriveVirtualLabGuidanceView({ started: true, snapshot: snapshot(), actions: [start, plc] });
    expect(before.currentStage).toBe('inspect');
    expect(after.stages.find((item) => item.id === 'inspect')?.status).toBe('completed');
    expect(after.currentStage).toBe('measure');
  });

  it('keeps 测 current until both power and output are measured', () => {
    const partial = deriveVirtualLabGuidanceView({
      started: true,
      snapshot: snapshot({ measurements: { s2Power: 24 } }),
      actions: [start, plc, power],
    });
    expect(partial.currentStage).toBe('measure');
    expect(partial.obtainedEvidence).toContain('S2供电 = 24.0 V DC');
    expect(partial.obtainedEvidence.join(' ')).not.toContain('S2输出');
  });

  it('moves to 断 only after both deterministic measurements exist', () => {
    const view = deriveVirtualLabGuidanceView({
      started: true,
      snapshot: snapshot({ measurements: { s2Power: 24, s2Output: 0 } }),
      actions: [start, plc, power, output],
    });
    expect(view.currentStage).toBe('diagnose');
    expect(view.obtainedEvidence).toContain('S2输出 = 0 V');
  });

  it('does not treat an unsupported diagnosis attempt as completed 断', () => {
    const view = deriveVirtualLabGuidanceView({
      started: true,
      snapshot: snapshot({ measurements: { s2Power: 24, s2Output: 0 } }),
      actions: [start, plc, power, output, action('SUBMIT_DIAGNOSIS', 'PLC_PROGRAM')],
    });
    expect(view.currentStage).toBe('diagnose');
    expect(view.stages.find((item) => item.id === 'diagnose')?.status).toBe('current');
  });

  it('moves to 验 after the deterministic state accepts a diagnosis', () => {
    const view = deriveVirtualLabGuidanceView({
      started: true,
      snapshot: snapshot({
        measurements: { s2Power: 24, s2Output: 0 },
        diagnosis: 'S2_OUTPUT_ABNORMAL',
      }),
      actions: [start, plc, power, output, diagnosis],
    });
    expect(view.currentStage).toBe('verify');
    expect(view.completed).toBe(false);
  });

  it('keeps verification incomplete after repair but before restart', () => {
    const view = deriveVirtualLabGuidanceView({
      started: true,
      snapshot: snapshot({
        measurements: { s2Power: 24, s2Output: 0 },
        diagnosis: 'S2_OUTPUT_ABNORMAL',
        repaired: true,
        verificationPassed: false,
      }),
      actions: [start, plc, power, output, diagnosis, repair],
    });
    expect(view.repairCompleted).toBe(true);
    expect(view.verificationPassed).toBe(false);
    expect(view.currentStage).toBe('verify');
    expect(view.missingEvidence).toContain('维修后重新启动验证');
  });

  it('completes 验 only after restart and deterministic verification success', () => {
    const view = deriveVirtualLabGuidanceView({
      started: true,
      snapshot: snapshot({
        measurements: { s2Power: 24, s2Output: 0 },
        diagnosis: 'S2_OUTPUT_ABNORMAL',
        repaired: true,
        verificationPassed: true,
      }),
      actions: [start, plc, power, output, diagnosis, repair, restart],
    });
    expect(view.completed).toBe(true);
    expect(view.stages.every((item) => item.status === 'completed')).toBe(true);
  });

  it('reports I0.2 OFF without naming the failed component', () => {
    const feedback = resolveVirtualLabActionFeedback({
      action: 'OPEN_PLC_MONITOR', snapshot: snapshot(), actions: [start, plc],
    })!;
    expect(feedback.result).toBe('I0.2当前为OFF');
    expect(`${feedback.result}${feedback.nextFocus}`).not.toMatch(/S2坏了|S2故障/);
  });

  it('treats 24V only as supply evidence', () => {
    const feedback = resolveVirtualLabActionFeedback({
      action: 'MEASURE_SENSOR_POWER', value: 24, snapshot: snapshot(), actions: [start, plc, power],
    })!;
    expect(feedback.result).toBe('测量结果：24.0 V DC');
    expect(feedback.nextFocus).toContain('还不能据此判断传感器输出是否正常');
    expect(`${feedback.result}${feedback.nextFocus}`).not.toContain('S2故障');
  });

  it('reports 0V as output evidence without directly declaring the answer', () => {
    const feedback = resolveVirtualLabActionFeedback({
      action: 'MEASURE_SENSOR_OUTPUT', value: 0, snapshot: snapshot(), actions: [start, plc, power, output],
    })!;
    expect(feedback.result).toBe('测量结果：0 V');
    expect(feedback.nextFocus).toContain('PLC I0.2');
    expect(`${feedback.result}${feedback.nextFocus}`).not.toMatch(/S2坏了|S2故障|更换S2/);
  });

  it('explains a diagnosis attempted without output evidence', () => {
    const feedback = resolveVirtualLabActionFeedback({
      action: 'SUBMIT_DIAGNOSIS',
      value: 'PLC_PROGRAM',
      snapshot: snapshot({ measurements: { s2Power: 24 } }),
      actions: [start, plc, power, action('SUBMIT_DIAGNOSIS', 'PLC_PROGRAM')],
      consecutiveErrors: 1,
    })!;
    expect(feedback.result).toContain('缺少');
    expect(feedback.nextFocus).not.toContain('正确答案');
  });

  it('explains restart before repair and repair before verification separately', () => {
    const blocked = resolveVirtualLabActionFeedback({
      action: 'RESTART_MACHINE', snapshot: snapshot(), actions: [start, restart],
    })!;
    const repaired = resolveVirtualLabActionFeedback({
      action: 'REPLACE_COMPONENT',
      snapshot: snapshot({ diagnosis: 'S2_OUTPUT_ABNORMAL' }),
      actions: [start, diagnosis, repair],
    })!;
    expect(blocked.result).toContain('尚未完成维修');
    expect(repaired.nextFocus).toContain('重新启动系统进行验证');
  });

  it('turns existing Virtual Lab error patterns into student-facing language', () => {
    const patterns = [
      'SKIP_OUTPUT_MEASUREMENT',
      'SKIP_PLC_INSPECTION',
      'BLIND_GUESS',
      'INSUFFICIENT_VERIFICATION',
      'OVER_RELIANCE_ON_HINTS',
    ];
    for (const pattern of patterns) {
      const message = virtualLabErrorPatternMessage(pattern);
      expect(message).not.toContain(pattern);
      expect(message.length).toBeGreaterThan(8);
    }
  });

  it('eliminates the visible start and pause silent guards without changing their state truth', () => {
    const html = readFileSync(
      resolve(process.cwd(), 'lib/zhiban/virtual-lab/scenarios/line-stop-001-html.ts'),
      'utf8',
    );
    expect(html).not.toContain("if(state.trainingPhase!=='intro'&&state.trainingPhase!=='completed')return");
    expect(html).toContain('本轮实训正在进行');
    expect(html).toContain('系统当前未在运行，无需暂停');
    expect(html).toContain('aria-describedby="task"');
  });

  it('makes WebGL and disabled AI reasons visible at the host layer', () => {
    const runner = readFileSync(
      resolve(process.cwd(), 'components/zhiban/virtual-lab-runner.tsx'),
      'utf8',
    );
    expect(runner).toContain("payload.detail === 'webgl_unavailable'");
    expect(runner).toContain('当前浏览器无法正常启用3D实训环境');
    expect(runner).toContain('virtual-lab-coach-disabled-reason');
    expect(runner).toContain('开始实训后可使用AI学习伙伴');
  });

  it('invalidates obsolete AI responses on reset and remounts transient guidance', () => {
    const runner = readFileSync(
      resolve(process.cwd(), 'components/zhiban/virtual-lab-runner.tsx'),
      'utf8',
    );
    expect(runner).toContain('coachRequestRef.current += 1');
    expect(runner).toContain('attemptGenerationRef.current += 1');
    expect(runner).toContain('key={`${activeGuidanceSceneId}:${attemptGeneration}`}');
    expect(runner).toContain('setGuidanceFeedback(null)');
    expect(runner).toContain("setTrainingPhase('intro')");
  });

  it('keeps the iframe protocol message structure and Virtual Lab completion rules unchanged', () => {
    expect(getScene('S06-02')?.completionRule).toEqual({ type: 'virtual_lab_assessment' });
    expect(getScene('S06-03')?.completionRule).toEqual({ type: 'virtual_lab_assessment' });
    const protocol = readFileSync(resolve(process.cwd(), 'lib/zhiban/virtual-lab/types.ts'), 'utf8');
    expect(protocol).toContain("export const MECH_LAB_PROTOCOL_VERSION = '1.0' as const");
    expect(protocol).toContain("'MECH_READY'");
    expect(protocol).toContain("'MECH_COMPLETE'");
  });
});
