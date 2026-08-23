export const LINE_STOP_001_SCENARIO_ID = 'line-stop-001' as const;
export const S2_NO_OUTPUT = 'S2_NO_OUTPUT' as const;

export type LineStopOperationalPhase =
  | 'idle'
  | 'feeding'
  | 's1_detected'
  | 'conveying'
  | 's2_detected'
  | 'fault_waiting'
  | 'pushing'
  | 'retracting'
  | 'completed'
  | 'paused';

export type LineStopTrainingPhase =
  | 'intro'
  | 'running'
  | 'fault'
  | 'inspection'
  | 'diagnosis'
  | 'repair'
  | 'verification'
  | 'completed';

export type LineStopAction =
  | { type: 'START_TRAINING' }
  | { type: 'PAUSE_SYSTEM' }
  | { type: 'RESET_SYSTEM' }
  | { type: 'OPEN_PLC_MONITOR'; target: 'plc' }
  | { type: 'INSPECT_COMPONENT'; target: 'sensor_s2' | 'sensor_s1' | 'motor' | 'cylinder' }
  | { type: 'MEASURE_SENSOR_POWER'; target: 'sensor_s2' }
  | { type: 'MEASURE_SENSOR_OUTPUT'; target: 'sensor_s2' }
  | { type: 'BEGIN_DIAGNOSIS' }
  | { type: 'SUBMIT_DIAGNOSIS'; diagnosis: 'S2_OUTPUT_ABNORMAL' | 'PLC_PROGRAM' | 'MOTOR_FAULT' | 'CYLINDER_FAULT' }
  | { type: 'REPLACE_COMPONENT'; target: 'sensor_s2' }
  | { type: 'RESTART_MACHINE' };

export interface LineStopActionRecord {
  timestampMs: number;
  action: LineStopAction['type'] | 'WRONG_ACTION';
  target?: string;
  value?: number | string;
  unit?: string;
  phase: LineStopTrainingPhase;
}

export interface LineStopTrainingState {
  hasOpenedPlcMonitor: boolean;
  inspectedComponents: string[];
  measurements: { s2Power?: number; s2Output?: number };
  wrongActions: string[];
  diagnosisEvidence: string[];
  diagnosis?: 'S2_OUTPUT_ABNORMAL' | 'PLC_PROGRAM' | 'MOTOR_FAULT' | 'CYLINDER_FAULT';
  repaired: boolean;
  verificationPassed: boolean;
  startedAtMs: number | null;
  elapsedMs: number;
  actions: LineStopActionRecord[];
}

export interface LineStopSceneState {
  systemRunning: boolean;
  /** Compatibility with the original normal-flow visual state machine. */
  phase: LineStopOperationalPhase;
  trainingPhase: LineStopTrainingPhase;
  phaseElapsedMs: number;
  workpiece: { position: { x: number; y: number; z: number }; detectedByS1: boolean; detectedByS2: boolean };
  sensorS1: { active: boolean };
  sensorS2: { active: boolean; powered: boolean; output: boolean; faulty: boolean };
  motor: { running: boolean };
  conveyor: { running: boolean };
  cylinder: { extended: boolean };
  plc: {
    inputs: { startButton: boolean; stopButton: boolean; s1: boolean; s2: boolean };
    outputs: { motor: boolean; cylinder: boolean };
  };
  /** `scheduled` makes the one demonstration fault deterministic without exposing it before arrival. */
  fault: { code: typeof S2_NO_OUTPUT | null; active: boolean; scheduled: boolean };
  training: LineStopTrainingState;
  pausedPhase?: Exclude<LineStopOperationalPhase, 'paused'>;
}

const phaseDuration: Partial<Record<LineStopOperationalPhase, number>> = {
  feeding: 900, s1_detected: 700, conveying: 2100, s2_detected: 700, pushing: 900, retracting: 800,
};
const nextPhase: Partial<Record<LineStopOperationalPhase, LineStopOperationalPhase>> = {
  feeding: 's1_detected', s1_detected: 'conveying', conveying: 's2_detected',
  s2_detected: 'pushing', pushing: 'retracting', retracting: 'completed',
};

function createTraining(): LineStopTrainingState {
  return {
    hasOpenedPlcMonitor: false, inspectedComponents: [], measurements: {}, wrongActions: [],
    diagnosisEvidence: [], repaired: false, verificationPassed: false, startedAtMs: null, elapsedMs: 0, actions: [],
  };
}

export function createLineStopInitialState(): LineStopSceneState {
  return {
    systemRunning: false, phase: 'idle', trainingPhase: 'intro', phaseElapsedMs: 0,
    workpiece: { position: { x: -4.1, y: 0.48, z: 0 }, detectedByS1: false, detectedByS2: false },
    sensorS1: { active: false }, sensorS2: { active: false, powered: true, output: false, faulty: true },
    motor: { running: false }, conveyor: { running: false }, cylinder: { extended: false },
    plc: { inputs: { startButton: false, stopButton: false, s1: false, s2: false }, outputs: { motor: false, cylinder: false } },
    fault: { code: S2_NO_OUTPUT, active: false, scheduled: true }, training: createTraining(),
  };
}

/** Starts the deterministic normal segment that will always stop at the same S2 fault. */
export function startLineStopSystem(state: LineStopSceneState): LineStopSceneState {
  if (state.phase === 'paused') return resumeLineStopSystem(state);
  if (state.systemRunning) return state;
  const reset = createLineStopInitialState();
  reset.training.startedAtMs = 0;
  return stateForPhase(reset, 'feeding', 0, 'running');
}

export function pauseLineStopSystem(state: LineStopSceneState): LineStopSceneState {
  if (!state.systemRunning || state.phase === 'paused') return state;
  return {
    ...state, systemRunning: false, phase: 'paused', pausedPhase: state.phase,
    motor: { running: false }, conveyor: { running: false },
    plc: { ...state.plc, outputs: { ...state.plc.outputs, motor: false } },
  };
}

export function resumeLineStopSystem(state: LineStopSceneState): LineStopSceneState {
  if (state.phase !== 'paused' || !state.pausedPhase) return state;
  return stateForPhase({ ...state, phase: state.pausedPhase, pausedPhase: undefined }, state.pausedPhase, state.phaseElapsedMs, state.trainingPhase);
}

/** Advances only physical time; no UI action may skip or alter diagnostic results. */
export function advanceLineStopState(state: LineStopSceneState, elapsedMs: number): LineStopSceneState {
  if (!state.systemRunning || elapsedMs <= 0) return state;
  let next = {
    ...state,
    phaseElapsedMs: state.phaseElapsedMs + elapsedMs,
    training: { ...state.training, elapsedMs: state.training.elapsedMs + elapsedMs },
  };
  while (next.systemRunning) {
    const duration = phaseDuration[next.phase];
    if (!duration || next.phaseElapsedMs < duration) return withAnimatedPosition(next);
    const carry = next.phaseElapsedMs - duration;
    if (next.phase === 'conveying' && next.fault.scheduled && !next.training.repaired) {
      return stateForFault(next);
    }
    // `nextPhase` deliberately has no paused transition; its broad lookup key needs narrowing here.
    const following = nextPhase[next.phase] as Exclude<LineStopOperationalPhase, 'paused'> | undefined;
    if (!following) return withAnimatedPosition(next);
    const trainingPhase = following === 'completed' ? 'completed' : next.trainingPhase;
    next = stateForPhase(next, following, carry, trainingPhase);
    if (following === 'completed') {
      next.training.verificationPassed = next.training.repaired && next.trainingPhase === 'completed';
      return next;
    }
  }
  return next;
}

/** Central training-action gateway. It records both productive and wrong actions. */
export function applyLineStopAction(state: LineStopSceneState, action: LineStopAction): LineStopSceneState {
  if (action.type === 'RESET_SYSTEM') return createLineStopInitialState();
  if (action.type === 'START_TRAINING') return recordAction(startLineStopSystem(state), action);
  if (action.type === 'PAUSE_SYSTEM') return recordAction(pauseLineStopSystem(state), action);

  const next = recordAction(state, action);
  const wrong = (reason: string) => recordWrongAction(next, reason);
  if (action.type === 'OPEN_PLC_MONITOR') {
    if (next.trainingPhase === 'fault') next.trainingPhase = 'inspection';
    next.training.hasOpenedPlcMonitor = true;
    return next;
  }
  if (action.type === 'INSPECT_COMPONENT') {
    if (!next.training.inspectedComponents.includes(action.target)) next.training.inspectedComponents.push(action.target);
    if (action.target !== 'sensor_s2') return wrong('IRRELEVANT_INSPECTION');
    if (next.trainingPhase === 'fault') next.trainingPhase = 'inspection';
    return next;
  }
  if (action.type === 'MEASURE_SENSOR_POWER') {
    next.training.measurements.s2Power = 24;
    addEvidence(next, 'S2_POWER_24V');
    return next;
  }
  if (action.type === 'MEASURE_SENSOR_OUTPUT') {
    next.training.measurements.s2Output = next.sensorS2.output ? 24 : 0;
    addEvidence(next, next.sensorS2.output ? 'S2_OUTPUT_24V' : 'S2_OUTPUT_0V');
    return next;
  }
  if (action.type === 'BEGIN_DIAGNOSIS') {
    const evidenceReady = next.training.hasOpenedPlcMonitor && next.training.measurements.s2Power === 24 && next.training.measurements.s2Output === 0;
    if (!evidenceReady) return wrong('DIAGNOSIS_WITHOUT_EVIDENCE');
    next.trainingPhase = 'diagnosis';
    return next;
  }
  if (action.type === 'SUBMIT_DIAGNOSIS') {
    const evidenceReady = next.training.hasOpenedPlcMonitor && next.training.measurements.s2Power === 24 && next.training.measurements.s2Output === 0;
    if (!evidenceReady) return wrong('DIAGNOSIS_WITHOUT_EVIDENCE');
    if (action.diagnosis !== 'S2_OUTPUT_ABNORMAL') return wrong('WRONG_DIAGNOSIS');
    next.training.diagnosis = action.diagnosis;
    next.trainingPhase = 'repair';
    return next;
  }
  if (action.type === 'REPLACE_COMPONENT') {
    if (next.training.diagnosis !== 'S2_OUTPUT_ABNORMAL') return wrong('REPAIR_WITHOUT_DIAGNOSIS');
    next.sensorS2.faulty = false;
    next.sensorS2.powered = true;
    next.sensorS2.output = true;
    next.sensorS2.active = true;
    next.plc.inputs.s2 = true;
    next.fault.active = false;
    next.training.repaired = true;
    next.trainingPhase = 'verification';
    addEvidence(next, 'S2_REPAIRED');
    return next;
  }
  if (action.type === 'RESTART_MACHINE') {
    if (!next.training.repaired) return wrong('RESTART_BEFORE_REPAIR');
    const verification = stateForPhase(next, 's2_detected', 0, 'verification');
    verification.sensorS2.output = true;
    verification.sensorS2.active = true;
    verification.plc.inputs.s2 = true;
    return verification;
  }
  return next;
}

export function buildLineStopCompletionPayload(state: LineStopSceneState, activityId = 'mech-lab-line-stop') {
  return {
    success: state.trainingPhase === 'completed' && state.training.verificationPassed,
    scenarioId: LINE_STOP_001_SCENARIO_ID,
    activityId,
    durationSeconds: Math.round(state.training.elapsedMs / 1000),
    wrongActions: state.training.wrongActions,
    actionsCount: state.training.actions.length,
    measurements: state.training.measurements,
    diagnosis: state.training.diagnosis ?? null,
    verificationPassed: state.training.verificationPassed,
    hintsUsed: 0,
  };
}

export function lineStopStateSnapshot(state: LineStopSceneState) {
  return {
    phase: state.trainingPhase,
    operationalPhase: state.phase,
    systemRunning: state.systemRunning,
    sensors: { s1: state.sensorS1.active, s2: state.sensorS2.active, s2Powered: state.sensorS2.powered, s2Output: state.sensorS2.output },
    motor: state.motor.running, conveyor: state.conveyor.running, cylinder: state.cylinder.extended,
    plc: state.plc, faultActive: state.fault.active,
  };
}

function stateForFault(state: LineStopSceneState): LineStopSceneState {
  const next = stateForPhase(state, 'fault_waiting', 0, 'fault');
  next.workpiece.detectedByS1 = true;
  next.workpiece.detectedByS2 = true; // physical arrival is real even though S2 output is absent
  next.workpiece.position = { x: 1.35, y: 0.48, z: 0 };
  next.sensorS2.powered = true;
  next.sensorS2.output = false;
  next.sensorS2.active = false;
  next.sensorS2.faulty = true;
  next.plc.inputs.s2 = false;
  next.fault.active = true;
  next.systemRunning = false;
  return next;
}

function stateForPhase(
  state: LineStopSceneState,
  phase: Exclude<LineStopOperationalPhase, 'paused'>,
  phaseElapsedMs: number,
  trainingPhase: LineStopTrainingPhase,
): LineStopSceneState {
  const next: LineStopSceneState = {
    ...state,
    systemRunning: phase !== 'completed' && phase !== 'idle', phase, trainingPhase, phaseElapsedMs,
    sensorS1: { active: false },
    sensorS2: { ...state.sensorS2, active: false, output: false },
    motor: { running: false }, conveyor: { running: false }, cylinder: { extended: false },
    plc: { inputs: { ...state.plc.inputs, startButton: false, stopButton: false, s1: false, s2: false }, outputs: { motor: false, cylinder: false } },
  };
  if (phase === 'feeding' || phase === 's1_detected' || phase === 'conveying') {
    next.motor.running = true; next.conveyor.running = true; next.plc.outputs.motor = true;
  }
  if (phase === 's1_detected') { next.sensorS1.active = true; next.workpiece.detectedByS1 = true; next.plc.inputs.s1 = true; }
  if (phase === 'conveying') next.workpiece.detectedByS1 = true;
  if (phase === 's2_detected' || phase === 'pushing' || phase === 'retracting' || phase === 'completed') {
    next.workpiece.detectedByS1 = true; next.workpiece.detectedByS2 = true;
    next.sensorS2.output = !next.sensorS2.faulty;
    next.sensorS2.active = phase === 's2_detected' && next.sensorS2.output;
    next.plc.inputs.s2 = next.sensorS2.active;
  }
  if (phase === 'pushing') { next.cylinder.extended = true; next.plc.outputs.cylinder = true; }
  return withAnimatedPosition(next);
}

function withAnimatedPosition(state: LineStopSceneState): LineStopSceneState {
  const position = { ...state.workpiece.position };
  const duration = phaseDuration[state.phase] ?? 1;
  const t = Math.max(0, Math.min(1, state.phaseElapsedMs / duration));
  if (state.phase === 'feeding') position.x = -4.1 + 1.9 * t;
  else if (state.phase === 's1_detected') position.x = -2.2;
  else if (state.phase === 'conveying') position.x = -2.2 + 3.55 * t;
  else if (state.phase === 's2_detected' || state.phase === 'fault_waiting') position.x = 1.35;
  else if (state.phase === 'pushing') { position.x = 1.35; position.z = 1.55 * t; }
  else if (state.phase === 'retracting' || state.phase === 'completed') { position.x = 1.35; position.z = 1.55; }
  return { ...state, workpiece: { ...state.workpiece, position } };
}

function recordAction(state: LineStopSceneState, action: LineStopAction): LineStopSceneState {
  const record: LineStopActionRecord = {
    timestampMs: state.training.elapsedMs, action: action.type, phase: state.trainingPhase,
    ...('target' in action ? { target: action.target } : {}),
    ...('diagnosis' in action ? { value: action.diagnosis } : {}),
    ...(action.type === 'MEASURE_SENSOR_POWER' ? { value: 24, unit: 'V' } : {}),
    ...(action.type === 'MEASURE_SENSOR_OUTPUT' ? { value: state.sensorS2.output ? 24 : 0, unit: 'V' } : {}),
  };
  return { ...state, training: { ...state.training, actions: [...state.training.actions, record] } };
}

function recordWrongAction(state: LineStopSceneState, reason: string): LineStopSceneState {
  const record: LineStopActionRecord = { timestampMs: state.training.elapsedMs, action: 'WRONG_ACTION', value: reason, phase: state.trainingPhase };
  return { ...state, training: { ...state.training, wrongActions: [...state.training.wrongActions, reason], actions: [...state.training.actions, record] } };
}

function addEvidence(state: LineStopSceneState, evidence: string) {
  if (!state.training.diagnosisEvidence.includes(evidence)) state.training.diagnosisEvidence.push(evidence);
}
