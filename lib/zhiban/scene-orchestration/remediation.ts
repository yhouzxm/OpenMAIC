import type {
  ConceptErrorCode,
  LearningCenterDimensionKey,
  LearningEvent,
  StationId,
} from '@/lib/zhiban/learning-center/types';
import type { ErrorPattern } from '@/lib/zhiban/virtual-lab/assessment/types';
import { getScene } from './orchestrator';
import type { SceneId } from './types';

export type RemediationContextMode = 'SELF_LEARNING' | 'POST_ASSESSMENT' | 'CLASSROOM';
export type ConceptErrorStatus = 'ACTIVE' | 'IMPROVING' | 'RESOLVED' | 'REOPENED';
export type RemediationPriority = 'critical' | 'high' | 'medium';

export interface ConceptErrorHistoryItem {
  code: ConceptErrorCode;
  count: number;
  lastOccurredAt?: string;
}

export interface RemediationResolverInput {
  conceptErrors: ConceptErrorCode[];
  currentSceneId?: SceneId;
  stationId?: StationId;
  learnerProfile?: Partial<Record<LearningCenterDimensionKey, number>>;
  attemptHistory?: ConceptErrorHistoryItem[];
  completedScenes?: SceneId[];
  currentCheckpoint?: string;
  weakDimensions?: LearningCenterDimensionKey[];
  contextMode: RemediationContextMode;
}

export interface RemediationRecommendation {
  sceneId: SceneId;
  reasonCode: string;
  priority: RemediationPriority;
  triggerConceptErrors: ConceptErrorCode[];
  sourceSceneId: SceneId | null;
  retryTarget: string;
  returnSceneId: SceneId | null;
  requiresRetry: boolean;
  contextMode: RemediationContextMode;
  title: string;
  briefRationale: string;
  guidingQuestion: string;
  estimatedMinutes: number;
  relatedAbility: string;
  explanationContext: Record<string, unknown>;
}

interface RemediationRule {
  sceneId: SceneId;
  priority: RemediationPriority;
  blocking: boolean;
  ability: LearningCenterDimensionKey;
  rationale: string;
  question: string;
}

export const REMEDIATION_SCENE_MAPPING: Record<ConceptErrorCode, RemediationRule> = {
  POWER_EQUALS_SENSOR_NORMAL: {
    sceneId: 'S02-03', priority: 'critical', blocking: true, ability: 'sensorDetection',
    rationale: '供电状态与输出状态仍有混淆，建议重新比较传感器供电端和输出端。',
    question: '24V供电正常后，还需要验证哪个信号才能判断传感器是否正常工作？',
  },
  INPUT_OUTPUT_CONFUSION: {
    sceneId: 'S03-01', priority: 'critical', blocking: true, ability: 'plcSignalAnalysis',
    rationale: 'PLC输入与输出方向混淆会阻断后续信号链判断。',
    question: '这个信号是由现场设备进入PLC，还是由PLC发往现场设备？',
  },
  FIELD_IO_MAPPING_ERROR: {
    sceneId: 'S03-02', priority: 'high', blocking: true, ability: 'plcSignalAnalysis',
    rationale: '现场设备与PLC地址的对应关系尚不稳定。',
    question: 'S2和推料控制分别对应哪一个输入地址与输出地址？',
  },
  PLC_SCAN_SEQUENCE_ERROR: {
    sceneId: 'S03-03', priority: 'high', blocking: true, ability: 'plcSignalAnalysis',
    rationale: 'PLC读取输入、执行逻辑、更新输出的先后关系需要补强。',
    question: '一次扫描周期中，PLC应先读取输入还是先更新输出？',
  },
  LADDER_LOGIC_CONFUSION: {
    sceneId: 'S03-04', priority: 'high', blocking: true, ability: 'plcSignalAnalysis',
    rationale: '梯形图触点状态与输出线圈之间的信号传递尚未建立。',
    question: 'I0.2触点满足什么条件时，信号才能到达Q0.1线圈？',
  },
  CONTROL_EXECUTION_CONFUSION: {
    sceneId: 'S04-01', priority: 'medium', blocking: false, ability: 'systemUnderstanding',
    rationale: '控制信号与执行机构之间的转换链需要重新梳理。',
    question: 'PLC输出后，还要经过哪些环节才能形成机械动作？',
  },
  OUTPUT_EQUALS_ACTUATION_SUCCESS: {
    sceneId: 'S04-03', priority: 'critical', blocking: true, ability: 'systemUnderstanding',
    rationale: 'PLC已有输出并不能证明执行机构已经真实动作。',
    question: 'Q0.1已经ON时，还需要观察哪项现场证据才能确认执行成功？',
  },
  SENSING_LAYER_CONFUSION: {
    sceneId: 'S05-02', priority: 'high', blocking: true, ability: 'faultDiagnosisVerification',
    rationale: '现场工件状态与PLC输入之间的矛盾尚未定位到感知层。',
    question: '工件已经到位但I0.2仍为OFF，信号最可能在哪一段丢失？',
  },
  CONTROL_LAYER_CONFUSION: {
    sceneId: 'S05-03', priority: 'high', blocking: true, ability: 'faultDiagnosisVerification',
    rationale: 'PLC输入有效但控制输出未产生时，故障层级判断需要补强。',
    question: 'I0.2已ON而Q0.1仍OFF，感知、控制、执行哪一段首先出现矛盾？',
  },
  ACTUATION_LAYER_CONFUSION: {
    sceneId: 'S05-04', priority: 'high', blocking: true, ability: 'faultDiagnosisVerification',
    rationale: 'PLC输出存在但机械动作缺失时，需要沿执行链定位。',
    question: 'Q0.1已ON但气缸不动，信号链的哪个层级应优先检查？',
  },
  EVIDENCE_SELECTION_ERROR: {
    sceneId: 'S05-01', priority: 'critical', blocking: true, ability: 'evidenceReasoning',
    rationale: '当前判断缺少能够连接现场、PLC与测量结果的关键证据。',
    question: '“察—查—测—断—验”中，你还缺少哪一步证据？',
  },
};

const priorityScore: Record<RemediationPriority, number> = {
  critical: 300,
  high: 200,
  medium: 100,
};

function occurrences(input: RemediationResolverInput, code: ConceptErrorCode) {
  return input.attemptHistory?.find((item) => item.code === code)?.count ??
    input.conceptErrors.filter((item) => item === code).length;
}

export function resolveRemediationScene(
  input: RemediationResolverInput,
): RemediationRecommendation | null {
  const dimensionFallback: Partial<Record<LearningCenterDimensionKey, ConceptErrorCode>> = {
    systemUnderstanding: 'CONTROL_EXECUTION_CONFUSION',
    sensorDetection: 'POWER_EQUALS_SENSOR_NORMAL',
    plcSignalAnalysis: 'FIELD_IO_MAPPING_ERROR',
    toolMeasurement: 'POWER_EQUALS_SENSOR_NORMAL',
    evidenceReasoning: 'EVIDENCE_SELECTION_ERROR',
    faultDiagnosisVerification: 'EVIDENCE_SELECTION_ERROR',
  };
  const fromDimensions = (input.weakDimensions ?? []).flatMap((dimension) =>
    dimensionFallback[dimension] ? [dimensionFallback[dimension]!] : [],
  );
  const unique = [...new Set([...input.conceptErrors, ...fromDimensions])];
  if (!unique.length) return null;
  const ranked = unique.map((code, index) => {
    const rule = REMEDIATION_SCENE_MAPPING[code];
    const target = getScene(rule.sceneId);
    const source = input.currentSceneId ? getScene(input.currentSceneId) : null;
    const profileScore = input.learnerProfile?.[rule.ability];
    const score =
      priorityScore[rule.priority] +
      (source?.remediationFor.includes(code) ? 140 : 0) +
      (input.currentCheckpoint ? 80 : 0) +
      Math.min(occurrences(input, code), 5) * 25 +
      (target?.stationId === input.stationId ? 20 : 0) +
      (typeof profileScore === 'number' ? Math.max(0, 70 - profileScore) : 0) +
      (unique.length - index);
    return { code, rule, score, target };
  }).sort((left, right) => right.score - left.score || left.code.localeCompare(right.code));
  const selected = ranked[0];
  if (!selected.target) return null;
  const retryTarget = input.currentCheckpoint ?? input.currentSceneId ?? 'learning-path';
  return {
    sceneId: selected.rule.sceneId,
    reasonCode: `CONCEPT_ERROR_${selected.code}`,
    priority: selected.rule.priority,
    triggerConceptErrors: unique,
    sourceSceneId: input.currentSceneId ?? null,
    retryTarget,
    returnSceneId: input.currentSceneId ?? null,
    requiresRetry: true,
    contextMode: input.contextMode,
    title: selected.target.title,
    briefRationale: selected.rule.rationale,
    guidingQuestion: selected.rule.question,
    estimatedMinutes: Number(selected.target.metadata.estimatedMinutes ?? 4),
    relatedAbility: selected.rule.ability,
    explanationContext: {
      selectedConceptError: selected.code,
      occurrenceCount: occurrences(input, selected.code),
      blocking: selected.rule.blocking,
      completedBefore: input.completedScenes?.includes(selected.rule.sceneId) ?? false,
      profileScore: input.learnerProfile?.[selected.rule.ability] ?? null,
    },
  };
}

const virtualLabPatternMap: Partial<Record<ErrorPattern, ConceptErrorCode>> = {
  SKIP_OUTPUT_MEASUREMENT: 'POWER_EQUALS_SENSOR_NORMAL',
  SKIP_PLC_INSPECTION: 'FIELD_IO_MAPPING_ERROR',
  BLIND_GUESS: 'EVIDENCE_SELECTION_ERROR',
  INSUFFICIENT_VERIFICATION: 'EVIDENCE_SELECTION_ERROR',
  SKIP_POWER_MEASUREMENT: 'POWER_EQUALS_SENSOR_NORMAL',
};

export function resolveVirtualLabRemediation(
  errorPatterns: ErrorPattern[],
  profile?: RemediationResolverInput['learnerProfile'],
) {
  const conceptErrors = errorPatterns.flatMap((pattern) =>
    virtualLabPatternMap[pattern] ? [virtualLabPatternMap[pattern]!] : [],
  );
  if (!conceptErrors.length) return null;
  return resolveRemediationScene({
    conceptErrors,
    currentSceneId: 'S06-02',
    stationId: 'station-06-virtual-lab',
    learnerProfile: profile,
    currentCheckpoint: 'mech-lab-line-stop',
    contextMode: 'POST_ASSESSMENT',
  });
}

export interface ConceptErrorStateRecord {
  code: ConceptErrorCode;
  status: ConceptErrorStatus;
  occurrences: number;
  lastChangedAt: string;
}

export interface RemediationRunSummary {
  remediationRunId: string;
  sourceSceneId: SceneId | null;
  targetSceneId: SceneId;
  triggerConceptErrors: ConceptErrorCode[];
  contextMode: RemediationContextMode;
  retryTarget: string;
  returnSceneId: SceneId | null;
  status: 'RECOMMENDED' | 'IN_PROGRESS' | 'READY_TO_RETRY' | 'RETRYING' | 'RESOLVED' | 'REOPENED';
  enteredAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  resolvedConceptErrors: ConceptErrorCode[];
  newConceptErrors: ConceptErrorCode[];
}

export function deriveRemediationRuns(events: LearningEvent[]): RemediationRunSummary[] {
  const runs = new Map<string, RemediationRunSummary>();
  for (const event of [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (!event.eventType.startsWith('REMEDIATION_')) continue;
    const payload = event.payload ?? {};
    const runId = typeof payload.remediationRunId === 'string' ? payload.remediationRunId : '';
    const targetSceneId = typeof payload.targetSceneId === 'string' ? payload.targetSceneId as SceneId : null;
    if (!runId || !targetSceneId || !getScene(targetSceneId)) continue;
    const current = runs.get(runId) ?? {
      remediationRunId: runId,
      sourceSceneId: typeof payload.sourceSceneId === 'string' ? payload.sourceSceneId as SceneId : null,
      targetSceneId,
      triggerConceptErrors: (Array.isArray(payload.triggerConceptErrors) ? payload.triggerConceptErrors : []) as ConceptErrorCode[],
      contextMode: (typeof payload.contextMode === 'string' ? payload.contextMode : 'SELF_LEARNING') as RemediationContextMode,
      retryTarget: typeof payload.retryTarget === 'string' ? payload.retryTarget : 'learning-path',
      returnSceneId: typeof payload.returnSceneId === 'string' ? payload.returnSceneId as SceneId : null,
      status: 'RECOMMENDED' as const,
      enteredAt: null,
      completedAt: null,
      durationMs: null,
      resolvedConceptErrors: [],
      newConceptErrors: [],
    };
    if (event.eventType === 'REMEDIATION_SCENE_ENTERED') {
      current.status = 'IN_PROGRESS';
      current.enteredAt = event.timestamp;
    } else if (event.eventType === 'REMEDIATION_SCENE_COMPLETED') {
      current.status = 'READY_TO_RETRY';
      current.completedAt = event.timestamp;
      current.durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : null;
    } else if (event.eventType === 'REMEDIATION_RETRY_STARTED') current.status = 'RETRYING';
    else if (event.eventType === 'REMEDIATION_RETRY_COMPLETED') {
      const correct = event.isCorrect === true;
      current.status = correct ? 'RESOLVED' : 'REOPENED';
      current.resolvedConceptErrors = (Array.isArray(payload.resolvedConceptErrors) ? payload.resolvedConceptErrors : []) as ConceptErrorCode[];
      current.newConceptErrors = (Array.isArray(payload.newConceptErrors) ? payload.newConceptErrors : []) as ConceptErrorCode[];
    }
    runs.set(runId, current);
  }
  return [...runs.values()].reverse();
}

export function deriveConceptErrorStates(events: LearningEvent[]): ConceptErrorStateRecord[] {
  const states = new Map<ConceptErrorCode, ConceptErrorStateRecord>();
  for (const event of [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const payload = event.payload ?? {};
    if (event.eventType === 'REMEDIATION_SCENE_ENTERED') {
      const triggers = Array.isArray(payload.triggerConceptErrors) ? payload.triggerConceptErrors : [];
      for (const value of triggers) {
        const state = states.get(value as ConceptErrorCode);
        if (state) states.set(state.code, { ...state, status: 'IMPROVING', lastChangedAt: event.timestamp });
      }
      continue;
    }
    if (event.eventType === 'REMEDIATION_RETRY_COMPLETED') {
      const resolved = Array.isArray(payload.resolvedConceptErrors) ? payload.resolvedConceptErrors : [];
      for (const value of resolved) {
        const state = states.get(value as ConceptErrorCode);
        if (state) states.set(state.code, { ...state, status: 'RESOLVED', lastChangedAt: event.timestamp });
      }
      const reopened = Array.isArray(payload.newConceptErrors) ? payload.newConceptErrors : [];
      for (const value of reopened) {
        const code = value as ConceptErrorCode;
        const previous = states.get(code);
        states.set(code, { code, status: 'REOPENED', occurrences: (previous?.occurrences ?? 0) + 1, lastChangedAt: event.timestamp });
      }
      continue;
    }
    if (event.eventType.startsWith('REMEDIATION_')) continue;
    const errors = Array.isArray(payload.conceptErrors) ? payload.conceptErrors : [];
    for (const value of errors) {
      if (!(value in REMEDIATION_SCENE_MAPPING)) continue;
      const code = value as ConceptErrorCode;
      const previous = states.get(code);
      states.set(code, {
        code,
        status: previous?.status === 'RESOLVED' ? 'REOPENED' : (previous?.status ?? 'ACTIVE'),
        occurrences: (previous?.occurrences ?? 0) + 1,
        lastChangedAt: event.timestamp,
      });
    }
  }
  return [...states.values()].sort((a, b) => b.lastChangedAt.localeCompare(a.lastChangedAt));
}

export function createRemediationFallback(recommendation: RemediationRecommendation) {
  return {
    remediationMessage: recommendation.briefRationale,
    guidingQuestion: recommendation.guidingQuestion,
    briefRationale: recommendation.briefRationale,
    fallback: true,
  };
}

export function sanitizeRemediationExplanation(
  value: unknown,
  recommendation: RemediationRecommendation,
) {
  const fallback = createRemediationFallback(recommendation);
  if (!value || typeof value !== 'object') return fallback;
  const input = value as Record<string, unknown>;
  const clean = (text: unknown, fallbackText: string) => {
    if (typeof text !== 'string' || !text.trim()) return fallbackText;
    return text.trim().replace(/S\d{2}-\d{2}/g, '推荐补练内容').slice(0, 120);
  };
  return {
    remediationMessage: clean(input.remediationMessage ?? input.message, fallback.remediationMessage),
    guidingQuestion: clean(input.guidingQuestion, fallback.guidingQuestion),
    briefRationale: clean(input.briefRationale, fallback.briefRationale),
    fallback: false,
  };
}
