import type { TrainingAction } from '@/lib/zhiban/virtual-lab/ai/types';

export type DiagnosisPathStage = '察' | '查' | '测' | '断' | '验';
export type DiagnosisPathMarker = 'evidence' | 'repeated' | 'error' | 'ai' | 'normal';

export interface DiagnosisPathNode {
  id: string;
  stage: DiagnosisPathStage;
  label: string;
  timestamp: string;
  marker: DiagnosisPathMarker;
}

export interface DiagnosisPathReplay {
  studentPath: DiagnosisPathNode[];
  standardPath: Array<{ stage: DiagnosisPathStage; label: string; completed: boolean; skipped: boolean }>;
}

const stageForAction: Record<string, DiagnosisPathStage> = {
  START_TRAINING: '察',
  START_SYSTEM: '察',
  CLICK_COMPONENT: '察',
  OPEN_PLC_MONITOR: '查',
  INSPECT_COMPONENT: '查',
  MEASURE_SENSOR_POWER: '测',
  MEASURE_SENSOR_OUTPUT: '测',
  SUBMIT_DIAGNOSIS: '断',
  WRONG_ACTION: '断',
  REPLACE_COMPONENT: '验',
  RESTART_MACHINE: '验',
  COMPLETE: '验',
};

const labels: Record<string, string> = {
  START_TRAINING: '观察生产线与停机现象',
  START_SYSTEM: '观察生产线与停机现象',
  CLICK_COMPONENT: '观察现场设备',
  OPEN_PLC_MONITOR: '查看 PLC I/O 状态',
  INSPECT_COMPONENT: '检查 S2 光电传感器',
  MEASURE_SENSOR_POWER: '测量 S2 供电',
  MEASURE_SENSOR_OUTPUT: '测量 S2 输出',
  SUBMIT_DIAGNOSIS: '提交故障判断',
  WRONG_ACTION: '错误判断或无效操作',
  REPLACE_COMPONENT: '维修 S2',
  RESTART_MACHINE: '重启并验证',
  COMPLETE: '验证生产恢复',
  REQUEST_HINT: '请求 AI 学习伙伴提示',
  RECEIVE_HINT: '收到 AI 学习伙伴提示',
};

const evidenceActions = new Set([
  'OPEN_PLC_MONITOR',
  'INSPECT_COMPONENT',
  'MEASURE_SENSOR_POWER',
  'MEASURE_SENSOR_OUTPUT',
  'RESTART_MACHINE',
  'COMPLETE',
]);

function isWrongDiagnosis(action: TrainingAction) {
  return action.action === 'SUBMIT_DIAGNOSIS' && action.value !== 'S2_OUTPUT_ABNORMAL';
}

export function buildDiagnosisPathReplay(actions: TrainingAction[]): DiagnosisPathReplay {
  const counts = new Map<string, number>();
  const studentPath: DiagnosisPathNode[] = [];
  for (const [index, action] of actions.entries()) {
    const ai = action.action === 'REQUEST_HINT' || action.action === 'RECEIVE_HINT';
    const stage = stageForAction[action.action] ?? (ai ? '断' : null);
    if (!stage || !labels[action.action]) continue;
    const occurrence = (counts.get(action.action) ?? 0) + 1;
    counts.set(action.action, occurrence);
    const marker: DiagnosisPathMarker =
      action.action === 'WRONG_ACTION' || isWrongDiagnosis(action)
        ? 'error'
        : ai
          ? 'ai'
          : occurrence > 1
            ? 'repeated'
            : evidenceActions.has(action.action)
              ? 'evidence'
              : 'normal';
    studentPath.push({
      id: `${action.timestamp}-${index}`,
      stage,
      label: labels[action.action] +
        (action.action.startsWith('MEASURE_') && action.value !== undefined
          ? `：${action.value}${action.unit ?? 'V'}`
          : ''),
      timestamp: action.timestamp,
      marker,
    });
  }
  const actionNames = new Set(actions.map((action) => action.action));
  const hasCorrectDiagnosis = actions.some(
    (action) => action.action === 'SUBMIT_DIAGNOSIS' && action.value === 'S2_OUTPUT_ABNORMAL',
  );
  const stageCompleted: Record<DiagnosisPathStage, boolean> = {
    察: actionNames.has('START_TRAINING') || actionNames.has('START_SYSTEM'),
    查: actionNames.has('OPEN_PLC_MONITOR') && actionNames.has('INSPECT_COMPONENT'),
    测: actionNames.has('MEASURE_SENSOR_POWER') && actionNames.has('MEASURE_SENSOR_OUTPUT'),
    断: hasCorrectDiagnosis,
    验:
      actionNames.has('REPLACE_COMPONENT') &&
      actionNames.has('RESTART_MACHINE') &&
      actionNames.has('COMPLETE'),
  };
  return {
    studentPath,
    standardPath: [
      ['察', '观察现场现象'],
      ['查', '检查 PLC 输入/输出'],
      ['测', '测量供电与输出'],
      ['断', '依据证据提交判断'],
      ['验', '维修后重启验证'],
    ].map(([stage, label]) => ({
      stage: stage as DiagnosisPathStage,
      label,
      completed: stageCompleted[stage as DiagnosisPathStage],
      skipped: !stageCompleted[stage as DiagnosisPathStage],
    })),
  };
}
