import type { AiLearningMode, ConceptErrorCode, StationId } from './types';

export const DIAGNOSIS_METHOD_STEPS = [
  { id: 'observe', label: '察', description: '观察现场现象' },
  { id: 'inspect', label: '查', description: '检查 PLC 输入/输出状态' },
  { id: 'measure', label: '测', description: '使用工具获取进一步证据' },
  { id: 'diagnose', label: '断', description: '基于证据进行故障判断' },
  { id: 'verify', label: '验', description: '维修后重新验证系统' },
] as const;

export type DiagnosisScenarioType = 'sensing' | 'control' | 'actuation';

export interface DiagnosisScenario {
  id: DiagnosisScenarioType;
  title: string;
  fieldState: string;
  inputState: string;
  outputState: string;
  correctLayer: DiagnosisScenarioType;
  keyEvidence: string[];
}

export const DIAGNOSIS_SCENARIOS: readonly DiagnosisScenario[] = [
  {
    id: 'sensing',
    title: '情境 A · 感知层线索',
    fieldState: '工件已经到达 S2 检测位置',
    inputState: 'PLC I0.2 = OFF',
    outputState: 'Q0.1 尚未触发',
    correctLayer: 'sensing',
    keyEvidence: ['workpiece_at_s2', 'i02_off'],
  },
  {
    id: 'control',
    title: '情境 B · 控制层线索',
    fieldState: '工件已经到位，S2 检测有效',
    inputState: 'PLC I0.2 = ON',
    outputState: 'PLC Q0.1 = OFF',
    correctLayer: 'control',
    keyEvidence: ['i02_on', 'q01_off'],
  },
  {
    id: 'actuation',
    title: '情境 C · 执行层线索',
    fieldState: '气缸没有动作',
    inputState: 'PLC I0.2 = ON',
    outputState: 'PLC Q0.1 = ON',
    correctLayer: 'actuation',
    keyEvidence: ['q01_on', 'cylinder_no_motion'],
  },
] as const;

const layerError: Record<DiagnosisScenarioType, ConceptErrorCode> = {
  sensing: 'SENSING_LAYER_CONFUSION',
  control: 'CONTROL_LAYER_CONFUSION',
  actuation: 'ACTUATION_LAYER_CONFUSION',
};

export function evaluateM08(
  scenario: DiagnosisScenario,
  selectedLayer: string,
  selectedEvidence: string[],
) {
  const layerCorrect = selectedLayer === scenario.correctLayer;
  const evidenceCorrect = scenario.keyEvidence.every((item) => selectedEvidence.includes(item));
  const conceptErrors: ConceptErrorCode[] = [];
  if (!layerCorrect) conceptErrors.push(layerError[scenario.correctLayer]);
  if (!evidenceCorrect) conceptErrors.push('EVIDENCE_SELECTION_ERROR');
  return {
    correctLayer: scenario.correctLayer,
    layerCorrect,
    evidenceCorrect,
    isCorrect: layerCorrect && evidenceCorrect,
    conceptErrors,
  };
}

export type DiagnosisMethodStep = (typeof DIAGNOSIS_METHOD_STEPS)[number]['id'];

export function mapVirtualLabPhaseToDiagnosisStep(phase: string): DiagnosisMethodStep {
  if (['intro', 'running', 'fault', 'observation'].includes(phase)) return 'observe';
  if (['inspection', 'signal_inspection'].includes(phase)) return 'inspect';
  if (['measurement'].includes(phase)) return 'measure';
  if (['diagnosis'].includes(phase)) return 'diagnose';
  return 'verify';
}

export const CONCEPT_ERROR_STATION_MAP: Record<ConceptErrorCode, StationId> = {
  POWER_EQUALS_SENSOR_NORMAL: 'station-02-sensing',
  INPUT_OUTPUT_CONFUSION: 'station-03-control',
  FIELD_IO_MAPPING_ERROR: 'station-03-control',
  PLC_SCAN_SEQUENCE_ERROR: 'station-03-control',
  LADDER_LOGIC_CONFUSION: 'station-03-control',
  CONTROL_EXECUTION_CONFUSION: 'station-04-actuation',
  OUTPUT_EQUALS_ACTUATION_SUCCESS: 'station-04-actuation',
  SENSING_LAYER_CONFUSION: 'station-05-diagnosis',
  CONTROL_LAYER_CONFUSION: 'station-05-diagnosis',
  ACTUATION_LAYER_CONFUSION: 'station-05-diagnosis',
  EVIDENCE_SELECTION_ERROR: 'station-05-diagnosis',
};

export function aiModeForStation(stationId: StationId) {
  if (stationId === 'station-05-diagnosis') return 'cognitive_diagnosis' as const;
  if (stationId === 'station-06-virtual-lab') return 'training_coach' as const;
  if (stationId === 'station-07-assessment') return 'assessment_mentor' as const;
  return 'knowledge_companion' as const;
}

export function createLearningCenterAiFallback(mode: AiLearningMode) {
  if (mode === 'cognitive_diagnosis')
    return '请沿“现场状态—PLC输入—PLC输出—机械动作”逐段比较，指出信号最先在哪一段出现不一致。';
  if (mode === 'assessment_mentor')
    return '请优先回学最低能力维度对应的学习站，完成微练习后再进入综合实训验证提升。';
  if (mode === 'training_coach')
    return '请根据当前现场、PLC与测量证据继续完成实训；不要只凭单一现象作出结论。';
  return '请先观察现场设备，再说明它是在获取信息、作出控制，还是执行机械动作。';
}
