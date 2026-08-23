'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Bot, CheckCircle2, Clock3, Loader2, RefreshCw, RotateCcw, Send, Sparkles, Timer } from 'lucide-react';
import { InteractiveIframeHost } from '@/components/scene-renderers/InteractiveIframeHost';
import { InteractiveRenderer } from '@/components/scene-renderers/interactive-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildTrainingContext } from '@/lib/zhiban/virtual-lab/ai/context';
import { createFallbackCoachResponse } from '@/lib/zhiban/virtual-lab/ai/fallback';
import type { CoachResponse, TrainingAction, TrainingHintRecord } from '@/lib/zhiban/virtual-lab/ai/types';
import { calculateAssessment, createFallbackAssessmentFeedback } from '@/lib/zhiban/virtual-lab/assessment';
import type { AssessmentFeedback, AttemptSummary, VirtualLabAssessment } from '@/lib/zhiban/virtual-lab/assessment';
import type { PersistedVirtualLabAction, VirtualLabHistory } from '@/lib/zhiban/virtual-lab/persistence/types';
import { createMechLabInteractiveContent } from '@/lib/zhiban/virtual-lab/interactive-template';
import {
  createMechLabMessage,
  isMechLabMessageForContext,
  type MechLabActivityContext,
  type MechLabMessage,
  type MechLabSceneStatePayload,
} from '@/lib/zhiban/virtual-lab/types';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';

function sceneIdFor(context: MechLabActivityContext) {
  return `virtual-lab-${context.activityId}`;
}

function sendToScene(sceneId: string, message: MechLabMessage): boolean {
  const send = useWidgetIframeStore.getState().getSendMessage(sceneId);
  if (!send) return false;
  const { type, ...payload } = message;
  send(type, payload);
  return true;
}

export function VirtualLabRunner({ context }: { context: MechLabActivityContext }) {
  const sceneId = sceneIdFor(context);
  const content = useMemo(() => createMechLabInteractiveContent(context), [context]);
  const [started, setStarted] = useState(false);
  const [, setMessages] = useState<MechLabMessage[]>([]);
  const [lastState, setLastState] = useState('等待开始实训');
  const [coachLoading, setCoachLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [coachResponse, setCoachResponse] = useState<CoachResponse>();
  const [hintHistory, setHintHistory] = useState<TrainingHintRecord[]>([]);
  const [assessment, setAssessment] = useState<VirtualLabAssessment>();
  const [evaluating, setEvaluating] = useState(false);
  const [history, setHistory] = useState<VirtualLabHistory>();
  const [syncWarning, setSyncWarning] = useState('');
  const snapshotRef = useRef<Partial<MechLabSceneStatePayload>>({});
  const actionsRef = useRef<TrainingAction[]>([]);
  const hintsRef = useRef<TrainingHintRecord[]>([]);
  const attemptsRef = useRef<VirtualLabAssessment[]>([]);
  const attemptStartedAtRef = useRef<number | null>(null);
  const completingRef = useRef(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const sessionAttemptRef = useRef<number | undefined>(undefined);
  const pendingActionsRef = useRef<PersistedVirtualLabAction[]>([]);
  const learningProfileRef = useRef<VirtualLabHistory['profile']>(null);

  const persistAction = useCallback((action: PersistedVirtualLabAction) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) { pendingActionsRef.current = [...pendingActionsRef.current, action]; return; }
    void fetch(`/api/zhiban/virtual-lab/sessions/${sessionId}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action),
    }).then((response) => { if (!response.ok) throw new Error('Action persistence failed'); }).catch(() => setSyncWarning('学习操作暂未同步，不影响继续实训。'));
  }, []);

  const addAction = useCallback((action: TrainingAction) => {
    actionsRef.current = [...actionsRef.current, action];
    persistAction(action);
  }, [persistAction]);

  const refreshHistory = useCallback(async () => {
    try {
      const params = new URLSearchParams({ courseId: context.courseId, chapterId: context.chapterId, activityId: context.activityId, scenarioId: context.scenarioId });
      const response = await fetch(`/api/zhiban/virtual-lab/sessions?${params.toString()}`);
      if (!response.ok) return;
      const body = await response.json() as VirtualLabHistory;
      setHistory(body);
      learningProfileRef.current = body.profile;
    } catch { /* History is supplemental; simulation remains available. */ }
  }, [context]);

  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  const requestCoach = useCallback(async (studentMessage?: string) => {
    if (coachLoading) return;
    setCoachLoading(true);
    addAction({
      timestamp: new Date().toISOString(),
      action: 'REQUEST_HINT',
      phase: snapshotRef.current.phase ?? 'intro',
      ...(studentMessage ? { value: studentMessage } : {}),
    });
    const trainingContext = buildTrainingContext({
      activity: context,
      snapshot: snapshotRef.current,
      actions: actionsRef.current,
      hintHistory: hintsRef.current,
      learningProfile: learningProfileRef.current ?? undefined,
    });

    let response: CoachResponse;
    try {
      const result = await fetch('/api/zhiban/virtual-lab/coach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: trainingContext, studentMessage }),
      });
      if (!result.ok) throw new Error(`Coach API ${result.status}`);
      response = (await result.json()) as CoachResponse;
      if (!response.message) throw new Error('Coach returned empty message');
    } catch {
      response = createFallbackCoachResponse(trainingContext);
    }

    const record: TrainingHintRecord = {
      timestamp: new Date().toISOString(),
      hintLevel: response.hintLevel,
      trainingPhase: trainingContext.state.currentPhase,
      diagnosisState: response.diagnosisState,
      message: response.message,
      actionsCountAtHint: trainingContext.behavior.actionsCount,
      wrongActionsAtHint: trainingContext.behavior.wrongActions.length,
      fallback: response.fallback,
    };
    hintsRef.current = [...hintsRef.current, record];
    persistAction({ action: 'RECEIVE_HINT', phase: trainingContext.state.currentPhase, value: response.hintLevel, timestamp: record.timestamp, payload: { diagnosisState: response.diagnosisState, fallback: response.fallback } });
    setHintHistory(hintsRef.current);
    setCoachResponse(response);
    const hintMessage = createMechLabMessage(context, 'MECH_AI_HINT', {
      level: response.hintLevel,
      message: response.message,
      diagnosisState: response.diagnosisState,
      currentPhase: trainingContext.state.currentPhase,
      fallback: response.fallback,
      timestamp: record.timestamp,
    });
    sendToScene(sceneId, hintMessage);
    setMessages((current) => [hintMessage, ...current].slice(0, 6));
    setCoachLoading(false);
  }, [addAction, coachLoading, context, persistAction, sceneId]);

  const completeAttempt = useCallback(async () => {
    if (completingRef.current) return;
    completingRef.current = true;
    addAction({ timestamp: new Date().toISOString(), action: 'COMPLETE', phase: snapshotRef.current.phase ?? 'completed' });
    const trainingContext = buildTrainingContext({
      activity: context,
      snapshot: snapshotRef.current,
      actions: actionsRef.current,
      hintHistory: hintsRef.current,
      learningProfile: learningProfileRef.current ?? undefined,
    });
    const previous = attemptsRef.current.at(-1) ?? history?.sessions.find((item) => item.status === 'completed')?.assessment;
    const previousAttemptSummary: AttemptSummary | undefined = previous ? {
      attemptNumber: previous.attemptNumber,
      overallScore: previous.overallScore,
      durationSeconds: previous.durationSeconds,
      wrongActions: previous.wrongActions.length,
      hintsUsed: previous.hintsUsed,
    } : undefined;
    const durationSeconds = attemptStartedAtRef.current
      ? Math.max(1, Math.round((Date.now() - attemptStartedAtRef.current) / 1000))
      : undefined;
    const calculated = calculateAssessment({
      trainingContext,
      attemptNumber: sessionAttemptRef.current ?? (history?.summary.attempts ?? attemptsRef.current.length) + 1,
      durationSeconds,
      ...(previousAttemptSummary ? { previousAttemptSummary } : {}),
    });
    const fallback = createFallbackAssessmentFeedback(calculated);
    const initial = { ...calculated, aiFeedback: fallback };
    attemptsRef.current = [...attemptsRef.current, initial];
    setAssessment(initial);
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      void fetch(`/api/zhiban/virtual-lab/sessions/${sessionId}/complete`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trainingContext, durationSeconds: initial.durationSeconds }),
      }).then(async (response) => {
        if (!response.ok) throw new Error('Completion persistence failed');
        const saved = await response.json() as { assessment?: VirtualLabAssessment };
        if (saved.assessment) {
          const persisted = { ...saved.assessment, aiFeedback: initial.aiFeedback };
          attemptsRef.current = [...attemptsRef.current.slice(0, -1), persisted];
          setAssessment(persisted);
        }
        await refreshHistory();
      }).catch(() => setSyncWarning('学习结果暂未同步，但本次评价已保留在当前页面。'));
    } else setSyncWarning('学习记录暂未创建，当前评价不受影响；请稍后重新进入实训同步。');
    setEvaluating(true);
    try {
      const result = await fetch('/api/zhiban/virtual-lab/evaluate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assessment: calculated, trainingContext }),
      });
      if (!result.ok) throw new Error(`Evaluator API ${result.status}`);
      const feedback = (await result.json()) as AssessmentFeedback;
      if (!feedback.summary) throw new Error('Evaluator returned empty feedback');
      const completed = { ...calculated, aiFeedback: feedback };
      attemptsRef.current = [...attemptsRef.current.slice(0, -1), completed];
      setAssessment(completed);
    } catch {
      // The deterministic feedback set above is the deliberately stable fallback.
    } finally { setEvaluating(false); }
  }, [addAction, context, history, refreshHistory]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!isMechLabMessageForContext(event.data, context)) return;
      const message = event.data;
      const payload = message.payload as Record<string, unknown>;
      setMessages((current) => [message, ...current].slice(0, 6));
      if (message.type === 'MECH_READY') setLastState('Interactive HTML 与 3D 场景已就绪');
      if (message.type === 'MECH_ACTION') {
        const action = typeof payload.action === 'string' ? payload.action : '场景操作';
        addAction({
          timestamp: message.timestamp,
          action,
          ...(typeof payload.target === 'string' ? { target: payload.target } : {}),
          ...(typeof payload.value === 'string' || typeof payload.value === 'number' ? { value: payload.value } : {}),
          ...(typeof payload.unit === 'string' ? { unit: payload.unit } : {}),
          ...(typeof payload.phase === 'string' ? { phase: payload.phase } : {}),
        });
        setLastState(`已收到场景操作：${action}`);
      }
      if (message.type === 'MECH_STATE_CHANGED') {
        snapshotRef.current = message.payload as MechLabSceneStatePayload;
        const phase = typeof payload.phase === 'string' ? payload.phase : '已更新';
        setLastState(`场景状态：${phase}`);
      }
      if (message.type === 'MECH_REQUEST_HINT') void requestCoach();
      if (message.type === 'MECH_COMPLETE') void completeAttempt();
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [addAction, completeAttempt, context, requestCoach]);

  const reset = () => {
    const message = createMechLabMessage(context, 'MECH_RESET', {});
    if (!sendToScene(sceneId, message)) { setLastState('场景尚未就绪，请稍候重试。'); return; }
    snapshotRef.current = {};
    actionsRef.current = [];
    persistAction({ action: 'RESET', phase: 'intro', timestamp: new Date().toISOString() });
    hintsRef.current = [];
    setHintHistory([]);
    setCoachResponse(undefined);
    setMessages((current) => [message, ...current].slice(0, 6));
    setLastState('已向 Virtual Lab 发送重置命令');
  };

  const askQuestion = () => {
    const value = question.trim();
    if (!value) return;
    setQuestion('');
    void requestCoach(value);
  };

  const beginAttempt = () => {
    completingRef.current = false;
    sessionIdRef.current = undefined;
    sessionAttemptRef.current = undefined;
    pendingActionsRef.current = [];
    attemptStartedAtRef.current = Date.now();
    setStarted(true);
    setSyncWarning('');
    void fetch('/api/zhiban/virtual-lab/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ courseId: context.courseId, chapterId: context.chapterId, activityId: context.activityId, scenarioId: context.scenarioId }),
    }).then(async (response) => {
      if (!response.ok) throw new Error('Session creation failed');
      const body = await response.json() as { session: { id: string; attemptNumber: number } };
      sessionIdRef.current = body.session.id;
      sessionAttemptRef.current = body.session.attemptNumber;
      const pending = pendingActionsRef.current;
      pendingActionsRef.current = [];
      pending.forEach(persistAction);
      setLastState(`第 ${body.session.attemptNumber} 次实训已开始`);
    }).catch(() => setSyncWarning('学习记录暂未同步，不影响本次实训与评价。'));
  };

  const retry = () => {
    snapshotRef.current = {};
    actionsRef.current = [];
    hintsRef.current = [];
    setHintHistory([]);
    setCoachResponse(undefined);
    setAssessment(undefined);
    setStarted(false);
    beginAttempt();
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-10">
      <InteractiveIframeHost />
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-xl border bg-white p-5 shadow-sm">
          <Link href={`/zhiban/student/courses/${context.courseId}`} className="text-sm text-blue-600 hover:underline">← 返回课程首页</Link>
          <div className="mt-4 flex flex-wrap items-center gap-3"><Badge className="bg-blue-600">Virtual Lab</Badge><Badge variant="outline">{context.difficulty}</Badge></div>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">{context.title}</h1>
          <p className="mt-2 text-slate-600">{context.description}</p>
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-600"><Timer className="size-4" />预计时长 {context.estimatedMinutes} 分钟</div>
          <p className="mt-3 text-xs text-slate-500 md:hidden">建议使用 PC 端获得完整的三维虚拟实训体验。</p>
        </header>

        {assessment ? <VirtualLabAssessmentResult assessment={assessment} evaluating={evaluating} onRetry={retry} courseId={context.courseId} actions={actionsRef.current} /> : <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-4">
            <div className="rounded-xl border bg-white p-5">
              <h2 className="font-semibold">学习目标</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">{context.learningObjectives.map((objective) => <li key={objective}>{objective}</li>)}</ol>
              {!started && <div className="mt-4 grid gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700 md:grid-cols-3"><div><b className="block text-blue-900">操作方式</b><span>拖动旋转视角，滚轮缩放；点击设备查看工具。</span></div><div><b className="block text-blue-900">实训流程</b><span>观察现场 → PLC I/O → 万用表测量 → 判断 → 验证。</span></div><div><b className="block text-blue-900">AI 教练</b><span>AI不会直接给出故障答案，请根据现场状态和检测证据完成诊断。</span></div></div>}
               {!started && <Button className="mt-5" data-testid="virtual-lab-start" onClick={beginAttempt}>开始实训</Button>}
            </div>
            {started ? <section data-testid="virtual-lab-interactive-slot" className="relative h-[min(78vh,820px)] min-h-[560px] overflow-hidden rounded-xl border bg-slate-950 shadow-sm"><InteractiveRenderer content={content} sceneId={sceneId} /></section> : <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-slate-500">点击“开始实训”后加载 Interactive HTML 场景。</div>}
          </section>
          <aside className="space-y-4">
            <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">当前任务</h2><p className="mt-3 text-sm leading-6 text-slate-600">依据现场、PLC I/O 与测量证据完成“观察—测量—判断—验证”。</p><p className="mt-3 text-sm font-medium text-blue-700">状态：{lastState}</p>{started && <Button className="mt-4 w-full" variant="outline" data-testid="virtual-lab-reset" onClick={reset}><RotateCcw className="mr-2 size-4" />重置场景</Button>}</section>
            <section className="rounded-xl border bg-white p-5" data-testid="virtual-lab-ai-coach">
              <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-semibold"><Bot className="size-4 text-blue-600" />AI 实训教练</div>{coachResponse && <Badge variant="outline">{coachResponse.hintLevel} 级提示</Badge>}</div>
              {coachResponse ? <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm leading-6 text-slate-700"><p>{coachResponse.message}</p>{coachResponse.notice && <p className="mt-2 text-xs text-amber-700">{coachResponse.notice}</p>}</div> : <p className="mt-2 text-sm text-slate-500">教练会读取当前设备、PLC、测量与操作记录，只提供当前必要的诊断支架。</p>}
              <Button className="mt-3 w-full" variant="outline" disabled={!started || coachLoading} onClick={() => void requestCoach()}>{coachLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Bot className="mr-2 size-4" />}我要提示</Button>
              <div className="mt-3 flex gap-2"><Input aria-label="向AI教练提问" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') askQuestion(); }} placeholder="如：24V正常说明什么？" disabled={!started || coachLoading} /><Button size="icon" aria-label="发送问题" onClick={askQuestion} disabled={!started || coachLoading || !question.trim()}><Send className="size-4" /></Button></div>
              {hintHistory.length > 0 && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">提示记录（{hintHistory.length}）</summary><ol className="mt-2 space-y-2 pl-4">{hintHistory.map((hint) => <li key={hint.timestamp}>{hint.hintLevel}级 · {hint.diagnosisState} · {hint.message}</li>)}</ol></details>}
            </section>
            <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">当前活动上下文</h2><dl className="mt-3 space-y-2 text-sm text-slate-600"><div><dt className="font-medium text-slate-800">课程</dt><dd>{context.courseTitle ?? context.courseId}</dd></div><div><dt className="font-medium text-slate-800">章节</dt><dd>{context.chapterTitle ?? context.chapterId}</dd></div><div><dt className="font-medium text-slate-800">场景</dt><dd>{context.scenarioTitle ?? context.scenarioId}</dd></div></dl></section>
          </aside>
        </div>}
        {syncWarning && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{syncWarning}</p>}
        {history && <VirtualLabHistoryCard history={history} />}
      </div>
    </main>
  );
}

const DIMENSION_LABELS = {
  diagnosisAccuracy: '故障定位',
  procedureQuality: '流程规范',
  evidenceReasoning: '证据推理',
  independence: '独立完成',
  verification: '结果验证',
} as const;

function friendlyAction(action: TrainingAction) {
  const labels: Record<string, string> = {
    OPEN_PLC_MONITOR: '打开 PLC I/O 监控',
    INSPECT_COMPONENT: '检查 S2 光电传感器',
    MEASURE_SENSOR_POWER: `测量 S2 供电：${action.value ?? 24}V`,
    MEASURE_SENSOR_OUTPUT: `测量 S2 输出：${action.value ?? 0}V`,
    SUBMIT_DIAGNOSIS: `提交故障判断：${action.value === 'S2_OUTPUT_ABNORMAL' ? 'S2输出异常' : action.value ?? '—'}`,
    REPLACE_COMPONENT: '更换/修复 S2 传感器',
    RESTART_MACHINE: '重新启动并验证',
    WRONG_ACTION: `无效操作：${action.value ?? '—'}`,
  };
  return labels[action.action] ?? '';
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
}

function VirtualLabAssessmentResult({
  assessment,
  evaluating,
  onRetry,
  courseId,
  actions,
}: {
  assessment: VirtualLabAssessment;
  evaluating: boolean;
  onRetry: () => void;
  courseId: string;
  actions: TrainingAction[];
}) {
  const feedback = assessment.aiFeedback!;
  const timeline = actions.map((action) => ({ action, label: friendlyAction(action) })).filter((item) => item.label);
  const previous = assessment.previousAttemptSummary;
  return (
    <section className="mx-auto max-w-6xl space-y-5" data-testid="virtual-lab-assessment-result">
      <header className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="size-6" /><span className="font-semibold">实训完成</span></div><p className="mt-2 text-sm text-slate-600">第 {assessment.attemptNumber} 次实训 · 已生成确定性过程评分与学习建议</p></div>
          <div className="rounded-xl bg-blue-600 px-6 py-4 text-center text-white"><div className="text-xs text-blue-100">综合得分</div><div className="text-4xl font-bold">{assessment.overallScore}</div><div className="text-xs text-blue-100">/ 100</div></div>
        </div>
        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3"><Clock3 className="mr-1 inline size-4 text-blue-600" />完成时间：{formatDuration(assessment.durationSeconds)}</div><div className="rounded-lg bg-slate-50 p-3">操作次数：{assessment.actionsCount}</div><div className="rounded-lg bg-slate-50 p-3">AI提示：{assessment.hintsUsed}</div></div>
      </header>

      {previous && <section className="rounded-xl border border-blue-200 bg-blue-50 p-5"><div className="flex items-center gap-2 font-semibold text-blue-900"><BarChart3 className="size-5" />再练比较：第 {previous.attemptNumber} 次 vs 本次</div><div className="mt-3 grid gap-3 text-sm sm:grid-cols-4"><MetricDiff label="综合得分" before={previous.overallScore} after={assessment.overallScore} suffix="分" /><MetricDiff label="完成时间" before={previous.durationSeconds} after={assessment.durationSeconds} suffix="秒" inverse /><MetricDiff label="错误操作" before={previous.wrongActions} after={assessment.wrongActions.length} suffix="次" inverse /><MetricDiff label="提示次数" before={previous.hintsUsed} after={assessment.hintsUsed} suffix="次" inverse /></div></section>}

      <section className="rounded-xl border bg-white p-6"><h2 className="font-semibold">五维能力表现</h2><div className="mt-5 space-y-4">{Object.entries(assessment.dimensions).map(([key, item]) => <div key={key}><div className="flex justify-between gap-3 text-sm"><span>{DIMENSION_LABELS[key as keyof typeof DIMENSION_LABELS]}</span><b>{item.score} / {item.maxScore}</b></div><div className="mt-2 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-blue-600" style={{ width: `${item.score / item.maxScore * 100}%` }} /></div><p className="mt-1 text-xs text-slate-500">{item.reason}</p></div>)}</div></section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-6"><h2 className="font-semibold">诊断过程时间线</h2>{timeline.length ? <ol className="mt-4 space-y-3 border-l pl-5 text-sm">{timeline.map(({ action, label }, index) => <li key={`${action.timestamp}-${index}`}><span className="mr-2 font-mono text-xs text-slate-400">{new Date(action.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>{label}</li>)}</ol> : <p className="mt-3 text-sm text-slate-500">未获取到可展示的关键操作。</p>}</section>
        <section className="rounded-xl border bg-white p-6"><div className="flex items-center gap-2 font-semibold"><Sparkles className="size-5 text-blue-600" />AI过程评价</div>{evaluating ? <p className="mt-3 text-sm text-slate-500">正在生成过程评价…</p> : <><p className="mt-3 text-sm leading-6 text-slate-700">{feedback.summary}</p><ResultList title="优势表现" items={feedback.strengths} /><ResultList title="需要改进" items={feedback.improvements} /><p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">下一步：{feedback.nextStep}</p>{feedback.notice && <p className="mt-2 text-xs text-amber-700">{feedback.notice}</p>}</>}</section>
      </div>

      <section className="rounded-xl border bg-white p-6"><h2 className="font-semibold">建议补强</h2>{assessment.recommendedContent.length ? <div className="mt-4 grid gap-4 md:grid-cols-2">{assessment.recommendedContent.map((item) => <article key={item.knowledgePoint} className="rounded-lg border bg-slate-50 p-4"><div className="flex items-center justify-between gap-2"><b className="text-sm">{item.title}</b><Badge variant="outline">{item.priority === 'high' ? '优先补强' : '建议复习'}</Badge></div><p className="mt-2 text-sm text-slate-700">薄弱点：{item.knowledgePoint}</p><p className="mt-1 text-xs text-slate-500">关联章节：{item.chapter}</p><p className="mt-2 text-xs text-slate-600">{item.reason}</p><Link href={`/zhiban/student/courses/${courseId}`} className="mt-3 inline-flex text-sm text-blue-600 hover:underline">复习相关内容</Link></article>)}</div> : <p className="mt-3 text-sm text-slate-600">本次已形成较完整的诊断证据链；可再次实训，进一步提升效率。</p>}</section>
      <div className="flex justify-center"><Button size="lg" onClick={onRetry}><RefreshCw className="mr-2 size-4" />再次实训</Button></div>
    </section>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return <div className="mt-4"><h3 className="text-sm font-medium">{title}</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function MetricDiff({ label, before, after, suffix, inverse = false }: { label: string; before: number; after: number; suffix: string; inverse?: boolean }) {
  const delta = after - before;
  const improved = inverse ? delta < 0 : delta > 0;
  return <div className="rounded bg-white p-3"><p className="text-slate-500">{label}</p><b>{before}{suffix} → {after}{suffix}</b><p className={improved ? 'text-emerald-600' : delta === 0 ? 'text-slate-500' : 'text-amber-700'}>{delta === 0 ? '保持不变' : `${delta > 0 ? '+' : ''}${delta}${suffix}`}</p></div>;
}

function VirtualLabHistoryCard({ history }: { history: VirtualLabHistory }) {
  const completed = history.sessions.filter((item) => item.status === 'completed');
  return <section className="rounded-xl border bg-white p-5" data-testid="virtual-lab-history">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">历史表现</h2><span className="text-sm text-slate-500">数据来源：{history.profileSource ?? '尚无已完成实训'}</span></div>
    {!history.sessions.length ? <p className="mt-3 text-sm text-slate-500">尚无历史实训记录</p> : <>
      {history.profile && <p className="mt-3 text-xs text-slate-500">能力画像（来源：{history.profileSource}）：传感检测 {history.profile.sensorKnowledgeMastery ?? '未知'} · PLC 状态判断 {history.profile.plcKnowledgeMastery ?? '未知'}。</p>}
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-5"><HistoryMetric label="尝试次数" value={history.summary.attempts} /><HistoryMetric label="最高得分" value={history.summary.highestScore === null ? '—' : `${history.summary.highestScore} 分`} /><HistoryMetric label="最近得分" value={history.summary.latestScore === null ? '—' : `${history.summary.latestScore} 分`} /><HistoryMetric label="最佳用时" value={history.summary.bestDurationSeconds === null ? '—' : formatDuration(history.summary.bestDurationSeconds)} /><HistoryMetric label="最近提示" value={history.summary.latestHintsUsed === null ? '—' : `${history.summary.latestHintsUsed} 次`} /></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="py-2">尝试</th><th>完成时间</th><th>得分</th><th>用时</th><th>错误操作</th><th>提示</th><th>摘要</th></tr></thead><tbody>{completed.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-2">第 {item.attemptNumber} 次</td><td>{item.completedAt ? new Date(item.completedAt).toLocaleString('zh-CN') : '—'}</td><td>{item.overallScore ?? '—'}</td><td>{item.durationSeconds === null ? '—' : formatDuration(item.durationSeconds)}</td><td>{item.wrongActions.length}</td><td>{item.hintsUsed}</td><td>{item.assessment ? <details><summary className="cursor-pointer text-blue-600">查看</summary><p className="mt-2 w-64 text-xs text-slate-600">主要薄弱点：{item.assessment.weakPoints.map((point) => point.knowledgePoint).join('；') || '无'}</p></details> : '—'}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}

function HistoryMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><b className="mt-1 block">{value}</b></div>;
}
