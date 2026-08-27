import type {
  AiLearningMode,
  ConceptErrorCode,
  LearningEventType,
  StationId,
} from '@/lib/zhiban/learning-center/types';

export const SCENE_IDS = [
  'S01-01',
  'S01-02',
  'S01-03',
  'S01-04',
  'S02-01',
  'S02-02',
  'S02-03',
  'S02-04',
  'S03-01',
  'S03-02',
  'S03-03',
  'S03-04',
  'S04-01',
  'S04-02',
  'S04-03',
  'S05-01',
  'S05-02',
  'S05-03',
  'S05-04',
  'S06-01',
  'S06-02',
  'S06-03',
  'S07-01',
  'S07-02',
  'S07-03',
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

export const SCENE_REUSE_STRATEGIES = [
  'REUSE_DIRECT',
  'REUSE_WITH_WRAPPER',
  'ENHANCE_EXISTING',
  'NEW',
] as const;
export type SceneReuseStrategy = (typeof SCENE_REUSE_STRATEGIES)[number];

export const SCENE_LIFECYCLE_STATES = [
  'READY',
  'ENTERED',
  'INTERACTING',
  'COMPLETED',
  'MISCONCEPTION_DETECTED',
  'REMEDIATION_RECOMMENDED',
  'RETRYING',
] as const;
export type SceneLifecycleState = (typeof SCENE_LIFECYCLE_STATES)[number];

export type SceneType =
  | 'briefing'
  | 'exploration'
  | 'classification'
  | 'simulation'
  | 'measurement'
  | 'mapping'
  | 'diagnosis'
  | 'virtual_lab'
  | 'assessment'
  | 'remediation';

export type OpenMaicCapability =
  | 'interactive_html'
  | 'visualization3d'
  | 'diagram'
  | 'simulation'
  | 'pbl'
  | 'virtual_lab'
  | 'assessment'
  | 'analytics';

export interface SceneCompletionRule {
  type: 'learning_event' | 'virtual_lab_assessment' | 'station_profile';
  eventType?: LearningEventType;
  knowledgePointIds?: string[];
  exerciseIds?: string[];
}

export interface SceneDefinition {
  id: SceneId;
  stationId: StationId;
  title: string;
  description: string;
  sceneType: SceneType;
  reuseStrategy: SceneReuseStrategy;
  openmaicCapabilities: OpenMaicCapability[];
  learningMode: 'knowledge' | 'practice' | 'diagnosis' | 'assessment';
  aiMode: AiLearningMode;
  prerequisites: SceneId[];
  completionRule: SceneCompletionRule;
  remediationFor: ConceptErrorCode[];
  componentKey?: string;
  interactiveTemplate?: string;
  activityId?: string;
  scenarioId?: string;
  metadata: Record<string, unknown>;
}

export interface SceneAccessContext {
  completedSceneIds: readonly SceneId[];
  hasVirtualLabAssessment?: boolean;
}

export interface SceneAccessDecision {
  allowed: boolean;
  reason: string | null;
  missingPrerequisiteSceneId: SceneId | null;
}

export interface ResolvedSceneComponent {
  componentKey: string | null;
  interactiveTemplate: string | null;
  activityId: string | null;
  scenarioId: string | null;
}
