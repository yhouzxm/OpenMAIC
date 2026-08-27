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
import { createSensingInteractiveContent } from '@/lib/zhiban/learning-center/sensing-interactive-template';
import {
  evaluateM04,
  evaluateM05,
  type SensingOutputMode,
  type SensingPosition,
} from '@/lib/zhiban/learning-center/sensing';
import { getStation } from '@/lib/zhiban/learning-center/registry';
import { attachClassroomSceneContext } from '@/lib/zhiban/classroom/client-scene-context';
import {
  emptyLearningCenterProgress,
  type ConceptErrorCode,
  type LearningCenterProgress,
  type LearningEventInput,
} from '@/lib/zhiban/learning-center';
import { getMechLabActivity } from '@/lib/zhiban/virtual-lab/registry';
import { isMechLabMessageForContext, type MechLabMessage } from '@/lib/zhiban/virtual-lab/types';
import { SmartRemediationCard } from '@/components/zhiban/smart-remediation-card';
import {
  resolveRemediationScene,
  type RemediationRecommendation,
} from '@/lib/zhiban/scene-orchestration';

const stationId = 'station-02-sensing' as const;
const sceneId = 'learning-center-sensing-s2';

type SensingSnapshot = {
  position: SensingPosition;
  outputMode: SensingOutputMode;
  s2Active: boolean;
  s2Output: number;
  plcI02: boolean;
};

const initialSnapshot: SensingSnapshot = {
  position: 'before',
  outputMode: 'NORMAL_OUTPUT',
  s2Active: false,
  s2Output: 0,
  plcI02: false,
};

export function SensingLearningStation({ courseId }: { courseId: string }) {
  const context = getMechLabActivity(courseId, 'mech-lab-line-stop');
  const content = useMemo(
    () => (context ? createSensingInteractiveContent(context) : null),
    [context],
  );
  const [progress, setProgress] = useState<LearningCenterProgress>(() =>
    emptyLearningCenterProgress(courseId),
  );
  const [snapshot, setSnapshot] = useState<SensingSnapshot>(initialSnapshot);
  const [m03Results, setM03Results] = useState<Record<string, boolean>>({});
  const [powerMeasured, setPowerMeasured] = useState(false);
  const [m04Message, setM04Message] = useState('');
  const [m05Message, setM05Message] = useState('');
  const [mappingDirections, setMappingDirections] = useState<string[]>([]);
  const [syncWarning, setSyncWarning] = useState('');
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [remediation, setRemediation] = useState<RemediationRecommendation | null>(null);
  const completedPoints = useRef(new Set<string>());
  const stationCompletedReported = useRef(false);
  const m03ByPosition = useRef<Record<string, boolean>>({});
  const conceptErrors = useRef<ConceptErrorCode[]>([]);
  const startedAt = useRef(Date.now());

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
      try {
        const response = await fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
        });
        if (!response.ok) throw new Error('learning event persistence failed');
      } catch {
        setSyncWarning('学习记录暂未同步，不影响本次学习。');
      }
      applyLocalEvent(event);
    },
    [applyLocalEvent, courseId],
  );

  const completePoint = useCallback(
    (knowledgePointId: string, payload: Record<string, unknown> = {}) => {
      if (completedPoints.current.has(knowledgePointId)) return;
      completedPoints.current.add(knowledgePointId);
      void record({ stationId, knowledgePointId, eventType: 'COMPLETE_KNOWLEDGE_POINT', payload });
    },
    [record],
  );

  useEffect(() => {
    void fetch(`/api/zhiban/student/courses/${courseId}/learning-center`)
      .then(async (response) => {
        if (!response.ok) throw new Error('progress');
        const body = (await response.json()) as { progress?: LearningCenterProgress };
        if (body.progress) {
          setProgress(body.progress);
          ['K04', 'K05', 'K06', 'K07', 'K08'].forEach((id) => {
            if (body.progress?.knowledgePoints[id]?.completed) completedPoints.current.add(id);
          });
        }
      })
      .catch(() => setSyncWarning('学习记录暂未同步，不影响本次学习。'));
  }, [courseId]);

  useEffect(() => {
    if (!context) return;
    const receive = (event: MessageEvent) => {
      if (!isMechLabMessageForContext(event.data, context)) return;
      const message = event.data as MechLabMessage;
      if (message.type === 'MECH_READY') {
        void record({
          stationId,
          knowledgePointId: 'K04',
          eventType: 'VIEW_KNOWLEDGE_POINT',
          payload: { interaction: 's2-sensing-simulation' },
        });
        return;
      }
      if (message.type !== 'MECH_ACTION') return;
      const payload = message.payload as Record<string, unknown>;
      const detail = payload.detail;
      const nextSnapshot = (overrides: Partial<SensingSnapshot> = {}) => ({
        position:
          typeof payload.workpiecePosition === 'string'
            ? (payload.workpiecePosition as SensingPosition)
            : snapshot.position,
        outputMode:
          typeof payload.outputMode === 'string'
            ? (payload.outputMode as SensingOutputMode)
            : snapshot.outputMode,
        s2Active: typeof payload.s2Active === 'boolean' ? payload.s2Active : snapshot.s2Active,
        s2Output: typeof payload.s2Output === 'number' ? payload.s2Output : snapshot.s2Output,
        plcI02: typeof payload.plcI02 === 'boolean' ? payload.plcI02 : snapshot.plcI02,
        ...overrides,
      });
      if (detail === 'MOVE_WORKPIECE') {
        const state = nextSnapshot();
        setSnapshot(state);
        void record({
          stationId,
          knowledgePointId: 'K04',
          eventType: 'MOVE_WORKPIECE',
          payload: { ...state, durationMs: Date.now() - startedAt.current },
        });
        completePoint('K04', { learnedBy: 'workpiece-drag' });
      }
      if (detail === 'SET_OUTPUT_MODE') {
        const state = nextSnapshot();
        setSnapshot(state);
        void record({
          stationId,
          knowledgePointId: 'K07',
          eventType: 'VIEW_KNOWLEDGE_POINT',
          payload: { outputMode: state.outputMode },
        });
      }
      if (detail === 'PREDICT_SENSOR_STATE') {
        void record({
          stationId,
          knowledgePointId: 'K05',
          eventType: 'PREDICT_SENSOR_STATE',
          payload: {
            predictedState: payload.predictedState,
            workpiecePosition: payload.workpiecePosition,
          },
        });
      }
      if (detail === 'VERIFY_PREDICTION') {
        const position = String(payload.workpiecePosition ?? snapshot.position);
        const isCorrect = payload.isCorrect === true;
        m03ByPosition.current[position] = isCorrect;
        setM03Results({ ...m03ByPosition.current });
        void record({
          stationId,
          knowledgePointId: 'K05',
          eventType: 'SUBMIT_MICRO_EXERCISE',
          isCorrect,
          attempt: Object.keys(m03ByPosition.current).length,
          payload: {
            exercise: 'M03',
            predictedState: payload.predictedState,
            actualState: payload.actualState,
            position,
            correctionCount: Object.values(m03ByPosition.current).filter((value) => !value).length,
            durationMs: Date.now() - startedAt.current,
          },
        });
        if (Object.keys(m03ByPosition.current).length >= 3)
          completePoint('K05', {
            exercise: 'M03',
            completedPositions: Object.keys(m03ByPosition.current),
          });
      }
      if (detail === 'MEASURE_POWER') {
        setPowerMeasured(true);
        void record({
          stationId,
          knowledgePointId: 'K06',
          eventType: 'MEASURE_POWER',
          payload: { value: 24, unit: 'V', measurement: 's2Power' },
        });
      }
      if (detail === 'MEASURE_OUTPUT') {
        const state = nextSnapshot({
          s2Output: typeof payload.value === 'number' ? payload.value : snapshot.s2Output,
        });
        setSnapshot(state);
        void record({
          stationId,
          knowledgePointId: 'K07',
          eventType: 'MEASURE_OUTPUT',
          payload: {
            value: payload.value,
            unit: 'V',
            outputMode: state.outputMode,
            workpiecePosition: state.position,
            plcI02: state.plcI02,
          },
        });
      }
      if (detail === 'MAP_IO') {
        const direction = `${String(payload.from)}->${String(payload.to)}`;
        setMappingDirections((current) =>
          current.includes(direction) ? current : [...current, direction],
        );
        void record({
          stationId,
          knowledgePointId: 'K08',
          eventType: 'MAP_IO',
          payload: { from: payload.from, to: payload.to },
        });
        if (
          (direction === 's2->I0.2' || direction === 'i02->S2') &&
          !completedPoints.current.has('K08')
        ) {
          const directions = new Set([...mappingDirections, direction]);
          if (directions.has('s2->I0.2') && directions.has('i02->S2'))
            completePoint('K08', { bidirectional: true });
        }
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [completePoint, context, mappingDirections, record, snapshot]);

  useEffect(() => {
    if (progress.stations[stationId]?.status === 'completed' && !stationCompletedReported.current) {
      stationCompletedReported.current = true;
      void record({
        stationId,
        eventType: 'COMPLETE_STATION',
        payload: {
          knowledgePoints: ['K04', 'K05', 'K06', 'K07', 'K08'],
          exercises: ['M03', 'M04', 'M05'],
        },
      });
    }
  }, [progress.stations, record]);

  const answerM04 = (option: string) => {
    const result = evaluateM04(option);
    if (result.conceptError && !conceptErrors.current.includes(result.conceptError))
      conceptErrors.current.push(result.conceptError);
    void record({
      stationId,
      knowledgePointId: 'K06',
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: result.isCorrect,
      attempt: progress.knowledgePoints.K06.attempts + 1,
      payload: {
        exercise: 'M04',
        selectedOption: option,
        measuredPower: 24,
        conceptErrors: result.conceptError ? [result.conceptError] : [],
        durationMs: Date.now() - startedAt.current,
      },
    });
    completePoint('K06', { exercise: 'M04' });
    setM04Message(
      result.isCorrect
        ? '24.0 V DC 说明 S2 供电回路基本正常；还需继续检查输出端是否形成有效信号。'
        : result.conceptError
          ? '24V 只能证明供电条件存在。请继续观察输出端与 PLC I0.2 是否同步变化。'
          : 'PLC程序是否正常，还需要结合输入状态和输出测量进一步判断。',
    );
    setRemediation(
      result.conceptError
        ? resolveRemediationScene({
            conceptErrors: [result.conceptError],
            currentSceneId: 'S02-03',
            stationId,
            currentCheckpoint: 'M04',
            attemptHistory: [{
              code: result.conceptError,
              count: progress.knowledgePoints.K06.attempts + 1,
            }],
            contextMode: 'SELF_LEARNING',
          })
        : null,
    );
  };

  const answerM05 = (option: string) => {
    const result = evaluateM05(option);
    void record({
      stationId,
      knowledgePointId: 'K07',
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: result.isCorrect,
      attempt: progress.knowledgePoints.K07.attempts + 1,
      payload: {
        exercise: 'M05',
        selectedOption: option,
        evidenceUsed: result.evidenceUsed,
        durationMs: Date.now() - startedAt.current,
      },
    });
    completePoint('K07', { exercise: 'M05' });
    setM05Message(
      result.isCorrect
        ? '这是一条感知侧证据链：先确认输出链路，再决定是否需要扩大到控制侧。'
        : '请重新对照工件位置、24V供电、0V输出和 I0.2 OFF 这四项事实。',
    );
  };

  const askCompanion = async () => {
    const question = aiQuestion.trim();
    if (!question || aiBusy) return;
    setAiBusy(true);
    setAiAnswer('');
    void record({
      stationId,
      knowledgePointId: powerMeasured ? 'K06' : 'K04',
      eventType: 'REQUEST_AI_HELP',
      payload: { question, conceptErrors: conceptErrors.current },
    });
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
            knowledgePointId:
              snapshot.outputMode === 'NO_OUTPUT_DEMO' ? 'K07' : powerMeasured ? 'K06' : 'K04',
            currentInteraction: `工件${snapshot.position}，S2 ${snapshot.s2Active ? 'ON' : 'OFF'}，输出 ${snapshot.s2Output}V，I0.2 ${snapshot.plcI02 ? 'ON' : 'OFF'}`,
            studentAttempts: progress.eventCount,
            incorrectConcepts: conceptErrors.current,
            conceptErrors: conceptErrors.current,
            microExercise: powerMeasured ? 'M04/M05' : 'M03',
            predictionHistory: Object.entries(m03Results).map(([position, correct]) => ({
              position,
              correct,
            })),
          }),
        },
      );
      const body = (await response.json()) as { message?: string; notice?: string };
      setAiAnswer(
        `${body.message ?? '请先比较传感器供电、输出和PLC输入。'}${body.notice ? `\n${body.notice}` : ''}`,
      );
    } catch {
      setAiAnswer('AI学习伙伴暂时繁忙，请先比较传感器供电、输出和 PLC I0.2。');
    } finally {
      setAiBusy(false);
      setAiQuestion('');
    }
  };

  if (!context || !content)
    return <main className="rounded-xl border bg-white p-8">机电系统课件尚未注册。</main>;
  const stationProgress = progress.stations[stationId];
  // The station progress is persisted by knowledge-point id.  Keep the
  // exercise cards in sync with that source of truth after a refresh or a
  // new session; the local interaction state is intentionally ephemeral.
  const m03Completed = progress.knowledgePoints.K05?.completed === true;
  const m04Completed = progress.knowledgePoints.K06?.completed === true;
  const m05Completed = progress.knowledgePoints.K07?.completed === true;
  const k08Completed = progress.knowledgePoints.K08?.completed === true;
  const m05Ready =
    snapshot.position === 'inside' &&
    snapshot.outputMode === 'NO_OUTPUT_DEMO' &&
    snapshot.s2Output === 0 &&
    !snapshot.plcI02;

  return (
    <main className="space-y-5" data-testid="learning-station-02">
      <InteractiveIframeHost />
      <header className="rounded-xl border bg-gradient-to-r from-[#092654] to-[#116b73] p-5 text-white shadow-sm">
        <Link
          href={`/zhiban/student/courses/${courseId}/learning-center`}
          className="flex items-center gap-1 text-sm text-blue-100 hover:underline"
        >
          <ArrowLeft className="size-4" />
          返回学习中心
        </Link>
        <Badge className="mt-4 bg-white/20 text-white hover:bg-white/20">
          02 感知探秘 · 机器怎样知道工件到了？
        </Badge>
        <h1 className="mt-3 text-2xl font-semibold">工件位置、S2 输出与 PLC I0.2</h1>
        <p className="mt-2 text-sm text-blue-50">
          请通过拖动、预测、测量和映射，建立“工件 → 传感器 → 输出 → PLC输入”的证据链。
        </p>
      </header>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="h-[min(67vh,650px)] min-h-[540px] overflow-hidden rounded-xl border bg-slate-950 shadow-sm">
            <InteractiveRenderer content={content} sceneId={sceneId} />
          </section>
          <section className="grid gap-4 md:grid-cols-3">
            <KnowledgeStatus
              title="M03 位置预测"
              done={m03Completed}
              text={m03Completed ? '已完成 3 / 3 个位置预测' : `已完成 ${Object.keys(m03Results).length} / 3 个位置预测`}
            />
            <KnowledgeStatus
              title="M04 供电判断"
              done={m04Completed}
              text={m04Completed ? '已完成供电状态判断' : powerMeasured ? '已测得 24.0 V DC' : '请在场景中测量 S2 供电端'}
            />
            <KnowledgeStatus
              title="M05 证据决策"
              done={m05Completed}
              text={m05Completed ? '已完成证据决策' : m05Ready ? '证据情境已就绪' : '切换无输出推演并让工件进入检测区'}
            />
          </section>
          {powerMeasured && (
            <section id="M04" className="rounded-xl border bg-white p-5">
              <Badge variant="outline">K06 · M04</Badge>
              <h2 className="mt-2 text-lg font-semibold">24.0 V DC 能说明什么？</h2>
              <p className="mt-2 text-sm text-slate-600">请基于刚才的测量结果作出判断。</p>
              <div className="mt-4 grid gap-2">
                {[
                  ['A', 'S2已经完全正常'],
                  ['B', 'S2供电回路基本正常'],
                  ['C', 'PLC程序一定正常'],
                ].map(([key, label]) => (
                  <Button
                    key={key}
                    variant="outline"
                    className="justify-start text-left"
                    onClick={() => answerM04(key)}
                  >
                    {key}. {label}
                  </Button>
                ))}
              </div>
              {m04Message && (
                <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-950">{m04Message}</p>
              )}
            </section>
          )}
          {remediation && (
            <SmartRemediationCard
              courseId={courseId}
              recommendation={remediation}
              onDismiss={() => setRemediation(null)}
            />
          )}
          {m05Ready && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <Badge variant="outline">K07 · M05</Badge>
              <h2 className="mt-2 text-lg font-semibold">
                根据证据，下一步最合理的判断或行动是什么？
              </h2>
              <p className="mt-2 text-sm text-slate-700">
                工件已到达检测区；S2供电 24.0V；S2输出 0V；PLC I0.2 OFF。
              </p>
              <div className="mt-4 grid gap-2">
                {[
                  ['A', '因为24V正常，所以S2一定正常'],
                  ['B', '继续检查S2输出链路，并优先将范围缩小到感知侧'],
                  ['C', '直接认定PLC程序故障'],
                  ['D', '立即更换气缸'],
                ].map(([key, label]) => (
                  <Button
                    key={key}
                    variant="outline"
                    className="justify-start bg-white text-left"
                    onClick={() => answerM05(key)}
                  >
                    {key}. {label}
                  </Button>
                ))}
              </div>
              {m05Message && (
                <p className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-800">{m05Message}</p>
              )}
            </section>
          )}
        </div>
        <aside className="space-y-5">
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">当前状态链</h2>
            <div className="mt-3 space-y-2 text-sm">
              <p>
                工件：
                <b>
                  {snapshot.position === 'inside'
                    ? '检测区内'
                    : snapshot.position === 'before'
                      ? '检测区前'
                      : '检测区后'}
                </b>
              </p>
              <p>
                S2：<b>{snapshot.s2Active ? 'ON' : 'OFF'}</b>
              </p>
              <p>
                输出：<b>{snapshot.s2Output ? '24.0 V' : '0 V'}</b>
              </p>
              <p>
                PLC I0.2：<b>{snapshot.plcI02 ? 'ON' : 'OFF'}</b>
              </p>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full bg-blue-600"
                style={{ width: `${stationProgress.progressPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              本站进度 {stationProgress.progressPercent}%
            </p>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">K08 双向映射</h2>
            <p className="mt-2 text-sm text-slate-600">
              在场景中分别点击 S2 和 PLC I0.2，沿高亮信号线查看双向对应。
            </p>
            <p className="mt-3 text-sm">
              已完成：{k08Completed ? 2 : mappingDirections.length} / 2
            </p>
            {k08Completed && (
              <p className="mt-2 flex items-center gap-1 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" />
                S2 ↔ I0.2 映射已建立
              </p>
            )}
          </section>
          <section className="rounded-xl border bg-white p-5">
            <div className="flex items-center gap-2 font-semibold">
              <Bot className="size-4 text-blue-600" />
              AI学习伙伴
            </div>
            <p className="mt-2 text-sm text-slate-600">
              我会结合你当前的工件、输出和 I0.2 状态解释概念，不直接替你选答案。
            </p>
            {aiAnswer && (
              <div className="mt-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-3 text-sm leading-6 text-blue-950">
                {aiAnswer}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <Input
                value={aiQuestion}
                onChange={(event) => setAiQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void askCompanion();
                }}
                placeholder="为什么有24V仍可能I0.2 OFF？"
                disabled={aiBusy}
              />
              <Button
                size="icon"
                aria-label="提问AI学习伙伴"
                onClick={() => void askCompanion()}
                disabled={aiBusy || !aiQuestion.trim()}
              >
                {aiBusy ? (
                  <Sparkles className="size-4 animate-pulse" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">连接综合实训</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              这些知识会在综合实训中用于判断 S2 供电、输出与 PLC 输入之间的关系。
            </p>
            {stationProgress.status === 'completed' && (
              <Link
                href={`/zhiban/student/courses/${courseId}/learning-center/station-06-virtual-lab`}
                className="mt-3 inline-flex text-sm text-blue-600 hover:underline"
              >
                查看相关综合实训 →
              </Link>
            )}
          </section>
          {syncWarning && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {syncWarning}
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}

function KnowledgeStatus({ title, text, done }: { title: string; text: string; done: boolean }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <b className="text-sm">{title}</b>
        {done && (
          <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
            <CheckCircle2 className="size-3.5" />
            已完成
          </Badge>
        )}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{text}</p>
    </section>
  );
}
