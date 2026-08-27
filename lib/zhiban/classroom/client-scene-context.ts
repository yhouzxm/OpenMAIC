import type { LearningEventInput } from '@/lib/zhiban/learning-center';

export function attachClassroomSceneContext(input: LearningEventInput): LearningEventInput {
  if (typeof window === 'undefined') return input;
  const params = new URLSearchParams(window.location.search);
  const classroomBindingId = params.get('classroomBindingId');
  const classroomSceneSessionId = params.get('classroomSceneSessionId');
  const sceneId = params.get('sceneId');
  const remediationRunId = params.get('remediationRunId');
  const targetSceneId = params.get('targetSceneId');
  const sourceSceneId = params.get('sourceSceneId');
  const retryTarget = params.get('retryTarget');
  const returnSceneId = params.get('returnSceneId');
  const contextMode = params.get('contextMode');
  const remediationStage = params.get('remediationStage');
  const triggerConceptErrors = (params.get('triggerConceptErrors') ?? '').split(',').filter(Boolean);
  const payload = { ...(input.payload ?? {}) };
  if (classroomBindingId && classroomSceneSessionId && sceneId)
    payload.classroomContext = { classroomBindingId, classroomSceneSessionId, sceneId };
  if (remediationRunId && targetSceneId)
    payload.remediationContext = {
      remediationRunId,
      targetSceneId,
      sourceSceneId,
      retryTarget,
      returnSceneId,
      contextMode: contextMode ?? 'SELF_LEARNING',
      remediationStage: remediationStage ?? 'practice',
      triggerConceptErrors,
    };
  if (!payload.classroomContext && !payload.remediationContext) return input;
  return {
    ...input,
    payload,
  };
}
