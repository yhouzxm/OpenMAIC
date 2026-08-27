import { describe, expect, it } from 'vitest';

import { buildDiagnosisPathReplay } from '@/lib/zhiban/virtual-lab/assessment/path-replay';
import type { TrainingAction } from '@/lib/zhiban/virtual-lab/ai/types';

function action(actionName: string, seconds: number, value?: string | number): TrainingAction {
  return {
    action: actionName,
    timestamp: new Date(Date.UTC(2026, 7, 27, 0, 0, seconds)).toISOString(),
    value,
  };
}

describe('Virtual Lab 专家诊断路径回放', () => {
  it('完整循证过程会完成察查测断验五个标准步骤', () => {
    const replay = buildDiagnosisPathReplay([
      action('START_TRAINING', 0),
      action('OPEN_PLC_MONITOR', 2),
      action('INSPECT_COMPONENT', 3),
      action('MEASURE_SENSOR_POWER', 4, 24),
      action('MEASURE_SENSOR_OUTPUT', 5, 0),
      action('SUBMIT_DIAGNOSIS', 6, 'S2_OUTPUT_ABNORMAL'),
      action('REPLACE_COMPONENT', 7),
      action('RESTART_MACHINE', 8),
      action('COMPLETE', 9),
    ]);

    expect(replay.standardPath).toHaveLength(5);
    expect(replay.standardPath.every((step) => step.completed && !step.skipped)).toBe(true);
    expect(replay.studentPath.map((node) => node.stage)).toEqual([
      '察',
      '查',
      '查',
      '测',
      '测',
      '断',
      '验',
      '验',
      '验',
    ]);
  });

  it('保留重复步骤、错误判断和AI介入点，而不只显示最终答案', () => {
    const replay = buildDiagnosisPathReplay([
      action('START_TRAINING', 0),
      action('RESTART_MACHINE', 1),
      action('RESTART_MACHINE', 2),
      action('OPEN_PLC_MONITOR', 3),
      action('REQUEST_HINT', 4),
      action('MEASURE_SENSOR_POWER', 5, 24),
      action('SUBMIT_DIAGNOSIS', 6, 'PLC_PROGRAM_ERROR'),
      action('MEASURE_SENSOR_OUTPUT', 7, 0),
      action('SUBMIT_DIAGNOSIS', 8, 'S2_OUTPUT_ABNORMAL'),
    ]);

    expect(replay.studentPath.some((node) => node.marker === 'repeated')).toBe(true);
    expect(replay.studentPath.some((node) => node.marker === 'error')).toBe(true);
    expect(replay.studentPath.some((node) => node.marker === 'ai')).toBe(true);
    expect(replay.standardPath.find((step) => step.stage === '验')?.skipped).toBe(true);
  });

  it('只测量供电时不会把完整测量证据链标记为完成', () => {
    const replay = buildDiagnosisPathReplay([
      action('START_TRAINING', 0),
      action('OPEN_PLC_MONITOR', 1),
      action('INSPECT_COMPONENT', 2),
      action('MEASURE_SENSOR_POWER', 3, 24),
    ]);

    expect(replay.standardPath.find((step) => step.stage === '测')).toMatchObject({
      completed: false,
      skipped: true,
    });
  });
});
