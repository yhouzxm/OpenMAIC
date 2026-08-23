import type { BuildTrainingContextInput, TrainingAction, TrainingContext } from './types';

function actionValue(actions: TrainingAction[], action: string): string[] {
  return actions.filter((item) => item.action === action).map((item) => String(item.value ?? ''));
}

export function buildTrainingContext(input: BuildTrainingContextInput): TrainingContext {
  const { activity } = input;
  const snapshot = input.snapshot ?? {};
  const training = snapshot.training ?? {};
  const actions = input.actions ?? (training.actions as unknown as TrainingAction[] | undefined) ?? [];
  const measurements = training.measurements ?? {};
  const actionWrongActions = actions
    .filter((item) => item.action === 'WRONG_ACTION')
    .map((item) => String(item.value ?? 'UNKNOWN'));
  const wrongActions = training.wrongActions?.length ? training.wrongActions : actionWrongActions;
  const hints = input.hintHistory ?? [];
  const sensors = snapshot.sensors ?? { s1: false, s2: false };
  const plc = snapshot.plc ?? { inputs: { s1: false, s2: false }, outputs: { motor: false, cylinder: false } };
  const diagnosisAttempts = actionValue(actions, 'SUBMIT_DIAGNOSIS').filter(Boolean);
  const workpieceAtS2 = Boolean(snapshot.workpiece?.detectedByS2 || snapshot.operationalPhase === 'fault_waiting' || snapshot.operationalPhase === 's2_detected');

  return {
    course: {
      courseId: activity.courseId,
      courseTitle: activity.courseTitle ?? activity.courseId,
      chapterId: activity.chapterId,
      chapterTitle: activity.chapterTitle ?? activity.chapterId,
      activityId: activity.activityId,
      activityTitle: activity.title,
      scenarioId: activity.scenarioId,
      scenarioTitle: activity.scenarioTitle ?? activity.scenarioId,
      learningObjectives: activity.learningObjectives,
    },
    state: {
      currentPhase: snapshot.phase ?? 'intro',
      operationalPhase: snapshot.operationalPhase ?? 'idle',
      systemRunning: Boolean(snapshot.systemRunning),
      machineState: snapshot.faultActive ? 'fault_waiting' : (snapshot.operationalPhase ?? 'idle'),
      sensorS1: { active: Boolean(sensors.s1) },
      sensorS2: {
        active: Boolean(sensors.s2),
        powered: sensors.s2Powered ?? true,
        output: Boolean(sensors.s2Output),
        faulty: Boolean(sensors.s2Faulty ?? snapshot.faultActive),
      },
      motor: { running: Boolean(snapshot.motor) },
      conveyor: { running: Boolean(snapshot.conveyor) },
      cylinder: { extended: Boolean(snapshot.cylinder) },
      plc,
    },
    behavior: {
      actions,
      actionsCount: actions.length,
      inspectedComponents: training.inspectedComponents ?? [],
      measurements,
      diagnosisAttempts,
      wrongActions,
      hintsUsed: hints.length,
      hintHistory: hints,
      elapsedTime: training.elapsedMs ?? 0,
    },
    evidence: {
      workpieceAtS2,
      plcI02: Boolean(plc.inputs.s2),
      sensorS2Powered: sensors.s2Powered ?? true,
      sensorS2Output: Boolean(sensors.s2Output),
      powerMeasured: measurements.s2Power !== undefined,
      outputMeasured: measurements.s2Output !== undefined,
      diagnosisSubmitted: diagnosisAttempts.length > 0 || Boolean(training.diagnosis),
      repairCompleted: Boolean(training.repaired),
      verificationPassed: Boolean(training.verificationPassed),
    },
    ...(input.learningProfile ? { learningProfile: input.learningProfile } : {}),
  };
}
