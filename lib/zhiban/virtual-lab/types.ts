/**
 * Public protocol and context for embedded Zhiban Virtual Lab activities.
 * It deliberately has no persistence dependency: later batches can attach a
 * session id, event writer, AI coach, score service, or learner profile here.
 */
export const MECH_LAB_MESSAGE_SOURCE = 'zhiban-virtual-lab' as const;
export const MECH_LAB_PROTOCOL_VERSION = '1.0' as const;

export const MECH_LAB_MESSAGE_TYPES = [
  'MECH_READY',
  'MECH_ACTION',
  'MECH_STATE_CHANGED',
  'MECH_REQUEST_HINT',
  'MECH_AI_HINT',
  'MECH_COMPLETE',
  'MECH_RESET',
] as const;

export type MechLabMessageType = (typeof MECH_LAB_MESSAGE_TYPES)[number];

export interface MechLabActivityContext {
  activityId: string;
  courseId: string;
  chapterId: string;
  scenarioId: string;
  title: string;
  description: string;
  difficulty: string;
  estimatedMinutes: number;
  learningObjectives: string[];
  courseTitle?: string;
  chapterTitle?: string;
  scenarioTitle?: string;
  /** Supporting chapters are retained without forcing a multi-chapter activity model. */
  relatedChapterIds?: string[];
  sessionId?: string;
}

export interface MechLabActionPayload {
  action:
    | 'START_SYSTEM'
    | 'PAUSE_SYSTEM'
    | 'RESET_SYSTEM'
    | 'START_TRAINING'
    | 'OPEN_PLC_MONITOR'
    | 'CLOSE_PLC_MONITOR'
    | 'INSPECT_COMPONENT'
    | 'MEASURE_SENSOR_POWER'
    | 'MEASURE_SENSOR_OUTPUT'
    | 'BEGIN_DIAGNOSIS'
    | 'SUBMIT_DIAGNOSIS'
    | 'REPLACE_COMPONENT'
    | 'RESTART_MACHINE'
    | 'CLICK_COMPONENT'
    | 'REQUEST_HINT'
    | 'WRONG_ACTION'
    | 'OBSERVE'
    | 'simulate_fault'
    | 'start'
    | 'observe';
  componentId?: 's1' | 's2' | 'plc' | 'motor' | 'cylinder';
  /** Diagnostic target names are deliberately explicit for later learning-event use. */
  target?: 'plc' | 'sensor_s1' | 'sensor_s2' | 'motor' | 'cylinder';
  value?: string | number;
  unit?: 'V';
  phase?: string;
  detail?: string;
}

export interface MechLabStatePayload {
  status: 'ready' | 'running' | 'fault_simulated' | 'reset' | 'completed';
  rotation: 'running' | 'stopped';
  detail?: string;
}

/** Reserved for deterministic scene snapshots and later logging/PLC extensions. */
export interface MechLabSceneStatePayload {
  phase: string;
  operationalPhase?: string;
  systemRunning: boolean;
  workpiece?: { position?: { x: number; y: number; z: number }; detectedByS1?: boolean; detectedByS2?: boolean };
  sensors: { s1: boolean; s2: boolean; s2Powered?: boolean; s2Output?: boolean; s2Faulty?: boolean };
  motor: boolean;
  conveyor: boolean;
  cylinder: boolean;
  plc: { inputs: { s1: boolean; s2: boolean; startButton?: boolean; stopButton?: boolean }; outputs: { motor: boolean; cylinder: boolean } };
  faultActive?: boolean;
  training?: {
    inspectedComponents?: string[];
    measurements?: { s2Power?: number; s2Output?: number };
    diagnosis?: string | null;
    repaired?: boolean;
    verificationPassed?: boolean;
    wrongActions?: string[];
    actions?: Array<Record<string, unknown>>;
    elapsedMs?: number;
  };
}

export interface MechLabHintPayload {
  hint?: string;
  request?: string;
  level?: 1 | 2 | 3;
  requestedLevel?: 1 | 2 | 3;
  message?: string;
  diagnosisState?: string;
  currentPhase?: string;
  fallback?: boolean;
  timestamp?: string;
}

/** Completion evidence emitted only after a repaired machine finishes verification. */
export interface MechLabCompletePayload {
  success: boolean;
  scenarioId: string;
  activityId?: string;
  durationSeconds: number;
  wrongActions: string[];
  actionsCount: number;
  measurements: Record<string, number | undefined>;
  diagnosis: string | null;
  verificationPassed: boolean;
  hintsUsed: number;
}

export type MechLabMessagePayload =
  | MechLabActionPayload
  | MechLabStatePayload
  | MechLabSceneStatePayload
  | MechLabHintPayload
  | MechLabCompletePayload
  | Record<string, never>;

export interface MechLabMessage<T extends MechLabMessageType = MechLabMessageType> {
  source: typeof MECH_LAB_MESSAGE_SOURCE;
  version: typeof MECH_LAB_PROTOCOL_VERSION;
  type: T;
  activityId: string;
  scenarioId: string;
  timestamp: string;
  sessionId?: string;
  payload: MechLabMessagePayload;
}

export function createMechLabMessage<T extends MechLabMessageType>(
  context: Pick<MechLabActivityContext, 'activityId' | 'scenarioId' | 'sessionId'>,
  type: T,
  payload: MechLabMessagePayload = {},
): MechLabMessage<T> {
  return {
    source: MECH_LAB_MESSAGE_SOURCE,
    version: MECH_LAB_PROTOCOL_VERSION,
    type,
    activityId: context.activityId,
    scenarioId: context.scenarioId,
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    timestamp: new Date().toISOString(),
    payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reject unrelated window messages before they reach Virtual Lab business code. */
export function isMechLabMessage(value: unknown): value is MechLabMessage {
  if (!isRecord(value)) return false;
  return (
    value.source === MECH_LAB_MESSAGE_SOURCE &&
    value.version === MECH_LAB_PROTOCOL_VERSION &&
    typeof value.type === 'string' &&
    (MECH_LAB_MESSAGE_TYPES as readonly string[]).includes(value.type) &&
    typeof value.activityId === 'string' &&
    typeof value.scenarioId === 'string' &&
    typeof value.timestamp === 'string' &&
    isRecord(value.payload) &&
    (value.sessionId === undefined || typeof value.sessionId === 'string')
  );
}

export function isMechLabMessageForContext(
  value: unknown,
  context: Pick<MechLabActivityContext, 'activityId' | 'scenarioId'>,
): value is MechLabMessage {
  return (
    isMechLabMessage(value) &&
    value.activityId === context.activityId &&
    value.scenarioId === context.scenarioId
  );
}
