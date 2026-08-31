import type {
  ConceptErrorCode,
  LearningEvent,
} from '@/lib/zhiban/learning-center/types';
import type { SceneDefinition, SceneId } from './types';
import type { TrainingAction } from '@/lib/zhiban/virtual-lab/ai/types';
import type { MechLabSceneStatePayload } from '@/lib/zhiban/virtual-lab/types';

export type SceneGuidanceMode = 'FULL' | 'COMPACT' | 'MINIMAL';
export type SceneGuidanceFeedbackTone = 'info' | 'success' | 'warning';

export interface SceneGuidanceTarget {
  id: string;
  label: string;
  action: string;
}

export interface SceneGuidanceFeedbackDefinition {
  message: string;
  nextObservation?: string;
}

export interface SceneGuidanceDefinition {
  task: string;
  objective?: string;
  observeItems?: string[];
  operableTargets?: SceneGuidanceTarget[];
  firstActionPrompt?: string;
  completionCriteria: string[];
  estimatedMinutes?: number;
  successFeedback?: string;
  completionFeedback?: string;
  errorFeedback?: Record<string, SceneGuidanceFeedbackDefinition>;
}

export interface SceneGuidanceState {
  sceneId: string;
  visitCount: number;
  actionCount: number;
  consecutiveErrors: number;
  completed: boolean;
  mastered: boolean;
  hintLevel: 0 | 1 | 2 | 3;
  mode: SceneGuidanceMode;
  lastFeedback?: {
    tone: SceneGuidanceFeedbackTone;
    action?: string;
    result?: string;
    nextFocus?: string;
    targetId?: string;
  };
}

export interface SceneActionFeedback {
  action: string;
  result: string;
  nextFocus: string;
  tone: 'neutral' | 'success' | 'warning';
  targetId?: string;
}

export type VirtualLabGuidanceStageId = 'observe' | 'inspect' | 'measure' | 'diagnose' | 'verify';
export type VirtualLabGuidanceStageStatus = 'not_started' | 'current' | 'completed';

export interface VirtualLabGuidanceStage {
  id: VirtualLabGuidanceStageId;
  label: '察' | '查' | '测' | '断' | '验';
  description: string;
  status: VirtualLabGuidanceStageStatus;
}

export interface VirtualLabGuidanceView {
  currentStage: VirtualLabGuidanceStageId;
  currentTask: string;
  stages: VirtualLabGuidanceStage[];
  obtainedEvidence: string[];
  missingEvidence: string[];
  completed: boolean;
  repairCompleted: boolean;
  verificationPassed: boolean;
}

export interface GuidanceConceptErrorState {
  code: ConceptErrorCode;
  status: 'ACTIVE' | 'IMPROVING' | 'RESOLVED' | 'REOPENED';
}

export interface GuidanceErrorInput {
  errorCode: string;
  consecutiveErrors: number;
  missingEvidence?: string;
  compareFocus?: string;
  nextOperation?: string;
}

export interface GuidanceHelpRequest {
  sceneId: SceneId;
  requestId: string;
}

export interface GuidanceHelpResponse extends GuidanceHelpRequest {
  message: string;
}

type GuidanceCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

let fallbackRequestSequence = 0;

/**
 * Generate a correlation id in secure and non-secure browser contexts.
 * Some browsers do not expose crypto.randomUUID() over plain HTTP/IP access.
 */
export function createGuidanceRequestId(
  cryptoApi: GuidanceCrypto | undefined = globalThis.crypto,
) {
  try {
    if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  } catch {
    // Fall through when randomUUID is blocked by the browser security context.
  }
  try {
    if (typeof cryptoApi?.getRandomValues === 'function') {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    // The id is only used to correlate UI responses, not as a security token.
  }
  fallbackRequestSequence += 1;
  return `guidance-${Date.now().toString(36)}-${fallbackRequestSequence.toString(36)}`;
}

const nonActionEvents = new Set([
  'ENTER_SCENE',
  'VIEW_KNOWLEDGE_POINT',
  'REQUEST_AI_HELP',
  'COMPLETE_SCENE',
  'COMPLETE_KNOWLEDGE_POINT',
  'COMPLETE_STATION',
]);

const errorDefaults: Record<
  string,
  { missingEvidence: string; compareFocus: string; nextOperation: string }
> = {
  M01_WRONG_TARGET: {
    missingEvidence: '设备的检测作用',
    compareFocus: '各设备的主要作用与“检测工件到位”这一任务',
    nextOperation: '在3D场景中查看负责获取工件位置信息的设备',
  },
  PREDICTION_MISMATCH: {
    missingEvidence: '工件是否真正进入S2检测区域',
    compareFocus: '工件位置、S2状态与PLC I0.2',
    nextOperation: '重新选择一个位置，先预测S2状态，再点击验证',
  },
  CLASSIFICATION_ROLE_MISMATCH: {
    missingEvidence: '设备接收的输入和产生的输出',
    compareFocus: '设备是在获取现场信息、作出控制决策，还是执行机械动作',
    nextOperation: '逐个查看设备的输入与输出，再重新提交分类',
  },
  SEQUENCE_CAUSALITY_ERROR: {
    missingEvidence: '正常生产步骤之间的因果关系',
    compareFocus: '现场变化、PLC获得输入与执行机构动作的先后顺序',
    nextOperation: '先把“工件进入”放在检测之前，再沿信号传递方向继续排序',
  },
  LADDER_LOGIC_CONFUSION: {
    missingEvidence: 'I0.2触点是否满足导通条件',
    compareFocus: 'I0.2触点、信号路径与Q0.1线圈',
    nextOperation: '先确认I0.2状态，再依次执行INPUT、LOGIC、OUTPUT扫描',
  },
  POWER_EQUALS_SENSOR_NORMAL: {
    missingEvidence: '传感器输出端状态',
    compareFocus: 'S2供电、输出与PLC I0.2',
    nextOperation: '继续测量S2输出端，再观察I0.2是否同步变化',
  },
  INPUT_OUTPUT_CONFUSION: {
    missingEvidence: '信号进入或离开PLC的方向',
    compareFocus: '现场设备、PLC输入I与PLC输出Q',
    nextOperation: '沿信号箭头判断该信号是进入PLC还是从PLC输出',
  },
  FIELD_IO_MAPPING_ERROR: {
    missingEvidence: '现场信号进入PLC的方向',
    compareFocus: '现场传感器与PLC输入地址',
    nextOperation: '先确认S2属于现场检测元件，再寻找接收该信号的PLC输入点',
  },
  PLC_SCAN_SEQUENCE_ERROR: {
    missingEvidence: 'PLC扫描阶段的前置状态',
    compareFocus: '读取输入、执行逻辑与刷新输出的先后关系',
    nextOperation: '先读取输入，再执行程序逻辑，最后刷新输出',
  },
  CONTROL_EXECUTION_CONFUSION: {
    missingEvidence: '执行链中间状态与最终机械动作',
    compareFocus: 'PLC控制结果、执行链传递和气缸真实动作',
    nextOperation: '从PLC输出之后沿电磁阀、气路和气缸逐级检查',
  },
  OUTPUT_EQUALS_ACTUATION_SUCCESS: {
    missingEvidence: '气缸是否真实完成机械动作',
    compareFocus: 'PLC输出、电磁阀、气路与气缸状态',
    nextOperation: '从Q0.1之后沿执行链逐级检查，不要把控制输出当作最终动作',
  },
  EVIDENCE_SELECTION_ERROR: {
    missingEvidence: '形成判断所需的前置事实',
    compareFocus: '现场现象、信号状态、测量数据与最终判断',
    nextOperation: '先观察，再查信号，再获取测量数据，最后形成判断并验证',
  },
  SENSING_LAYER_CONFUSION: {
    missingEvidence: '现场状态与PLC输入之间的对应关系',
    compareFocus: '工件现场状态、PLC输入与两者之间的感知链',
    nextOperation: '继续检查现场变化是否已经通过检测链传到PLC输入',
  },
  CONTROL_LAYER_CONFUSION: {
    missingEvidence: 'PLC输入、逻辑结果和输出状态之间的关系',
    compareFocus: 'PLC输入、控制逻辑与PLC输出',
    nextOperation: '输入已进入PLC时，继续检查逻辑条件与输出刷新是否符合预期',
  },
  ACTUATION_LAYER_CONFUSION: {
    missingEvidence: '控制信号是否已到达执行链',
    compareFocus: 'PLC输出与执行机构实际状态',
    nextOperation: '输出正常但机构未动作时，沿执行链继续检查中间环节',
  },
  DIAGNOSIS_WITHOUT_EVIDENCE: {
    missingEvidence: '支持当前判断的PLC与测量证据',
    compareFocus: '工件位置、PLC I0.2、S2供电与输出',
    nextOperation: '先打开PLC I/O，再获取S2供电和输出两项测量证据',
  },
  WRONG_DIAGNOSIS: {
    missingEvidence: '现场检测链的测量证据',
    compareFocus: '工件位置、S2状态与PLC I0.2',
    nextOperation: '继续检查S2供电和输出，再判断异常发生在哪一段',
  },
};

const virtualLabStageDefinitions: ReadonlyArray<
  Omit<VirtualLabGuidanceStage, 'status'>
> = [
  { id: 'observe', label: '察', description: '观察现场异常' },
  { id: 'inspect', label: '查', description: '查看PLC与信号状态' },
  { id: 'measure', label: '测', description: '获取供电和输出证据' },
  { id: 'diagnose', label: '断', description: '根据证据形成判断' },
  { id: 'verify', label: '验', description: '维修后确认系统恢复' },
];

const virtualLabTasks: Record<VirtualLabGuidanceStageId, string> = {
  observe: '先观察工件停在哪里，以及生产线发生了什么异常。',
  inspect: '打开PLC I/O，比较现场状态与输入信号。',
  measure: '使用测量工具获取S2供电与输出两项证据。',
  diagnose: '结合现场、PLC和测量证据形成故障判断。',
  verify: '维修后重新启动，确认PLC输入和生产流程是否真正恢复。',
};

function hasAction(actions: readonly TrainingAction[], action: string) {
  return actions.some((item) => item.action === action);
}

function lastActionValue(actions: readonly TrainingAction[], action: string) {
  return [...actions].reverse().find((item) => item.action === action)?.value;
}

/**
 * A read-only projection over the deterministic Virtual Lab FSM and action history.
 * It never advances the simulation and never infers evidence from merely opening the page.
 */
export function deriveVirtualLabGuidanceView(input: {
  started: boolean;
  snapshot: Partial<MechLabSceneStatePayload>;
  actions: readonly TrainingAction[];
}): VirtualLabGuidanceView {
  const { snapshot, actions } = input;
  const training = snapshot.training ?? {};
  const operationalPhase = snapshot.operationalPhase ?? 'idle';
  const trainingStarted =
    hasAction(actions, 'START_TRAINING') ||
    (input.started && operationalPhase !== 'idle' && snapshot.phase !== 'intro');
  const workpieceAtS2 = Boolean(
    snapshot.workpiece?.detectedByS2 ||
      operationalPhase === 'fault_waiting' ||
      operationalPhase === 's2_detected',
  );
  const observed = trainingStarted && workpieceAtS2;
  const plcInspected = hasAction(actions, 'OPEN_PLC_MONITOR');
  const powerMeasured = hasAction(actions, 'MEASURE_SENSOR_POWER');
  const outputMeasured = hasAction(actions, 'MEASURE_SENSOR_OUTPUT');
  const diagnosisCompleted = Boolean(training.diagnosis);
  const repairCompleted = Boolean(training.repaired);
  const restarted = hasAction(actions, 'RESTART_MACHINE');
  const verificationPassed = Boolean(training.verificationPassed) && restarted;
  const completedByStage: Record<VirtualLabGuidanceStageId, boolean> = {
    observe: observed,
    inspect: plcInspected,
    measure: powerMeasured && outputMeasured,
    diagnose: diagnosisCompleted,
    verify: verificationPassed,
  };
  const currentStage =
    virtualLabStageDefinitions.find((stage) => !completedByStage[stage.id])?.id ?? 'verify';
  const stages = virtualLabStageDefinitions.map((stage) => ({
    ...stage,
    status: completedByStage[stage.id]
      ? ('completed' as const)
      : stage.id === currentStage
        ? ('current' as const)
        : ('not_started' as const),
  }));

  const obtainedEvidence: string[] = [];
  if (observed) obtainedEvidence.push('工件已到达检测位置');
  if (plcInspected)
    obtainedEvidence.push(`PLC I0.2 = ${snapshot.plc?.inputs.s2 ? 'ON' : 'OFF'}`);
  if (powerMeasured) {
    const value = Number(lastActionValue(actions, 'MEASURE_SENSOR_POWER') ?? training.measurements?.s2Power);
    if (Number.isFinite(value)) obtainedEvidence.push(`S2供电 = ${value.toFixed(1)} V DC`);
  }
  if (outputMeasured) {
    const value = Number(lastActionValue(actions, 'MEASURE_SENSOR_OUTPUT') ?? training.measurements?.s2Output);
    if (Number.isFinite(value))
      obtainedEvidence.push(`S2输出 = ${value === 0 ? '0' : value.toFixed(1)} V`);
  }
  if (diagnosisCompleted) obtainedEvidence.push('已形成故障判断');
  if (repairCompleted) obtainedEvidence.push('已完成维修处理');
  if (verificationPassed) obtainedEvidence.push('已完成维修后验证');

  const missingEvidence: string[] = [];
  if (!observed) missingEvidence.push('现场异常观察');
  if (observed && !plcInspected) missingEvidence.push('PLC I0.2状态');
  if (plcInspected && !powerMeasured) missingEvidence.push('S2供电测量');
  if (plcInspected && !outputMeasured) missingEvidence.push('S2输出测量');
  if (powerMeasured && outputMeasured && !diagnosisCompleted) missingEvidence.push('基于证据的故障判断');
  if (diagnosisCompleted && !repairCompleted) missingEvidence.push('维修处理');
  if (repairCompleted && !verificationPassed) missingEvidence.push('维修后重新启动验证');

  return {
    currentStage,
    currentTask: virtualLabTasks[currentStage],
    stages,
    obtainedEvidence,
    missingEvidence,
    completed: verificationPassed,
    repairCompleted,
    verificationPassed,
  };
}

export function resolveVirtualLabActionFeedback(input: {
  action: string;
  value?: string | number;
  snapshot: Partial<MechLabSceneStatePayload>;
  actions: readonly TrainingAction[];
  consecutiveErrors?: number;
}): SceneActionFeedback | null {
  const view = deriveVirtualLabGuidanceView({
    started: true,
    snapshot: input.snapshot,
    actions: input.actions,
  });
  if (input.action === 'START_TRAINING')
    return {
      action: '已启动自动输送系统',
      result: '工件正在进入生产线。',
      nextFocus: '观察工件最终停在哪里，以及后续动作是否发生。',
      tone: 'neutral',
    };
  if (input.action === 'PAUSE_SYSTEM')
    return input.snapshot.systemRunning
      ? {
          action: '已暂停生产线',
          result: '输送带和电机已停止运行。',
          nextFocus: '需要继续观察时，可重新开始或重置本轮实训。',
          tone: 'neutral',
        }
      : {
          action: '已尝试暂停',
          result: '系统当前未在运行，无需再次暂停。',
          nextFocus: '继续当前诊断任务，或在需要时重置场景。',
          tone: 'warning',
        };
  if (input.action === 'OPEN_PLC_MONITOR') {
    const i02 = input.snapshot.plc?.inputs.s2 ? 'ON' : 'OFF';
    return {
      action: '已查看PLC输入状态',
      result: `I0.2当前为${i02}`,
      nextFocus:
        view.obtainedEvidence.includes('工件已到达检测位置') && i02 === 'OFF'
          ? '现场工件已经到位，但PLC没有收到对应输入。下一步需要继续检查现场检测链。'
          : '把PLC输入状态与工件现场位置进行比较。',
      tone: 'neutral',
    };
  }
  if (input.action === 'INSPECT_COMPONENT')
    return {
      action: '已检查S2光电传感器',
      result: '已打开可用的检测工具。',
      nextFocus: '分别获取供电和输出证据，不要只根据单一测量下结论。',
      tone: 'neutral',
    };
  if (input.action === 'MEASURE_SENSOR_POWER')
    return {
      action: '已测量S2供电',
      result: `测量结果：${Number(input.value ?? 24).toFixed(1)} V DC`,
      nextFocus: '这说明供电回路基本正常，但还不能据此判断传感器输出是否正常。',
      tone: 'neutral',
    };
  if (input.action === 'MEASURE_SENSOR_OUTPUT') {
    const value = Number(input.value ?? 0);
    return {
      action: '已测量S2输出',
      result: `测量结果：${value === 0 ? '0' : value.toFixed(1)} V`,
      nextFocus: '可以把输出状态与PLC I0.2进行比较，判断现场信号是否正常进入PLC。',
      tone: 'neutral',
    };
  }
  if (input.action === 'SUBMIT_DIAGNOSIS')
    return view.missingEvidence.some((item) => item.includes('PLC') || item.includes('测量'))
      ? resolveGuidanceForError({
          errorCode: 'DIAGNOSIS_WITHOUT_EVIDENCE',
          consecutiveErrors: input.consecutiveErrors ?? 1,
        })
      : {
          action: '已提交故障判断',
          result: '系统已按当前证据核对该判断。',
          nextFocus: '观察判断是否足以支持后续维修。',
          tone: 'neutral',
        };
  if (input.action === 'REPLACE_COMPONENT')
    return {
      action: '已完成维修操作',
      result: '设备已完成当前维修处理。',
      nextFocus: '维修完成并不能自动证明故障已经排除。下一步需要重新启动系统进行验证。',
      tone: 'success',
    };
  if (input.action === 'RESTART_MACHINE')
    return input.snapshot.training?.repaired
      ? {
          action: '已重新启动生产线',
          result: '系统正在执行维修后验证流程。',
          nextFocus: '观察PLC I0.2与生产流程是否真正恢复。',
          tone: 'neutral',
        }
      : {
          action: '已尝试重新启动',
          result: '系统尚未完成维修，当前重新启动不能验证故障是否排除。',
          nextFocus: '先形成可由证据支持的故障判断，并完成必要维修。',
          tone: 'warning',
        };
  if (input.action === 'WRONG_ACTION') {
    const code = String(input.value ?? '');
    if (code === 'MEASURE_BEFORE_INSPECTION')
      return {
        action: '已尝试使用测量工具',
        result: '尚未进入S2设备检查，当前无法确认测量对象。',
        nextFocus: '先在3D场景中选择S2，再使用虚拟万用表。',
        tone: 'warning',
      };
    if (code === 'REPAIR_WITHOUT_DIAGNOSIS')
      return {
        action: '已尝试进行维修',
        result: '维修前还没有形成可由证据支持的故障判断。',
        nextFocus: '请先完成PLC检查和必要测量，再提交判断。',
        tone: 'warning',
      };
    if (code === 'RESTART_BEFORE_REPAIR')
      return {
        action: '已尝试重新启动',
        result: '系统尚未完成维修，当前重启不能构成有效验证。',
        nextFocus: '先完成诊断与维修，再通过重新启动确认恢复结果。',
        tone: 'warning',
      };
    return resolveGuidanceForError({
      errorCode: code,
      consecutiveErrors: input.consecutiveErrors ?? 1,
    });
  }
  return null;
}

export function virtualLabErrorPatternMessage(pattern: string) {
  const messages: Record<string, string> = {
    SKIP_OUTPUT_MEASUREMENT: '你的判断缺少输出端测量证据。',
    SKIP_POWER_MEASUREMENT: '你在形成判断前缺少传感器供电状态证据。',
    SKIP_PLC_INSPECTION: '你尚未利用PLC输入状态缩小故障范围。',
    BLIND_GUESS: '当前判断形成得过早，还没有建立完整证据链。',
    REPEATED_RESTART: '本次存在重复无效重启，建议先确认故障证据和维修状态。',
    INSUFFICIENT_VERIFICATION: '维修完成后还缺少重新启动验证。',
    OVER_RELIANCE_ON_HINTS: '本次较多依赖提示。再次挑战时可以尝试减少求助，先独立完成证据收集。',
    REPEATED_IRRELEVANT_INSPECTION: '本次存在重复无关检查，建议优先获取与当前信号链直接相关的证据。',
    DIAGNOSIS_WITHOUT_EVIDENCE: '当前判断还缺少必要的PLC或测量证据。',
    WRONG_DIAGNOSIS: '当前证据尚不能支持这个故障判断。',
    REPAIR_WITHOUT_DIAGNOSIS: '维修前还需要先形成可由证据支持的故障判断。',
    RESTART_BEFORE_REPAIR: '系统尚未完成维修，当前重启不能构成有效验证。',
    MEASURE_BEFORE_INSPECTION: '请先确认检测对象，再使用虚拟测量工具。',
    IRRELEVANT_INSPECTION: '当前检查对象未能补充支持诊断的关键证据。',
  };
  return messages[pattern] ?? '请回顾现场、PLC、测量与验证证据是否完整。';
}

const conceptErrorStudentLabels: Record<ConceptErrorCode, string> = {
  POWER_EQUALS_SENSOR_NORMAL: '供电正常与传感器整体正常的区分',
  INPUT_OUTPUT_CONFUSION: 'PLC输入与输出方向的区分',
  FIELD_IO_MAPPING_ERROR: '现场设备与PLC地址的对应',
  PLC_SCAN_SEQUENCE_ERROR: 'PLC读取输入、执行逻辑与更新输出的顺序',
  LADDER_LOGIC_CONFUSION: '梯形图触点与线圈的信号传递',
  CONTROL_EXECUTION_CONFUSION: '控制输出与执行机构动作的区分',
  OUTPUT_EQUALS_ACTUATION_SUCCESS: '有PLC输出与机械动作成功的区分',
  SENSING_LAYER_CONFUSION: '现场状态与感知层信号的关系',
  CONTROL_LAYER_CONFUSION: 'PLC输入、逻辑与输出的控制层关系',
  ACTUATION_LAYER_CONFUSION: '控制信号与执行层真实动作的关系',
  EVIDENCE_SELECTION_ERROR: '形成故障判断时的关键证据选择',
};

export function conceptErrorStudentLabel(code: ConceptErrorCode) {
  return conceptErrorStudentLabels[code];
}

export function conceptErrorStatusLabel(status: GuidanceConceptErrorState['status']) {
  return {
    ACTIVE: '需要重点巩固',
    IMPROVING: '正在改善',
    RESOLVED: '本轮已验证掌握',
    REOPENED: '再次出现，需要重新巩固',
  }[status];
}

function eventSceneId(event: LearningEvent): string | null {
  return typeof event.payload?.sceneId === 'string' ? event.payload.sceneId : null;
}

function exerciseId(event: LearningEvent): string | null {
  return typeof event.payload?.exercise === 'string' ? event.payload.exercise : null;
}

function relevantEvents(definition: SceneDefinition, events: LearningEvent[]) {
  const knowledgePointIds = new Set(definition.completionRule.knowledgePointIds ?? []);
  const exerciseIds = new Set(definition.completionRule.exerciseIds ?? []);
  return events.filter((event) => {
    if (eventSceneId(event) === definition.id) return true;
    if (event.knowledgePointId && knowledgePointIds.has(event.knowledgePointId)) return true;
    const exercise = exerciseId(event);
    return Boolean(exercise && exerciseIds.has(exercise));
  });
}

function isDefinitionCompleted(definition: SceneDefinition, events: LearningEvent[]) {
  if (
    events.some(
      (event) => event.eventType === 'COMPLETE_SCENE' && eventSceneId(event) === definition.id,
    )
  )
    return true;
  const knowledgePointIds = definition.completionRule.knowledgePointIds ?? [];
  return (
    knowledgePointIds.length > 0 &&
    knowledgePointIds.every((knowledgePointId) =>
      events.some(
        (event) =>
          event.knowledgePointId === knowledgePointId &&
          (event.eventType === 'COMPLETE_KNOWLEDGE_POINT' ||
            (event.eventType === 'SUBMIT_MICRO_EXERCISE' && event.isCorrect === true)),
      ),
    )
  );
}

function consecutiveIncorrectAttempts(events: LearningEvent[]) {
  let count = 0;
  for (const event of [...events].reverse()) {
    if (typeof event.isCorrect !== 'boolean') continue;
    if (event.isCorrect) break;
    count += 1;
  }
  return count;
}

function latestChallengeResult(events: LearningEvent[]) {
  return [...events].reverse().find((event) => typeof event.isCorrect === 'boolean')?.isCorrect;
}

export function resolveSceneGuidanceMode(input: {
  visitCount: number;
  consecutiveErrors: number;
  completed: boolean;
  latestChallengeCorrect?: boolean;
  hasActiveConceptError?: boolean;
}): Pick<SceneGuidanceState, 'mode' | 'mastered' | 'hintLevel'> {
  const hasActiveConceptError = input.hasActiveConceptError === true;
  const mastered =
    input.completed && input.latestChallengeCorrect === true && !hasActiveConceptError;
  const hintLevel: 0 | 1 | 2 | 3 = hasActiveConceptError
    ? Math.max(1, Math.min(3, input.consecutiveErrors || 1)) as 1 | 2 | 3
    : Math.min(3, input.consecutiveErrors) as 0 | 1 | 2 | 3;
  if (!input.completed || hasActiveConceptError || input.consecutiveErrors >= 2)
    return { mode: 'FULL', mastered, hintLevel };
  if (mastered) return { mode: 'MINIMAL', mastered, hintLevel };
  return { mode: 'COMPACT', mastered, hintLevel };
}

export function deriveSceneGuidanceState(
  definition: SceneDefinition,
  events: LearningEvent[],
  conceptErrorStates: readonly GuidanceConceptErrorState[] = [],
): SceneGuidanceState {
  const scoped = relevantEvents(definition, events).sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const visitCount = scoped.filter(
    (event) => event.eventType === 'ENTER_SCENE' && eventSceneId(event) === definition.id,
  ).length;
  const actionCount = scoped.filter((event) => !nonActionEvents.has(event.eventType)).length;
  const consecutiveErrors = consecutiveIncorrectAttempts(scoped);
  const completed = isDefinitionCompleted(definition, events);
  const relatedErrors = new Set(definition.remediationFor);
  const hasActiveConceptError = conceptErrorStates.some(
    (item) =>
      relatedErrors.has(item.code) && (item.status === 'ACTIVE' || item.status === 'REOPENED'),
  );
  const mode = resolveSceneGuidanceMode({
    visitCount,
    consecutiveErrors,
    completed,
    latestChallengeCorrect: latestChallengeResult(scoped),
    hasActiveConceptError,
  });
  return {
    sceneId: definition.id,
    visitCount,
    actionCount,
    consecutiveErrors,
    completed,
    ...mode,
  };
}

export function deriveSceneGuidanceStates(
  definitions: readonly SceneDefinition[],
  events: LearningEvent[],
  conceptErrorStates: readonly GuidanceConceptErrorState[] = [],
): Partial<Record<SceneId, SceneGuidanceState>> {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.id,
      deriveSceneGuidanceState(definition, events, conceptErrorStates),
    ]),
  );
}

export function resolveGuidanceForError(input: GuidanceErrorInput): SceneActionFeedback {
  const defaults = errorDefaults[input.errorCode] ?? {
    missingEvidence: '支持当前判断的关键证据',
    compareFocus: '当前操作结果与任务目标',
    nextOperation: '重新观察当前可操作对象并获取一项新证据',
  };
  const missingEvidence = input.missingEvidence ?? defaults.missingEvidence;
  const compareFocus = input.compareFocus ?? defaults.compareFocus;
  const nextOperation = input.nextOperation ?? defaults.nextOperation;
  const level = Math.min(3, Math.max(1, input.consecutiveErrors));
  if (level === 1)
    return {
      action: '已提交当前判断',
      result: `当前判断还缺少${missingEvidence}。`,
      nextFocus: '先补充证据，再决定是否调整判断。',
      tone: 'warning',
    };
  if (level === 2)
    return {
      action: '再次尝试了当前任务',
      result: `这次需要重点比较${compareFocus}。`,
      nextFocus: '观察这些状态是否同时成立，再重新判断。',
      tone: 'warning',
    };
  return {
    action: '已进行多次尝试',
    result: '系统已提供更具体的操作支架。',
    nextFocus: nextOperation,
    tone: 'warning',
  };
}

export function shouldAutoOpenSceneBriefing(state: SceneGuidanceState) {
  return state.mode === 'FULL' && state.visitCount === 0 && !state.completed;
}

export function reduceSceneBriefingVisibility(
  current: boolean,
  action: 'AUTO_OPEN' | 'OPEN' | 'CLOSE' | 'TOGGLE',
  state?: SceneGuidanceState,
) {
  if (action === 'OPEN') return true;
  if (action === 'CLOSE') return false;
  if (action === 'TOGGLE') return !current;
  return state ? shouldAutoOpenSceneBriefing(state) : current;
}

export function resolveSceneEntryDecision(input: {
  lastRecordedKey: string | null;
  courseId: string;
  sceneId: SceneId;
  previewMode?: boolean;
}) {
  const key = `${input.courseId}:${input.sceneId}`;
  return {
    key,
    shouldRecord: !input.previewMode && input.lastRecordedKey !== key,
  };
}

export function isCurrentGuidanceHelpResponse(input: {
  currentSceneId: SceneId;
  latestRequestId: string | null;
  responseSceneId: SceneId;
  responseRequestId: string;
}) {
  return (
    input.currentSceneId === input.responseSceneId &&
    input.latestRequestId === input.responseRequestId
  );
}
