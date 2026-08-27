export const LEARNING_CENTER_COURSE_ID = 'mech-mechatronics-system' as const;

export const STATION_IDS = [
  'station-01-system',
  'station-02-sensing',
  'station-03-control',
  'station-04-actuation',
  'station-05-diagnosis',
  'station-06-virtual-lab',
  'station-07-assessment',
] as const;
export type StationId = (typeof STATION_IDS)[number];

export const LEARNING_EVENT_TYPES = [
  'VIEW_KNOWLEDGE_POINT',
  'CLICK_COMPONENT',
  'CLASSIFY_COMPONENT',
  'SEQUENCE_STEP',
  'MOVE_WORKPIECE',
  'PREDICT_SENSOR_STATE',
  'MEASURE_POWER',
  'MEASURE_OUTPUT',
  'MAP_IO',
  'SELECT_IO_TYPE',
  'PLC_SCAN_STEP',
  'LADDER_TOGGLE',
  'EXECUTION_SEQUENCE',
  'OUTPUT_TOGGLE',
  'VIEW_DIAGNOSIS_SCENARIO',
  'SELECT_DIAGNOSIS_LAYER',
  'SELECT_DIAGNOSIS_EVIDENCE',
  'SUBMIT_MICRO_EXERCISE',
  'REQUEST_AI_HELP',
  'ENTER_SCENE',
  'COMPLETE_SCENE',
  'REMEDIATION_SCENE_ENTERED',
  'REMEDIATION_RECOMMENDED',
  'REMEDIATION_SCENE_COMPLETED',
  'REMEDIATION_RETRY_STARTED',
  'REMEDIATION_RETRY_COMPLETED',
  'COMPLETE_KNOWLEDGE_POINT',
  'COMPLETE_STATION',
] as const;
export type LearningEventType = (typeof LEARNING_EVENT_TYPES)[number];

export interface KnowledgePointDefinition {
  id: string;
  stationId: StationId;
  title: string;
  description: string;
  learningObjective: string;
  interactionType:
    | 'scene_identification'
    | 'classification'
    | 'flow_sequence'
    | 'sensor_simulation'
    | 'prediction'
    | 'measurement'
    | 'signal_mapping'
    | 'plc_simulation'
    | 'ladder_logic'
    | 'execution_chain';
  estimatedMinutes: number;
  prerequisites: string[];
  relatedActivityId?: string;
  relatedScenarioId?: string;
}

export interface KnowledgeStationDefinition {
  id: StationId;
  title: string;
  objective: string;
  estimatedMinutes: number;
  knowledgePointIds: string[];
  available: boolean;
}

export interface LearningEventInput {
  stationId: StationId;
  knowledgePointId?: string;
  eventType: LearningEventType;
  payload?: Record<string, unknown>;
  isCorrect?: boolean;
  attempt?: number;
  timestamp?: string;
}

export interface LearningEvent extends LearningEventInput {
  id: string;
  courseId: string;
  timestamp: string;
}

export interface KnowledgePointProgress {
  knowledgePointId: string;
  completed: boolean;
  attempts: number;
  lastEventAt: string | null;
  correct: boolean | null;
}

export interface StationProgress {
  stationId: StationId;
  status: 'not_started' | 'in_progress' | 'completed';
  progressPercent: number;
  completedKnowledgePoints: number;
  totalKnowledgePoints: number;
  lastEventAt: string | null;
}

export interface LearningCenterProgress {
  courseId: string;
  stations: Record<StationId, StationProgress>;
  knowledgePoints: Record<string, KnowledgePointProgress>;
  eventCount: number;
  persistenceAvailable: boolean;
}

export interface KnowledgeLearningContext {
  courseId: string;
  courseTitle: string;
  stationId: StationId;
  stationTitle: string;
  knowledgePointId?: string;
  knowledgePointTitle?: string;
  currentInteraction: string;
  studentAttempts: number;
  incorrectConcepts: string[];
  conceptErrors?: ConceptErrorCode[];
  microExercise?: string;
  predictionHistory?: Array<Record<string, unknown>>;
}

export const CONCEPT_ERROR_CODES = [
  'POWER_EQUALS_SENSOR_NORMAL',
  'INPUT_OUTPUT_CONFUSION',
  'FIELD_IO_MAPPING_ERROR',
  'PLC_SCAN_SEQUENCE_ERROR',
  'LADDER_LOGIC_CONFUSION',
  'CONTROL_EXECUTION_CONFUSION',
  'OUTPUT_EQUALS_ACTUATION_SUCCESS',
  'SENSING_LAYER_CONFUSION',
  'CONTROL_LAYER_CONFUSION',
  'ACTUATION_LAYER_CONFUSION',
  'EVIDENCE_SELECTION_ERROR',
] as const;
export type ConceptErrorCode = (typeof CONCEPT_ERROR_CODES)[number];

export const AI_LEARNING_MODES = [
  'knowledge_companion',
  'cognitive_diagnosis',
  'training_coach',
  'assessment_mentor',
] as const;
export type AiLearningMode = (typeof AI_LEARNING_MODES)[number];

export const LEARNING_CENTER_DIMENSIONS = [
  'systemUnderstanding',
  'sensorDetection',
  'plcSignalAnalysis',
  'toolMeasurement',
  'evidenceReasoning',
  'faultDiagnosisVerification',
] as const;
export type LearningCenterDimensionKey = (typeof LEARNING_CENTER_DIMENSIONS)[number];

export interface LearningCenterDimensionResult {
  score: number;
  evidenceCount: number;
  sources: string[];
  reason: string;
}

export interface LearningCenterRecommendation {
  dimension: LearningCenterDimensionKey;
  stationId: StationId;
  title: string;
  reason: string;
  priority: 'high' | 'medium';
  sceneId?: string;
}

export interface LearningCenterProfile {
  overallProgress: number;
  dimensions: Record<LearningCenterDimensionKey, LearningCenterDimensionResult>;
  conceptErrors: { code: ConceptErrorCode; count: number; stationId: StationId }[];
  strengths: string[];
  weaknesses: string[];
  recommendations: LearningCenterRecommendation[];
  virtualLab: {
    latestScore: number | null;
    attempts: number;
    scoreChange: number | null;
    durationChangeSeconds: number | null;
    hintsChange: number | null;
  };
}
