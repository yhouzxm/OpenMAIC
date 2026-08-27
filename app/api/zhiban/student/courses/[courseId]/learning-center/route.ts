import { NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import {
  canPrincipalAccessLearningStation,
  getLearningCenterSummaryForPrincipal,
  recordKnowledgeLearningEvent,
} from '@/lib/zhiban/learning-center/service';
import { isTeacherPreviewPrincipal } from '@/lib/zhiban/learning-center/access';
import {
  requireMechatronicsStudentEnrollment,
  resolveMechatronicsCourse,
} from '@/lib/zhiban/mechatronics-course';
import {
  LEARNING_EVENT_TYPES,
  STATION_IDS,
  type LearningEventInput,
} from '@/lib/zhiban/learning-center';
import { getScene } from '@/lib/zhiban/scene-orchestration';
import { extractConceptErrorsFromLearningEvent, recordClassroomSceneLearningEvent } from '@/lib/zhiban/classroom';

function classroomContext(payload: Record<string, unknown>) {
  const value = payload.classroomContext;
  if (!value || typeof value !== 'object') return null;
  const context = value as Record<string, unknown>;
  if (
    typeof context.classroomBindingId !== 'string' ||
    typeof context.classroomSceneSessionId !== 'string' ||
    typeof context.sceneId !== 'string'
  ) return null;
  return context as { classroomBindingId: string; classroomSceneSessionId: string; sceneId: string };
}

function remediationContext(payload: Record<string, unknown>) {
  const value = payload.remediationContext;
  if (!value || typeof value !== 'object') return null;
  const context = value as Record<string, unknown>;
  if (typeof context.remediationRunId !== 'string' || typeof context.targetSceneId !== 'string')
    return null;
  return {
    remediationRunId: context.remediationRunId,
    targetSceneId: context.targetSceneId,
    sourceSceneId: typeof context.sourceSceneId === 'string' ? context.sourceSceneId : null,
    retryTarget: typeof context.retryTarget === 'string' ? context.retryTarget : 'learning-path',
    returnSceneId: typeof context.returnSceneId === 'string' ? context.returnSceneId : null,
    contextMode: typeof context.contextMode === 'string' ? context.contextMode : 'SELF_LEARNING',
    remediationStage: typeof context.remediationStage === 'string' ? context.remediationStage : 'practice',
    triggerConceptErrors: Array.isArray(context.triggerConceptErrors) ? context.triggerConceptErrors : [],
  };
}

function checkpointMatches(retryTarget: string, input: LearningEventInput) {
  if (input.eventType !== 'SUBMIT_MICRO_EXERCISE') return false;
  const exercise = String(input.payload?.exercise ?? '');
  if (exercise === retryTarget) return true;
  return (
    exercise === 'M08' &&
    typeof input.payload?.scenarioType === 'string' &&
    retryTarget === `M08-${input.payload.scenarioType}`
  );
}

function isSceneCompletion(sceneId: string, input: LearningEventInput) {
  if (input.eventType === 'COMPLETE_SCENE') return true;
  const scene = getScene(sceneId);
  if (!scene || scene.completionRule.type !== 'learning_event') return false;
  const exercises = scene.completionRule.exerciseIds ?? [];
  if (exercises.length) {
    if (input.eventType !== 'SUBMIT_MICRO_EXERCISE') return false;
    const expected = exercises.at(-1);
    if (input.payload?.exercise === expected) return true;
    return (
      input.payload?.exercise === 'M08' &&
      typeof input.payload.scenarioType === 'string' &&
      expected === `M08-${input.payload.scenarioType}`
    );
  }
  const points = scene.completionRule.knowledgePointIds ?? [];
  return input.eventType === 'COMPLETE_KNOWLEDGE_POINT' && input.knowledgePointId === points.at(-1);
}

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId } = await params;
    const pool = getZhibanPool();
    const course =
      principal.accountType === 'student'
        ? await requireMechatronicsStudentEnrollment(pool, principal, courseId)
        : await resolveMechatronicsCourse(pool, principal, courseId);
    if (!course)
      return NextResponse.json({ error: '课程未绑定机电智能诊断学习中心' }, { status: 404 });
    return NextResponse.json({
      ...(await getLearningCenterSummaryForPrincipal(pool, principal, course.id)),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '学习进度加载失败' },
        { status: 400 },
      )
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId } = await params;
    const pool = getZhibanPool();
    const course =
      principal.accountType === 'student'
        ? await requireMechatronicsStudentEnrollment(pool, principal, courseId)
        : await resolveMechatronicsCourse(pool, principal, courseId);
    if (!course)
      return NextResponse.json({ error: '课程未绑定机电智能诊断学习中心' }, { status: 404 });
    const body = (await request.json().catch(() => null)) as Partial<LearningEventInput> | null;
    if (
      !body ||
      typeof body.stationId !== 'string' ||
      !STATION_IDS.includes(body.stationId as (typeof STATION_IDS)[number]) ||
      typeof body.eventType !== 'string' ||
      !LEARNING_EVENT_TYPES.includes(body.eventType as (typeof LEARNING_EVENT_TYPES)[number])
    )
      return NextResponse.json({ error: '无效的学习事件' }, { status: 400 });
    const input = {
      stationId: body.stationId as LearningEventInput['stationId'],
      knowledgePointId:
        typeof body.knowledgePointId === 'string' ? body.knowledgePointId : undefined,
      eventType: body.eventType as LearningEventInput['eventType'],
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      isCorrect: typeof body.isCorrect === 'boolean' ? body.isCorrect : undefined,
      attempt:
        typeof body.attempt === 'number' && Number.isFinite(body.attempt)
          ? Math.max(1, Math.floor(body.attempt))
          : 1,
      timestamp: typeof body.timestamp === 'string' ? body.timestamp : undefined,
    } satisfies LearningEventInput;
    if (isTeacherPreviewPrincipal(principal, course.id))
      return NextResponse.json({ preview: true, event: null });
    const access = await canPrincipalAccessLearningStation(
      pool,
      principal,
      course.id,
      input.stationId,
    );
    if (!access.decision.allowed)
      return NextResponse.json(
        { error: access.decision.reason ?? '请先完成前置学习站' },
        { status: 403 },
      );
    const event = await recordKnowledgeLearningEvent(pool, principal, course.id, input);
    const context = classroomContext(input.payload ?? {});
    if (context) {
      const scene = getScene(context.sceneId);
      if (scene?.stationId === input.stationId) {
        await recordClassroomSceneLearningEvent(pool, principal, context.classroomBindingId, {
          sceneId: context.sceneId,
          classroomSceneSessionId: context.classroomSceneSessionId,
          eventType: isSceneCompletion(context.sceneId, input) ? 'COMPLETE_SCENE' : 'INTERACTING',
          isCorrect: input.isCorrect,
          firstChoice: typeof input.payload?.firstChoice === 'string' ? input.payload.firstChoice : null,
          durationMs: typeof input.payload?.durationMs === 'number' ? input.payload.durationMs : null,
          conceptErrors: extractConceptErrorsFromLearningEvent(input.payload),
          attempt: input.attempt,
          payload: { knowledgeEventId: event.id, learningEventType: input.eventType },
          timestamp: input.timestamp ?? new Date().toISOString(),
        }).catch(() => undefined);
      }
    }
    const remediation = remediationContext(input.payload ?? {});
    if (remediation) {
      const sharedPayload = {
        remediationRunId: remediation.remediationRunId,
        sourceSceneId: remediation.sourceSceneId,
        targetSceneId: remediation.targetSceneId,
        triggerConceptErrors: remediation.triggerConceptErrors,
        contextMode: remediation.contextMode,
        retryTarget: remediation.retryTarget,
        returnSceneId: remediation.returnSceneId,
      };
      if (
        remediation.remediationStage !== 'retry' &&
        isSceneCompletion(remediation.targetSceneId, input) &&
        input.isCorrect !== false
      )
        await recordKnowledgeLearningEvent(pool, principal, course.id, {
          stationId: input.stationId,
          eventType: 'REMEDIATION_SCENE_COMPLETED',
          payload: {
            ...sharedPayload,
            result: { isCorrect: input.isCorrect ?? null, sourceEventId: event.id },
            durationMs: typeof input.payload?.durationMs === 'number' ? input.payload.durationMs : null,
            newConceptErrors: [],
          },
          timestamp: input.timestamp,
        }).catch(() => undefined);
      if (remediation.remediationStage === 'retry' && checkpointMatches(remediation.retryTarget, input)) {
        const newConceptErrors = extractConceptErrorsFromLearningEvent(input.payload);
        await recordKnowledgeLearningEvent(pool, principal, course.id, {
          stationId: input.stationId,
          eventType: 'REMEDIATION_RETRY_COMPLETED',
          isCorrect: input.isCorrect,
          payload: {
            ...sharedPayload,
            before: { conceptErrors: remediation.triggerConceptErrors },
            after: {
              isCorrect: input.isCorrect ?? null,
              attempt: input.attempt ?? 1,
              durationMs: typeof input.payload?.durationMs === 'number' ? input.payload.durationMs : null,
              conceptErrors: newConceptErrors,
            },
            resolvedConceptErrors: input.isCorrect ? remediation.triggerConceptErrors : [],
            newConceptErrors,
          },
          timestamp: input.timestamp,
        }).catch(() => undefined);
      }
    }
    return NextResponse.json({ event, mode: access.decision.mode });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '学习事件保存失败' },
        { status: 400 },
      )
    );
  }
}
