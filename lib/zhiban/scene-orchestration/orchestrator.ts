import type { ConceptErrorCode, LearningEventInput } from '@/lib/zhiban/learning-center/types';
import { SCENE_DEFINITION_BY_ID, SCENE_DEFINITIONS } from './registry';
import type {
  ResolvedSceneComponent,
  SceneAccessContext,
  SceneAccessDecision,
  SceneDefinition,
  SceneId,
  SceneLifecycleState,
} from './types';

export function getScene(sceneId: string): SceneDefinition | null {
  return SCENE_DEFINITION_BY_ID.get(sceneId as SceneId) ?? null;
}

export function getStationScenes(stationId: string): SceneDefinition[] {
  return SCENE_DEFINITIONS.filter((definition) => definition.stationId === stationId);
}

export function getNextScene(sceneId: string): SceneDefinition | null {
  const index = SCENE_DEFINITIONS.findIndex((definition) => definition.id === sceneId);
  return index >= 0 ? (SCENE_DEFINITIONS[index + 1] ?? null) : null;
}

export function canEnterScene(sceneId: string, context: SceneAccessContext): SceneAccessDecision {
  const definition = getScene(sceneId);
  if (!definition)
    return { allowed: false, reason: '学习场景不存在', missingPrerequisiteSceneId: null };
  const completed = new Set(context.completedSceneIds);
  const missing = definition.prerequisites.find((id) => !completed.has(id)) ?? null;
  if (missing)
    return {
      allowed: false,
      reason: `请先完成场景 ${missing}`,
      missingPrerequisiteSceneId: missing,
    };
  if (
    definition.completionRule.type === 'station_profile' &&
    context.hasVirtualLabAssessment === false
  )
    return {
      allowed: false,
      reason: '完成综合实训并生成评价后进入',
      missingPrerequisiteSceneId: 'S06-03',
    };
  return { allowed: true, reason: null, missingPrerequisiteSceneId: null };
}

export function resolveSceneComponent(sceneId: string): ResolvedSceneComponent | null {
  const definition = getScene(sceneId);
  if (!definition) return null;
  return {
    componentKey: definition.componentKey ?? null,
    interactiveTemplate: definition.interactiveTemplate ?? null,
    activityId: definition.activityId ?? null,
    scenarioId: definition.scenarioId ?? null,
  };
}

export function enterScene(
  sceneId: SceneId,
  payload: Record<string, unknown> = {},
): LearningEventInput {
  const definition = SCENE_DEFINITION_BY_ID.get(sceneId);
  if (!definition) throw new Error(`Unknown scene: ${sceneId}`);
  return {
    stationId: definition.stationId,
    eventType: 'ENTER_SCENE',
    payload: { ...payload, sceneId, lifecycle: 'ENTERED' },
  };
}

export function completeScene(
  sceneId: SceneId,
  payload: Record<string, unknown> = {},
): LearningEventInput {
  const definition = SCENE_DEFINITION_BY_ID.get(sceneId);
  if (!definition) throw new Error(`Unknown scene: ${sceneId}`);
  return {
    stationId: definition.stationId,
    eventType: 'COMPLETE_SCENE',
    payload: { ...payload, sceneId, lifecycle: 'COMPLETED' },
  };
}

export function detectSceneMisconception(
  sceneId: SceneId,
  conceptErrors: ConceptErrorCode[],
  payload: Record<string, unknown> = {},
): LearningEventInput {
  const definition = SCENE_DEFINITION_BY_ID.get(sceneId);
  if (!definition) throw new Error(`Unknown scene: ${sceneId}`);
  return {
    stationId: definition.stationId,
    eventType: 'SUBMIT_MICRO_EXERCISE',
    isCorrect: false,
    payload: {
      ...payload,
      sceneId,
      lifecycle: 'MISCONCEPTION_DETECTED',
      conceptErrors,
    },
  };
}

export function enterRemediationScene(
  sceneId: SceneId,
  payload: Record<string, unknown> = {},
): LearningEventInput {
  const definition = SCENE_DEFINITION_BY_ID.get(sceneId);
  if (!definition) throw new Error(`Unknown scene: ${sceneId}`);
  return {
    stationId: definition.stationId,
    eventType: 'REMEDIATION_SCENE_ENTERED',
    payload: { ...payload, sceneId, lifecycle: 'RETRYING' },
  };
}

const lifecycleTransitions: Record<SceneLifecycleState, readonly SceneLifecycleState[]> = {
  READY: ['ENTERED'],
  ENTERED: ['INTERACTING', 'COMPLETED', 'MISCONCEPTION_DETECTED'],
  INTERACTING: ['COMPLETED', 'MISCONCEPTION_DETECTED'],
  COMPLETED: ['RETRYING'],
  MISCONCEPTION_DETECTED: ['INTERACTING', 'REMEDIATION_RECOMMENDED'],
  REMEDIATION_RECOMMENDED: ['RETRYING'],
  RETRYING: ['INTERACTING', 'COMPLETED', 'MISCONCEPTION_DETECTED'],
};

export function canTransitionSceneLifecycle(
  from: SceneLifecycleState,
  to: SceneLifecycleState,
): boolean {
  return lifecycleTransitions[from].includes(to);
}
