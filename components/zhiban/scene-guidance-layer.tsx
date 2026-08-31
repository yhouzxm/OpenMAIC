'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, HelpCircle, Lightbulb, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { attachClassroomSceneContext } from '@/lib/zhiban/classroom/client-scene-context';
import { getScene, enterScene, completeScene } from '@/lib/zhiban/scene-orchestration';
import {
  createGuidanceRequestId,
  isCurrentGuidanceHelpResponse,
  reduceSceneBriefingVisibility,
  resolveSceneEntryDecision,
  resolveSceneGuidanceMode,
  type GuidanceHelpRequest,
  type SceneActionFeedback,
  type SceneGuidanceState,
} from '@/lib/zhiban/scene-orchestration/guidance';
import type { SceneId } from '@/lib/zhiban/scene-orchestration/types';

type Props = {
  courseId: string;
  sceneId: SceneId;
  previewMode?: boolean;
  completed?: boolean;
  recentChallengeCorrect?: boolean;
  consecutiveErrors?: number;
  actionCount?: number;
  progressSummary?: string;
  taskOverride?: string;
  promptOverride?: string;
  feedback?: SceneActionFeedback | null;
  onHighlightTarget?: (targetId: string) => void;
  onRequestHelp?: (request: GuidanceHelpRequest) => Promise<string>;
};

const emptyState = (sceneId: SceneId): SceneGuidanceState => ({
  sceneId,
  visitCount: 0,
  actionCount: 0,
  consecutiveErrors: 0,
  completed: false,
  mastered: false,
  hintLevel: 0,
  mode: 'FULL',
});

async function postSceneEvent(courseId: string, event: ReturnType<typeof enterScene>) {
  await fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(attachClassroomSceneContext(event)),
  });
}

export function SceneGuidanceLayer({
  courseId,
  sceneId,
  previewMode = false,
  completed,
  recentChallengeCorrect,
  consecutiveErrors,
  actionCount,
  progressSummary,
  taskOverride,
  promptOverride,
  feedback,
  onHighlightTarget,
  onRequestHelp,
}: Props) {
  const scene = getScene(sceneId);
  const [persisted, setPersisted] = useState<SceneGuidanceState>(() => emptyState(sceneId));
  const [loaded, setLoaded] = useState(false);
  const mergedStateRef = useRef<SceneGuidanceState>(emptyState(sceneId));
  const [briefingOpen, dispatchBriefing] = useReducer(
    (current: boolean, action: 'AUTO_OPEN' | 'OPEN' | 'CLOSE' | 'TOGGLE') =>
      reduceSceneBriefingVisibility(current, action, mergedStateRef.current),
    false,
  );
  const [helpFeedback, setHelpFeedback] = useState<SceneActionFeedback | null>(null);
  const [helpLoading, setHelpLoading] = useState(false);
  const enteredKeyRef = useRef<string | null>(null);
  const completedReportedRef = useRef(false);
  const latestRequestIdRef = useRef<string | null>(null);
  const currentSceneIdRef = useRef(sceneId);
  const briefingRef = useRef<HTMLElement | null>(null);

  const mergedState = useMemo<SceneGuidanceState>(() => {
    const nextCompleted = completed === true || persisted.completed;
    const nextErrors = consecutiveErrors ?? persisted.consecutiveErrors;
    const hasActiveConceptError =
      persisted.completed &&
      persisted.mode === 'FULL' &&
      persisted.consecutiveErrors === 0 &&
      persisted.visitCount > 0;
    const nextMode = resolveSceneGuidanceMode({
      visitCount: persisted.visitCount,
      consecutiveErrors: nextErrors,
      completed: nextCompleted,
      latestChallengeCorrect: recentChallengeCorrect ?? persisted.mastered,
      hasActiveConceptError,
    });
    return {
      ...persisted,
      completed: nextCompleted,
      consecutiveErrors: nextErrors,
      actionCount: actionCount ?? persisted.actionCount,
      ...nextMode,
    };
  }, [actionCount, completed, consecutiveErrors, persisted, recentChallengeCorrect]);
  mergedStateRef.current = mergedState;

  useEffect(() => {
    currentSceneIdRef.current = sceneId;
    latestRequestIdRef.current = null;
    completedReportedRef.current = false;
    setHelpFeedback(null);
  }, [sceneId]);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    void fetch(`/api/zhiban/student/courses/${courseId}/learning-center`)
      .then(async (response) => {
        if (!response.ok) throw new Error('guidance state unavailable');
        const body = (await response.json()) as {
          guidanceStates?: Partial<Record<SceneId, SceneGuidanceState>>;
        };
        if (active) setPersisted(body.guidanceStates?.[sceneId] ?? emptyState(sceneId));
      })
      .catch(() => {
        if (active) setPersisted(emptyState(sceneId));
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [courseId, sceneId]);

  useEffect(() => {
    if (!loaded) return;
    dispatchBriefing('AUTO_OPEN');
    const decision = resolveSceneEntryDecision({
      lastRecordedKey: enteredKeyRef.current,
      courseId,
      sceneId,
      previewMode,
    });
    if (!decision.shouldRecord) return;
    enteredKeyRef.current = decision.key;
    void postSceneEvent(courseId, enterScene(sceneId)).catch(() => undefined);
  }, [courseId, loaded, previewMode, sceneId]);

  useEffect(() => {
    if (!loaded || previewMode || !mergedState.completed || persisted.completed)
      return;
    if (completedReportedRef.current) return;
    completedReportedRef.current = true;
    void postSceneEvent(courseId, completeScene(sceneId)).catch(() => undefined);
  }, [courseId, loaded, mergedState.completed, persisted.completed, previewMode, sceneId]);

  useEffect(() => {
    if (!briefingOpen) return;
    briefingRef.current?.scrollIntoView({ block: 'nearest' });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dispatchBriefing('CLOSE');
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [briefingOpen]);

  const requestHelp = useCallback(async () => {
    if (!scene?.guidance || helpLoading) return;
    const requestId = createGuidanceRequestId();
    const request = { sceneId, requestId } satisfies GuidanceHelpRequest;
    latestRequestIdRef.current = requestId;
    setHelpLoading(true);
    if (!previewMode)
      void fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          attachClassroomSceneContext({
            stationId: scene.stationId,
            eventType: 'REQUEST_AI_HELP',
            payload: { sceneId, requestId, source: 'scene-guidance' },
            timestamp: new Date().toISOString(),
          }),
        ),
      }).catch(() => undefined);
    try {
      const message = onRequestHelp
        ? await onRequestHelp(request)
        : scene.guidance.firstActionPrompt ?? '请先观察当前任务中的可操作对象。';
      if (
        !isCurrentGuidanceHelpResponse({
          currentSceneId: currentSceneIdRef.current,
          latestRequestId: latestRequestIdRef.current,
          responseSceneId: sceneId,
          responseRequestId: requestId,
        })
      )
        return;
      setHelpFeedback({
        action: '已请求学习提示',
        result: message,
        nextFocus: scene.guidance.firstActionPrompt ?? '回到当前任务继续观察和操作。',
        tone: 'neutral',
      });
    } catch {
      if (latestRequestIdRef.current !== requestId || currentSceneIdRef.current !== sceneId)
        return;
      setHelpFeedback({
        action: '学习伙伴暂时繁忙',
        result: scene.guidance.firstActionPrompt ?? '已切换为本地教学提示。',
        nextFocus: '当前任务不受影响，可以继续操作。',
        tone: 'neutral',
      });
    } finally {
      if (latestRequestIdRef.current === requestId) setHelpLoading(false);
    }
  }, [courseId, helpLoading, onRequestHelp, previewMode, scene, sceneId]);

  if (!scene?.guidance) return null;
  const guidance = scene.guidance;
  const visibleFeedback = feedback ?? helpFeedback;
  const compact = mergedState.mode !== 'FULL';

  return (
    <>
      <div
        className="sticky top-2 z-10 rounded-xl border border-blue-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur"
        data-scene-guidance={sceneId}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">当前任务</Badge>
              <b className="truncate text-sm text-slate-900">{taskOverride ?? guidance.task}</b>
              {mergedState.completed && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                  <CheckCircle2 className="size-3.5" /> 已完成
                </span>
              )}
            </div>
            {!compact && (
              <p className="mt-1 line-clamp-1 text-xs text-slate-600">
                {promptOverride ?? guidance.firstActionPrompt ?? guidance.observeItems?.[0]}
              </p>
            )}
            <p className="mt-1 line-clamp-1 text-xs text-slate-500">
              {progressSummary ?? `完成条件：${guidance.completionCriteria.join('；')}`}
            </p>
            {visibleFeedback && (
              <p className="mt-1 line-clamp-1 text-xs text-blue-800" aria-live="polite">
                <b>当前反馈：</b>{visibleFeedback.result}；下一步：{visibleFeedback.nextFocus}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`${briefingOpen ? '收起' : '查看'}${scene.title}任务说明`}
              aria-expanded={briefingOpen}
              aria-controls={`scene-task-briefing-${sceneId}`}
              onClick={() => dispatchBriefing('TOGGLE')}
            >
              <BookOpen className="mr-1 size-4" /> {briefingOpen ? '收起说明' : '任务说明'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`获取${scene.title}学习提示`}
              disabled={helpLoading || previewMode}
              onClick={() => void requestHelp()}
            >
              <HelpCircle className="mr-1 size-4" />
              {previewMode ? '预览模式' : helpLoading ? '正在提示' : '需要提示'}
            </Button>
          </div>
        </div>
      </div>

      <section className="space-y-2">
        {briefingOpen && (
          <section
            id={`scene-task-briefing-${sceneId}`}
            ref={briefingRef}
            role="dialog"
            aria-modal="false"
            aria-label={`${scene.title}任务说明`}
            className="scroll-mt-24 rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm"
          >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge className="bg-blue-700 text-white hover:bg-blue-700">任务说明</Badge>
              <h2 className="mt-2 text-lg font-semibold text-blue-950">{scene.title}</h2>
              {guidance.objective && (
                <p className="mt-1 text-sm text-blue-900">学习目标：{guidance.objective}</p>
              )}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="关闭任务说明"
              onClick={() => dispatchBriefing('CLOSE')}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
            <div>
              <b>观察什么</b>
              <ul className="mt-1 space-y-1">
                {(guidance.observeItems ?? [guidance.task]).map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </div>
            <div>
              <b>可以操作</b>
              <ul className="mt-1 space-y-1">
                {(guidance.operableTargets ?? []).map((target) => (
                  <li key={target.id}>· {target.label}：{target.action}</li>
                ))}
              </ul>
            </div>
            <div>
              <b>完成条件</b>
              <ul className="mt-1 space-y-1">
                {guidance.completionCriteria.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
              {guidance.estimatedMinutes && (
                <p className="mt-2 text-xs text-slate-500">
                  当前任务预计：{guidance.estimatedMinutes}分钟
                </p>
              )}
            </div>
          </div>
          <Button type="button" className="mt-4" onClick={() => dispatchBriefing('CLOSE')}>
            开始任务
          </Button>
          </section>
        )}

        {mergedState.mode === 'FULL' && mergedState.actionCount === 0 && !visibleFeedback && (
          <div className="motion-safe:animate-[pulse_1.4s_ease-in-out_2] rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm text-cyan-950">
            <span className="inline-flex items-center gap-2">
              <Lightbulb className="size-4" />
              等待你进行：{guidance.firstActionPrompt ?? guidance.task}
            </span>
            {guidance.operableTargets?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {guidance.operableTargets.map((target) =>
                  onHighlightTarget ? (
                    <button
                      key={target.id}
                      type="button"
                      className="rounded-full border border-cyan-300 bg-white px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      aria-label={`高亮${target.label}：${target.action}`}
                      onClick={() => onHighlightTarget(target.id)}
                    >
                      {target.label}
                    </button>
                  ) : (
                    <span key={target.id} className="rounded-full border border-cyan-300 bg-white px-2 py-1 text-xs">
                      {target.label}
                    </span>
                  ),
                )}
              </div>
            ) : null}
          </div>
        )}

        <div aria-live="polite" aria-atomic="true">
          {visibleFeedback && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                visibleFeedback.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : visibleFeedback.tone === 'warning'
                    ? 'border-amber-200 bg-amber-50 text-amber-950'
                    : 'border-blue-200 bg-blue-50 text-blue-950'
              }`}
            >
              <p><b>你做了什么：</b>{visibleFeedback.action}</p>
              <p className="mt-1"><b>系统发生了什么：</b>{visibleFeedback.result}</p>
              <p className="mt-1"><b>下一步关注：</b>{visibleFeedback.nextFocus}</p>
            </div>
          )}
          {!visibleFeedback && mergedState.completed && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
              {guidance.completionFeedback ?? guidance.successFeedback ?? '本场景任务已完成。'}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
