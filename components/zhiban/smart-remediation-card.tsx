'use client';

import Link from 'next/link';
import { BrainCircuit, Clock3, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import {
  createRemediationFallback,
  getScene,
  sanitizeRemediationExplanation,
  type RemediationRecommendation,
  type RemediationRunSummary,
} from '@/lib/zhiban/scene-orchestration';

async function postEvent(
  courseId: string,
  stationId: string,
  eventType: string,
  payload: Record<string, unknown>,
  keepalive = false,
) {
  return fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, {
    method: 'POST', keepalive,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stationId, eventType, payload, timestamp: new Date().toISOString() }),
  });
}

function runPayload(runId: string, recommendation: RemediationRecommendation) {
  return {
    remediationRunId: runId,
    sourceSceneId: recommendation.sourceSceneId,
    targetSceneId: recommendation.sceneId,
    triggerConceptErrors: recommendation.triggerConceptErrors,
    contextMode: recommendation.contextMode,
    retryTarget: recommendation.retryTarget,
    returnSceneId: recommendation.returnSceneId,
    reasonCode: recommendation.reasonCode,
  };
}

export function SmartRemediationCard({
  courseId,
  recommendation,
  onDismiss,
}: {
  courseId: string;
  recommendation: RemediationRecommendation;
  onDismiss?: () => void;
}) {
  const runId = useRef(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const reported = useRef(false);
  const target = getScene(recommendation.sceneId)!;
  const source = recommendation.sourceSceneId ? getScene(recommendation.sourceSceneId) : null;
  const aiMode = recommendation.contextMode === 'POST_ASSESSMENT'
    ? 'assessment_mentor'
    : 'cognitive_diagnosis';
  const fallback = useMemo(() => createRemediationFallback(recommendation), [recommendation]);
  const [explanation, setExplanation] = useState(fallback);
  const [syncWarning, setSyncWarning] = useState('');
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    const payload = runPayload(runId.current, recommendation);
    void postEvent(courseId, source?.stationId ?? target.stationId, 'REMEDIATION_RECOMMENDED', payload)
      .then((response) => { if (!response.ok) setSyncWarning('学习记录暂未同步，不影响本次学习。'); })
      .catch(() => setSyncWarning('学习记录暂未同步，不影响本次学习。'));
    const load = async () => {
      try {
        const model = getCurrentModelConfig();
        const headers: Record<string, string> = {
          'content-type': 'application/json', 'x-model': model.modelString, 'x-api-key': model.apiKey,
        };
        if (model.baseUrl) headers['x-base-url'] = model.baseUrl;
        if (model.providerType) headers['x-provider-type'] = model.providerType;
        const response = await fetch(`/api/zhiban/student/courses/${courseId}/learning-center/coach`, {
          method: 'POST', headers,
          body: JSON.stringify({
            mode: aiMode, stationId: source?.stationId ?? target.stationId,
            currentInteraction: recommendation.briefRationale,
            studentAttempts: Number(recommendation.explanationContext.occurrenceCount ?? 1),
            conceptErrors: recommendation.triggerConceptErrors,
            incorrectConcepts: recommendation.triggerConceptErrors,
            question: `请用不超过120字解释为什么需要补练“${target.title}”，并给出一个引导问题。不得改变推荐路径。`,
            remediation: { recommendedTitle: target.title, reasonCode: recommendation.reasonCode },
          }),
        });
        if (!response.ok) throw new Error('coach unavailable');
        const body = await response.json();
        setExplanation(sanitizeRemediationExplanation(body, recommendation));
      } catch { setExplanation(fallback); }
    };
    void load();
  }, [aiMode, courseId, fallback, recommendation, source?.stationId, target.stationId, target.title]);

  const params = new URLSearchParams({
    remediationRunId: runId.current,
    sourceSceneId: recommendation.sourceSceneId ?? '',
    targetSceneId: recommendation.sceneId,
    retryTarget: recommendation.retryTarget,
    returnSceneId: recommendation.returnSceneId ?? '',
    contextMode: recommendation.contextMode,
    remediationStage: 'practice',
    triggerConceptErrors: recommendation.triggerConceptErrors.join(','),
  });
  const href = `/zhiban/student/courses/${courseId}/learning-center/${target.stationId}?${params.toString()}`;
  const start = () => {
    void postEvent(courseId, target.stationId, 'REMEDIATION_SCENE_ENTERED', runPayload(runId.current, recommendation), true)
      .then((response) => { if (!response.ok) setSyncWarning('学习记录暂未同步，不影响本次学习。'); })
      .catch(() => setSyncWarning('学习记录暂未同步，不影响本次学习。'));
  };
  return (
    <aside className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5" data-testid="smart-remediation-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold text-violet-950"><BrainCircuit className="size-5" />建议补练</div>
        <Badge variant="outline">{recommendation.priority === 'critical' ? '优先补强' : '智能支线'}</Badge>
      </div>
      <h3 className="mt-3 text-lg font-semibold">{target.title}</h3>
      <dl className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
        <div>
          <dt className="font-medium text-slate-900">为什么推荐</dt>
          <dd data-testid="remediation-reason">{explanation.remediationMessage}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-900">补练目标</dt>
          <dd data-testid="remediation-objective">
            {target.guidance?.objective ?? target.description}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-900">完成以后</dt>
          <dd data-testid="remediation-retry-target">
            完成补练后将返回{source ? `“${source.title}”` : '原任务'}再次验证；仅浏览补练页面不会提高能力分数。
          </dd>
        </div>
      </dl>
      <p className="mt-2 rounded-lg bg-white p-3 text-sm text-violet-900">思考：{explanation.guidingQuestion}</p>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />约 {recommendation.estimatedMinutes} 分钟</span>
        <span>关联能力：{recommendation.relatedAbility}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild onClick={start}><Link href={href}>开始补练</Link></Button>
        {onDismiss && <Button variant="ghost" onClick={onDismiss}>稍后再说</Button>}
      </div>
      {syncWarning && <p className="mt-3 text-xs text-amber-700">{syncWarning}</p>}
    </aside>
  );
}

export function RemediationRunBanner({ courseId }: { courseId: string }) {
  const [run, setRun] = useState<RemediationRunSummary | null>(null);
  const [syncWarning, setSyncWarning] = useState('');
  const retryStarted = useRef(false);
  const params = useMemo(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search), []);
  const runId = params?.get('remediationRunId');
  const stage = params?.get('remediationStage');
  const targetSceneId = params?.get('targetSceneId');
  const sourceSceneId = params?.get('sourceSceneId');
  const retryTarget = params?.get('retryTarget') ?? 'learning-path';
  const returnSceneId = params?.get('returnSceneId');
  const contextMode = params?.get('contextMode') ?? 'SELF_LEARNING';
  const triggers = useMemo(
    () => (params?.get('triggerConceptErrors') ?? '').split(',').filter(Boolean),
    [params],
  );
  useEffect(() => {
    if (!runId) return;
    const load = async () => {
      try {
        const response = await fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, { cache: 'no-store' });
        if (!response.ok) {
          setSyncWarning('学习记录暂未同步，不影响本次学习。');
          return;
        }
        const body = await response.json() as { remediationRuns?: RemediationRunSummary[] };
        setRun(body.remediationRuns?.find((item) => item.remediationRunId === runId) ?? null);
      } catch {
        setSyncWarning('学习记录暂未同步，不影响本次学习。');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [courseId, runId]);
  useEffect(() => {
    if (!runId || stage !== 'retry' || retryStarted.current || !sourceSceneId || !targetSceneId) return;
    retryStarted.current = true;
    const source = getScene(sourceSceneId);
    if (!source) return;
    void postEvent(courseId, source.stationId, 'REMEDIATION_RETRY_STARTED', {
      remediationRunId: runId, sourceSceneId, targetSceneId, retryTarget, returnSceneId,
      contextMode, triggerConceptErrors: triggers,
    }).catch(() => undefined);
  }, [contextMode, courseId, retryTarget, returnSceneId, runId, sourceSceneId, stage, targetSceneId, triggers]);
  if (!runId || !targetSceneId) return null;
  const target = getScene(targetSceneId);
  const source = returnSceneId ? getScene(returnSceneId) : null;
  const retryParams = new URLSearchParams({
    remediationRunId: runId, sourceSceneId: sourceSceneId ?? '', targetSceneId,
    retryTarget, returnSceneId: returnSceneId ?? '', contextMode,
    remediationStage: 'retry', triggerConceptErrors: triggers.join(','),
  });
  const retryHref = returnSceneId === 'S06-02'
    ? `/zhiban/student/courses/${courseId}/activities/mech-lab-line-stop?${retryParams.toString()}`
    : source
      ? `/zhiban/student/courses/${courseId}/learning-center/${source.stationId}?${retryParams.toString()}#${retryTarget}`
      : `/zhiban/student/courses/${courseId}/learning-center`;
  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm" data-testid="remediation-run-banner">
      <b>{stage === 'retry' ? '重新挑战原任务' : `智能补练：${target?.title ?? '推荐场景'}`}</b>
      <p className="mt-1 text-slate-600">补练结果来自真实交互；仅进入页面不会提升能力值。</p>
      {syncWarning && <p className="mt-2 text-xs text-amber-700">{syncWarning}</p>}
      {stage !== 'retry' && (
        <Button className="mt-3" size="sm" disabled={run?.status !== 'READY_TO_RETRY'} asChild={run?.status === 'READY_TO_RETRY'}>
          {run?.status === 'READY_TO_RETRY' ? <Link href={retryHref}><RefreshCw className="mr-2 size-3" />重新挑战</Link> : <span>完成本场景任务后解锁重新挑战</span>}
        </Button>
      )}
      {stage === 'retry' && run?.status === 'RESOLVED' && <p className="mt-2 font-medium text-emerald-700">本次再挑战已通过，已回归主学习路径。</p>}
    </div>
  );
}
