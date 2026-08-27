'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, CheckCircle2, Send, Sparkles } from 'lucide-react';
import { InteractiveIframeHost } from '@/components/scene-renderers/InteractiveIframeHost';
import { InteractiveRenderer } from '@/components/scene-renderers/interactive-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import {
  createActuationInteractiveContent,
  createControlInteractiveContent,
} from '@/lib/zhiban/learning-center/control-actuation-interactive-template';
import {
  evaluateExecutionCheckpoint,
  evaluateM06,
  evaluateM07,
} from '@/lib/zhiban/learning-center/control-actuation';
import { getStation } from '@/lib/zhiban/learning-center/registry';
import { attachClassroomSceneContext } from '@/lib/zhiban/classroom/client-scene-context';
import {
  emptyLearningCenterProgress,
  type ConceptErrorCode,
  type LearningCenterProgress,
  type LearningEventInput,
  type StationId,
} from '@/lib/zhiban/learning-center';
import { getMechLabActivity } from '@/lib/zhiban/virtual-lab/registry';
import { isMechLabMessageForContext, type MechLabMessage } from '@/lib/zhiban/virtual-lab/types';
import { SmartRemediationCard } from '@/components/zhiban/smart-remediation-card';
import {
  resolveRemediationScene,
  type RemediationRecommendation,
} from '@/lib/zhiban/scene-orchestration';

type Props = { courseId: string };
type StationSpec = { stationId: StationId; points: string[]; exercises: string[] };
const m06Targets: Array<{ id: string; label: string; options: string[] }> = [
  { id: 's2', label: 'S2 光电传感器', options: ['I0.2', 'Q0.1'] },
  { id: 'pusher', label: '推料控制', options: ['Q0.1', 'I0.2'] },
  { id: 'start', label: '启动按钮', options: ['I0.0', 'Q0.0'] },
];

function elapsedSince(startedAt: number) {
  return Date.now() - startedAt;
}

function useKnowledgeStation(courseId: string, spec: StationSpec) {
  const [progress, setProgress] = useState<LearningCenterProgress>(() =>
    emptyLearningCenterProgress(courseId),
  );
  const [syncWarning, setSyncWarning] = useState('');
  const completed = useRef(new Set<string>());
  const completeReported = useRef(false);

  const applyLocalEvent = useCallback((event: LearningEventInput) => {
    setProgress((current) => {
      const next = JSON.parse(JSON.stringify(current)) as LearningCenterProgress;
      next.eventCount += 1;
      const point = event.knowledgePointId
        ? next.knowledgePoints[event.knowledgePointId]
        : undefined;
      if (!point) return next;
      point.attempts = Math.max(point.attempts, event.attempt ?? 1);
      point.lastEventAt = event.timestamp ?? new Date().toISOString();
      if (typeof event.isCorrect === 'boolean') point.correct = event.isCorrect;
      if (event.eventType === 'COMPLETE_KNOWLEDGE_POINT') point.completed = true;
      const station = getStation(event.stationId);
      const stationProgress = next.stations[event.stationId];
      const points = (station?.knowledgePointIds ?? [])
        .map((id) => next.knowledgePoints[id])
        .filter(Boolean);
      stationProgress.completedKnowledgePoints = points.filter((item) => item.completed).length;
      stationProgress.progressPercent = points.length
        ? Math.round((stationProgress.completedKnowledgePoints / points.length) * 100)
        : 0;
      stationProgress.status =
        stationProgress.progressPercent === 100 ? 'completed' : 'in_progress';
      stationProgress.lastEventAt = point.lastEventAt;
      return next;
    });
  }, []);
  const record = useCallback(
    async (input: LearningEventInput) => {
      const event = attachClassroomSceneContext({ ...input, timestamp: input.timestamp ?? new Date().toISOString() });
      // Update the visible progress optimistically so a completed knowledge
      // point is reflected immediately; persistence is deliberately
      // best-effort and must not make the progress bar wait on the network.
      applyLocalEvent(event);
      try {
        const response = await fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
        });
        if (!response.ok) throw new Error('persist');
      } catch {
        setSyncWarning('学习记录暂未同步，不影响本次学习。');
      }
    },
    [applyLocalEvent, courseId],
  );
  const complete = useCallback(
    (point: string, payload: Record<string, unknown> = {}) => {
      if (completed.current.has(point)) return;
      completed.current.add(point);
      void record({
        stationId: spec.stationId,
        knowledgePointId: point,
        eventType: 'COMPLETE_KNOWLEDGE_POINT',
        payload,
      });
    },
    [record, spec.stationId],
  );

  useEffect(() => {
    void fetch(`/api/zhiban/student/courses/${courseId}/learning-center`)
      .then(async (response) => {
        if (!response.ok) throw new Error('progress');
        const body = (await response.json()) as { progress?: LearningCenterProgress };
        if (!body.progress) return;
        setProgress(body.progress);
        spec.points.forEach((point) => {
          if (body.progress?.knowledgePoints[point]?.completed) completed.current.add(point);
        });
      })
      .catch(() => setSyncWarning('学习记录暂未同步，不影响本次学习。'));
  }, [courseId, spec.points]);
  useEffect(() => {
    if (progress.stations[spec.stationId]?.status !== 'completed' || completeReported.current)
      return;
    completeReported.current = true;
    void record({
      stationId: spec.stationId,
      eventType: 'COMPLETE_STATION',
      payload: { knowledgePoints: spec.points, exercises: spec.exercises },
    });
  }, [progress.stations, record, spec]);
  return { progress, record, complete, syncWarning };
}

function KnowledgeCompanion({
  courseId,
  stationId,
  point,
  interaction,
  conceptErrors,
  attempts,
}: {
  courseId: string;
  stationId: StationId;
  point: string;
  interaction: string;
  conceptErrors: ConceptErrorCode[];
  attempts: number;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setAnswer('');
    try {
      const model = getCurrentModelConfig();
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-model': model.modelString,
        'x-api-key': model.apiKey,
      };
      if (model.baseUrl) headers['x-base-url'] = model.baseUrl;
      if (model.providerType) headers['x-provider-type'] = model.providerType;
      const response = await fetch(
        `/api/zhiban/student/courses/${courseId}/learning-center/coach`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            question,
            stationId,
            knowledgePointId: point,
            currentInteraction: interaction,
            studentAttempts: attempts,
            incorrectConcepts: conceptErrors,
            conceptErrors,
            microExercise: stationId === 'station-03-control' ? 'M06/M07' : 'K14 checkpoint',
          }),
        },
      );
      const body = (await response.json()) as { message?: string; notice?: string };
      setAnswer(
        `${body.message ?? '请先观察当前信号链。'}${body.notice ? `\n${body.notice}` : ''}`,
      );
    } catch {
      setAnswer('AI学习伙伴暂时繁忙，请沿当前信号链逐个观察输入、输出和现场动作。');
    } finally {
      setBusy(false);
      setQuestion('');
    }
  };
  return (
    <section className="rounded-xl border bg-white p-5">
      <div className="flex items-center gap-2 font-semibold">
        <Bot className="size-4 text-blue-600" />
        AI学习伙伴
      </div>
      <p className="mt-2 text-sm text-slate-600">
        我会用追问帮助你区分信号方向与现场动作，不会直接替你选答案。
      </p>
      {answer && (
        <p className="mt-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-3 text-sm leading-6 text-blue-950">
          {answer}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void ask();
          }}
          placeholder="如：Q0.1 ON说明什么？"
          disabled={busy}
        />
        <Button
          size="icon"
          aria-label="提问AI学习伙伴"
          disabled={busy || !question.trim()}
          onClick={() => void ask()}
        >
          {busy ? <Sparkles className="size-4 animate-pulse" /> : <Send className="size-4" />}
        </Button>
      </div>
    </section>
  );
}

export function ControlLearningStation({ courseId }: Props) {
  const spec = useMemo(
    () => ({
      stationId: 'station-03-control' as const,
      points: ['K09', 'K10', 'K11', 'K12'],
      exercises: ['M06', 'M07'],
    }),
    [],
  );
  const context = getMechLabActivity(courseId, 'mech-lab-line-stop');
  const content = useMemo(
    () => (context ? createControlInteractiveContent(context) : null),
    [context],
  );
  const { progress, record, complete, syncWarning } = useKnowledgeStation(courseId, spec);
  const [i02, setI02] = useState(true);
  const [_mappings, setMappings] = useState<string[]>([]);
  const [scanSteps, setScanSteps] = useState<string[]>([]);
  const [m06, setM06] = useState<Record<string, string>>({});
  const [m06Message, setM06Message] = useState('');
  const [m07Message, setM07Message] = useState('');
  const [m07Submitted, setM07Submitted] = useState(false);
  const [errors, setErrors] = useState<ConceptErrorCode[]>([]);
  const [remediation, setRemediation] = useState<RemediationRecommendation | null>(null);
  const started = useRef(0);
  useEffect(() => {
    started.current = Date.now();
  }, []);
  useEffect(() => {
    if (!context) return;
    const receive = (event: MessageEvent) => {
      if (!isMechLabMessageForContext(event.data, context)) return;
      const message = event.data as MechLabMessage;
      if (message.type === 'MECH_READY') {
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K09',
          eventType: 'VIEW_KNOWLEDGE_POINT',
          payload: { panel: 'PLC I/O' },
        });
        complete('K09');
        return;
      }
      if (message.type !== 'MECH_ACTION') return;
      const p = message.payload as Record<string, unknown>;
      if (p.detail === 'LADDER_TOGGLE') setI02(p.i02 === true);
      if (p.detail === 'MAP_IO') {
        const key = `${p.from}->${p.to}`;
        setMappings((current) => (current.includes(key) ? current : [...current, key]));
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K10',
          eventType: 'MAP_IO',
          payload: { from: p.from, to: p.to },
        });
      }
      if (p.detail === 'PLC_SCAN_STEP') {
        const step = String(p.step);
        const correct = p.isCorrect === true;
        if (!correct)
          setErrors((current) =>
            current.includes('PLC_SCAN_SEQUENCE_ERROR')
              ? current
              : [...current, 'PLC_SCAN_SEQUENCE_ERROR'],
          );
        else setScanSteps((current) => (current.includes(step) ? current : [...current, step]));
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K11',
          eventType: 'PLC_SCAN_STEP',
          isCorrect: correct,
          payload: { step, i02: p.i02, q01: p.q01 },
        });
        if (correct && step === 'output') {
          complete('K11');
          if (m07Submitted) complete('K12', { exercise: 'M07', verifiedBy: 'plc-scan' });
        }
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [complete, context, m07Submitted, record, spec.stationId]);
  const submitM06 = () => {
    const pairs = [
      ['s2', m06.s2],
      ['pusher', m06.pusher],
      ['start', m06.start],
    ] as const;
    const result = pairs.map(([field, io]) => evaluateM06(field, io ?? ''));
    const correct = result.every((item) => item.isCorrect);
    const newErrors = result.flatMap((item) => item.conceptErrors);
    setErrors((current) => [...new Set([...current, ...newErrors])]);
    result.forEach(
      (item, index) =>
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K10',
          eventType: 'SUBMIT_MICRO_EXERCISE',
          isCorrect: item.isCorrect,
          attempt: progress.knowledgePoints.K10.attempts + 1,
          payload: {
            exercise: 'M06',
            fieldDevice: pairs[index][0],
            selectedIo: pairs[index][1],
            correctIo: item.correctIo,
            correctionCount: result.filter((x) => !x.isCorrect).length,
            durationMs: elapsedSince(started.current),
            conceptErrors: item.conceptErrors,
          },
        }),
    );
    complete('K10', { exercise: 'M06' });
    setM06Message(
      correct
        ? '映射正确：I 是现场信号进入 PLC，Q 是 PLC 发往执行侧的控制信号。'
        : '请再比较：这个设备是向 PLC 提供信息，还是接收 PLC 的控制信号？',
    );
    setRemediation(
      correct || !newErrors.length
        ? null
        : resolveRemediationScene({
            conceptErrors: newErrors,
            currentSceneId: 'S03-02',
            stationId: spec.stationId,
            currentCheckpoint: 'M06',
            attemptHistory: newErrors.map((code) => ({
              code,
              count: progress.knowledgePoints.K10.attempts + 1,
            })),
            contextMode: 'SELF_LEARNING',
          }),
    );
  };
  const submitM07 = (prediction: boolean) => {
    const result = evaluateM07(i02, prediction);
    setErrors((current) => [...new Set([...current, ...result.conceptErrors])]);
    void record({
      stationId: spec.stationId,
      knowledgePointId: 'K12',
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: result.isCorrect,
      attempt: progress.knowledgePoints.K12.attempts + 1,
      payload: {
        exercise: 'M07',
        inputState: result.inputState,
        predictedOutput: result.predictedOutput,
        actualOutput: result.actualOutput,
        durationMs: elapsedSince(started.current),
        conceptErrors: result.conceptErrors,
      },
    });
    setM07Submitted(true);
    setM07Message(
      result.isCorrect
        ? `预测已记录。请在上方依次点击 INPUT → LOGIC → OUTPUT，验证 Q0.1 是否如你预期变化。`
        : '请先判断 I0.2 触点是否导通，再在上方执行一次完整 PLC 扫描验证。',
    );
  };
  if (!context || !content)
    return <main className="rounded-xl border bg-white p-8">机电系统课件尚未注册。</main>;
  const station = progress.stations[spec.stationId];
  return (
    <main className="space-y-5" data-testid="learning-station-03">
      <InteractiveIframeHost />
      <StationHeader
        courseId={courseId}
        badge="03 控制推演"
        title="PLC怎样根据输入作出控制决定？"
        description="通过 I/O 映射、三步扫描和动态梯形图，建立“现场状态 → PLC输入 → 逻辑 → PLC输出”的理解。"
      />
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="h-[min(67vh,650px)] min-h-[530px] overflow-hidden rounded-xl border bg-slate-950">
            <InteractiveRenderer content={content} sceneId="learning-center-control-plc" />
          </section>
          <section id="M06" className="rounded-xl border bg-white p-5">
            <Badge variant="outline">K10 · M06</Badge>
            <h2 className="mt-2 text-lg font-semibold">把现场设备连接到正确的 PLC 地址</h2>
            <div className="mt-4 grid gap-3">
              {m06Targets.map(({ id, label, options }) => (
                <label
                  key={id}
                  className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm"
                >
                  <b className="min-w-32">{label}</b>
                  <select
                    className="rounded border px-3 py-2"
                    value={m06[id] ?? ''}
                    onChange={(event) =>
                      setM06((current) => ({ ...current, [id]: event.target.value }))
                    }
                  >
                    <option value="">选择 PLC 地址</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <Button className="mt-4" onClick={submitM06}>
              提交映射
            </Button>
            {m06Message && (
              <p className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-950">{m06Message}</p>
            )}
          </section>
          {remediation && (
            <SmartRemediationCard
              courseId={courseId}
              recommendation={remediation}
              onDismiss={() => setRemediation(null)}
            />
          )}
          <section className="rounded-xl border bg-white p-5">
            <Badge variant="outline">K12 · M07</Badge>
            <h2 className="mt-2 text-lg font-semibold">输入变了，输出会怎样？</h2>
            <p className="mt-2 text-sm text-slate-600">
              当前 I0.2 = <b>{i02 ? 'ON' : 'OFF'}</b>。先预测 Q0.1，再在场景中按 INPUT → LOGIC →
              OUTPUT 执行扫描验证。
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => submitM07(true)}>
                预测 Q0.1 ON
              </Button>
              <Button variant="outline" onClick={() => submitM07(false)}>
                预测 Q0.1 OFF
              </Button>
            </div>
            {m07Message && (
              <p className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-950">{m07Message}</p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              已正确推进扫描：{scanSteps.join(' → ') || '尚未开始'}
            </p>
          </section>
        </div>
        <aside className="space-y-5">
          <ProgressCard
            title="控制推演进度"
            progress={station.progressPercent}
            text="完成 K09—K12 与 M06/M07 后自动完成本站。"
          />
          <KnowledgeCompanion
            courseId={courseId}
            stationId={spec.stationId}
            point="K12"
            interaction={`I0.2 ${i02 ? 'ON' : 'OFF'}；已完成扫描：${scanSteps.join('、') || '无'}`}
            conceptErrors={errors}
            attempts={progress.eventCount}
          />
          {syncWarning && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {syncWarning}
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}

export function ActuationLearningStation({ courseId }: Props) {
  const spec = useMemo(
    () => ({
      stationId: 'station-04-actuation' as const,
      points: ['K13', 'K14'],
      exercises: ['K14-checkpoint'],
    }),
    [],
  );
  const context = getMechLabActivity(courseId, 'mech-lab-line-stop');
  const content = useMemo(
    () => (context ? createActuationInteractiveContent(context) : null),
    [context],
  );
  const { progress, record, complete, syncWarning } = useKnowledgeStation(courseId, spec);
  const [mode, setMode] = useState('NORMAL_EXECUTION');
  const [q01, setQ01] = useState(false);
  const [nodes, setNodes] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [remediation, setRemediation] = useState<RemediationRecommendation | null>(null);
  const [errors, setErrors] = useState<ConceptErrorCode[]>([]);
  const started = useRef(0);
  useEffect(() => {
    started.current = Date.now();
  }, []);
  useEffect(() => {
    if (!context) return;
    const receive = (event: MessageEvent) => {
      if (!isMechLabMessageForContext(event.data, context)) return;
      const message = event.data as MechLabMessage;
      if (message.type === 'MECH_READY') {
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K13',
          eventType: 'VIEW_KNOWLEDGE_POINT',
          payload: { chain: 'Q0.1-valve-cylinder' },
        });
        return;
      }
      if (message.type !== 'MECH_ACTION') return;
      const p = message.payload as Record<string, unknown>;
      if (p.detail === 'EXECUTION_SEQUENCE') {
        const node = String(p.node);
        setNodes((current) => (current.includes(node) ? current : [...current, node]));
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K13',
          eventType: 'EXECUTION_SEQUENCE',
          payload: { node, q01: p.q01, mode: p.mode },
        });
        if (['q01', 'valve', 'air', 'cylinder'].every((item) => [...nodes, node].includes(item)))
          complete('K13', { chain: true });
      }
      if (p.detail === 'OUTPUT_TOGGLE') {
        setQ01(p.q01 === true);
        setMode(String(p.mode));
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K13',
          eventType: 'OUTPUT_TOGGLE',
          payload: { q01: p.q01, cylinderExtended: p.cylinderExtended, mode: p.mode },
        });
      }
      if (p.detail === 'SET_EXECUTION_MODE') setMode(String(p.mode));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [complete, context, nodes, record, spec.stationId]);
  const submitCheckpoint = (layer: string) => {
    const result = evaluateExecutionCheckpoint(layer);
    setErrors((current) => [...new Set([...current, ...result.conceptErrors])]);
    void record({
      stationId: spec.stationId,
      knowledgePointId: 'K14',
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: result.isCorrect,
      attempt: progress.knowledgePoints.K14.attempts + 1,
      payload: {
        exercise: 'K14-checkpoint',
        selectedLayer: layer,
        evidence: { q01, mode, cylinderMoved: q01 && mode === 'NORMAL_EXECUTION' },
        durationMs: elapsedSince(started.current),
        conceptErrors: result.conceptErrors,
      },
    });
    complete('K14', { checkpoint: true });
    setMessage(
      result.isCorrect
        ? 'Q0.1 ON 只证明控制信号已经输出；现场仍未动作时，应优先检查电磁阀、气路和气缸等执行侧。'
        : '请比较 PLC 已经输出的控制信号与现场气缸真实动作，这两项是否已经同时成立。',
    );
    setRemediation(
      result.isCorrect || !result.conceptErrors.length
        ? null
        : resolveRemediationScene({
            conceptErrors: result.conceptErrors,
            currentSceneId: 'S04-03',
            stationId: spec.stationId,
            currentCheckpoint: 'K14-checkpoint',
            contextMode: 'SELF_LEARNING',
          }),
    );
  };
  if (!context || !content)
    return <main className="rounded-xl border bg-white p-8">机电系统课件尚未注册。</main>;
  const station = progress.stations[spec.stationId];
  const failureReady = mode === 'ACTUATION_FAILURE_DEMO' && q01;
  return (
    <main className="space-y-5" data-testid="learning-station-04">
      <InteractiveIframeHost />
      <StationHeader
        courseId={courseId}
        badge="04 执行探索"
        title="一个控制信号怎样变成机械动作？"
        description="沿 Q0.1、电磁阀、气路到气缸观察执行链，并区分有 PLC 输出和真实动作成功。"
      />
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="h-[min(67vh,650px)] min-h-[520px] overflow-hidden rounded-xl border bg-slate-950">
            <InteractiveRenderer content={content} sceneId="learning-center-actuation-cylinder" />
          </section>
          <section id="K14-checkpoint" className="rounded-xl border bg-white p-5">
            <Badge variant="outline">K14 · 知识检查点</Badge>
            <h2 className="mt-2 text-lg font-semibold">有输出 ≠ 一定有动作</h2>
            <p className="mt-2 text-sm text-slate-600">
              {failureReady
                ? '当前情境：I0.2 ON、Q0.1 ON，但气缸未动作。故障范围应优先缩小到哪一层？'
                : '请在场景中切换“执行失败推演”，再打开 Q0.1 ON 形成对比证据。'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                ['sensing', '感知层'],
                ['control', '控制层'],
                ['actuation', '执行层'],
              ].map(([id, label]) => (
                <Button
                  key={id}
                  variant="outline"
                  disabled={!failureReady}
                  onClick={() => submitCheckpoint(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {message && (
              <p className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-950">{message}</p>
            )}
          </section>
          {remediation && (
            <SmartRemediationCard
              courseId={courseId}
              recommendation={remediation}
              onDismiss={() => setRemediation(null)}
            />
          )}
        </div>
        <aside className="space-y-5">
          <ProgressCard
            title="执行探索进度"
            progress={station.progressPercent}
            text="依次点击执行链节点，并完成 K14 情境判断。"
          />
          <KnowledgeCompanion
            courseId={courseId}
            stationId={spec.stationId}
            point="K14"
            interaction={`Q0.1 ${q01 ? 'ON' : 'OFF'}；情境：${mode}`}
            conceptErrors={errors}
            attempts={progress.eventCount}
          />
          {syncWarning && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {syncWarning}
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}

function StationHeader({
  courseId,
  badge,
  title,
  description,
}: {
  courseId: string;
  badge: string;
  title: string;
  description: string;
}) {
  return (
    <header className="rounded-xl border bg-gradient-to-r from-[#092654] to-[#116b73] p-5 text-white shadow-sm">
      <Link
        href={`/zhiban/student/courses/${courseId}/learning-center`}
        className="flex items-center gap-1 text-sm text-blue-100 hover:underline"
      >
        <ArrowLeft className="size-4" />
        返回学习中心
      </Link>
      <Badge className="mt-4 bg-white/20 text-white hover:bg-white/20">{badge}</Badge>
      <h1 className="mt-3 text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-blue-50">{description}</p>
    </header>
  );
}
function ProgressCard({
  title,
  progress,
  text,
}: {
  title: string;
  progress: number;
  text: string;
}) {
  return (
    <section className="rounded-xl border bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {progress === 100 && <CheckCircle2 className="size-4 text-emerald-600" />}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
      <div className="mt-4 h-2 overflow-hidden rounded bg-slate-100">
        <div className="h-full rounded bg-blue-600" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">本站进度 {progress}%</p>
    </section>
  );
}
