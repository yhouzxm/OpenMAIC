import type { MechLabActivityContext, MechLabSceneStatePayload } from '../types';

export type TrainingDiagnosisStage =
  | 'OBSERVATION'
  | 'SIGNAL_INSPECTION'
  | 'MEASUREMENT'
  | 'DIAGNOSIS'
  | 'REPAIR'
  | 'VERIFICATION';

export type TrainingDiagnosisFlag =
  | 'NO_EVIDENCE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'WRONG_DIRECTION'
  | 'REPEATED_WRONG_ACTION'
  | 'READY_TO_DIAGNOSE'
  | 'READY_TO_REPAIR'
  | 'READY_TO_VERIFY';

export interface VirtualLabLearningProfile {
  sensorKnowledgeMastery?: number;
  plcKnowledgeMastery?: number;
  weakPoints?: string[];
  previousVirtualLabPerformance?: Record<string, unknown>;
}

export interface TrainingAction {
  timestamp: string;
  action: string;
  target?: string;
  value?: string | number;
  unit?: string;
  phase?: string;
}

export interface TrainingHintRecord {
  timestamp: string;
  hintLevel: 1 | 2 | 3;
  trainingPhase: string;
  diagnosisState: string;
  message: string;
  actionsCountAtHint: number;
  wrongActionsAtHint: number;
  fallback: boolean;
}

export interface TrainingContext {
  course: {
    courseId: string;
    courseTitle: string;
    chapterId: string;
    chapterTitle: string;
    activityId: string;
    activityTitle: string;
    scenarioId: string;
    scenarioTitle: string;
    learningObjectives: string[];
  };
  state: {
    currentPhase: string;
    operationalPhase: string;
    systemRunning: boolean;
    machineState: string;
    sensorS1: { active: boolean };
    sensorS2: { active: boolean; powered: boolean; output: boolean; faulty: boolean };
    motor: { running: boolean };
    conveyor: { running: boolean };
    cylinder: { extended: boolean };
    plc: MechLabSceneStatePayload['plc'];
  };
  behavior: {
    actions: TrainingAction[];
    actionsCount: number;
    inspectedComponents: string[];
    measurements: { s2Power?: number; s2Output?: number };
    diagnosisAttempts: string[];
    wrongActions: string[];
    hintsUsed: number;
    hintHistory: TrainingHintRecord[];
    elapsedTime: number;
  };
  evidence: {
    workpieceAtS2: boolean;
    plcI02: boolean;
    sensorS2Powered: boolean;
    sensorS2Output: boolean;
    powerMeasured: boolean;
    outputMeasured: boolean;
    diagnosisSubmitted: boolean;
    repairCompleted: boolean;
    verificationPassed: boolean;
  };
  learningProfile?: VirtualLabLearningProfile;
}

export interface BuildTrainingContextInput {
  activity: MechLabActivityContext;
  snapshot?: Partial<MechLabSceneStatePayload>;
  actions?: TrainingAction[];
  hintHistory?: TrainingHintRecord[];
  learningProfile?: VirtualLabLearningProfile;
}

export interface TrainingDiagnosis {
  stage: TrainingDiagnosisStage;
  flags: TrainingDiagnosisFlag[];
}

export interface CoachResponse {
  message: string;
  hintLevel: 1 | 2 | 3;
  diagnosisState: TrainingDiagnosisStage;
  diagnosisFlags: TrainingDiagnosisFlag[];
  fallback: boolean;
  notice?: string;
}
