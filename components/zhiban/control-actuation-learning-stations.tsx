'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, Send, Sparkles } from 'lucide-react';
import { InteractiveIframeHost } from '@/components/scene-renderers/InteractiveIframeHost';
import { InteractiveRenderer } from '@/components/scene-renderers/interactive-renderer';
import { LearningStationHero } from '@/components/zhiban/learning-station-hero';
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
import { SceneGuidanceLayer } from '@/components/zhiban/scene-guidance-layer';
import {
  resolveRemediationScene,
  type RemediationRecommendation,
  type SceneId,
} from '@/lib/zhiban/scene-orchestration';
import {
  isCurrentGuidanceHelpResponse,
  resolveGuidanceForError,
  type GuidanceHelpRequest,
  type SceneActionFeedback,
} from '@/lib/zhiban/scene-orchestration/guidance';

type Props = { courseId: string; previewMode?: boolean };
type StationSpec = { stationId: StationId; points: string[]; exercises: string[] };
const m06Targets: Array<{ id: string; label: string; options: string[] }> = [
  { id: 's2', label: 'S2 光电传感器', options: ['I0.2', 'Q0.1'] },
  { id: 'pusher', label: '推料控制', options: ['Q0.1', 'I0.2'] },
  { id: 'start', label: '启动按钮', options: ['I0.0', 'Q0.0'] },
];

function elapsedSince(startedAt: number) {
  return Date.now() - startedAt;
}

function useKnowledgeStation(courseId: string, spec: StationSpec, previewMode = false) {
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
      if (previewMode) return;
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
    [applyLocalEvent, courseId, previewMode],
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
  sceneId,
}: {
  courseId: string;
  stationId: StationId;
  point: string;
  interaction: string;
  conceptErrors: ConceptErrorCode[];
  attempts: number;
  sceneId: SceneId;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const latestRequestId = useRef<string | null>(null);
  const currentSceneId = useRef(sceneId);
  useEffect(() => {
    currentSceneId.current = sceneId;
    latestRequestId.current = null;
    setAnswer('');
    setBusy(false);
  }, [sceneId]);
  const ask = async () => {
    if (!question.trim() || busy) return;
    const requestId = crypto.randomUUID();
    const requestSceneId = sceneId;
    latestRequestId.current = requestId;
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
            sceneId: requestSceneId,
            requestId,
          }),
        },
      );
      const body = (await response.json()) as { message?: string; notice?: string };
      if (
        !isCurrentGuidanceHelpResponse({
          currentSceneId: currentSceneId.current,
          latestRequestId: latestRequestId.current,
          responseSceneId: requestSceneId,
          responseRequestId: requestId,
        })
      )
        return;
      setAnswer(
        `${body.message ?? '请先观察当前信号链。'}${body.notice ? `\n${body.notice}` : ''}`,
      );
    } catch {
      if (latestRequestId.current !== requestId || currentSceneId.current !== requestSceneId) return;
      setAnswer('AI学习伙伴暂时繁忙，请沿当前信号链逐个观察输入、输出和现场动作。');
    } finally {
      if (latestRequestId.current === requestId && currentSceneId.current === requestSceneId) {
        setBusy(false);
        setQuestion('');
      }
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

export function ControlLearningStation({ courseId, previewMode = false }: Props) {
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
  const { progress, record, complete, syncWarning } = useKnowledgeStation(
    courseId,
    spec,
    previewMode,
  );
  const [i02, setI02] = useState(true);
  const [mappings, setMappings] = useState<string[]>([]);
  const [scanSteps, setScanSteps] = useState<string[]>([]);
  const [m06, setM06] = useState<Record<string, string>>({});
  const [m06Message, setM06Message] = useState('');
  const [m07Message, setM07Message] = useState('');
  const [m07Submitted, setM07Submitted] = useState(false);
  const [errors, setErrors] = useState<ConceptErrorCode[]>([]);
  const [remediation, setRemediation] = useState<RemediationRecommendation | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<
    'S03-01' | 'S03-02' | 'S03-03' | 'S03-04'
  >('S03-01');
  const [guidanceFeedback, setGuidanceFeedback] = useState<
    Partial<Record<'S03-01' | 'S03-02' | 'S03-03' | 'S03-04', SceneActionFeedback>>
  >({});
  const [scanErrors, setScanErrors] = useState(0);
  const [mappingErrors, setMappingErrors] = useState(0);
  const [m07ConsecutiveErrors, setM07ConsecutiveErrors] = useState(0);
  const [latestM07Correct, setLatestM07Correct] = useState<boolean>();
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
          payload: { panel: 'PLC I/O', sceneId: 'S03-01' },
        });
        complete('K09', { sceneId: 'S03-01' });
        return;
      }
      if (message.type !== 'MECH_ACTION') return;
      const p = message.payload as Record<string, unknown>;
      if (p.detail === 'LADDER_TOGGLE') {
        setActiveSceneId('S03-04');
        setI02(p.i02 === true);
        setGuidanceFeedback((current) => ({ ...current, 'S03-04': {
          action: `已设置I0.2情境为${p.i02 === true ? 'ON' : 'OFF'}`,
          result: '输入情境已确定，Q0.1逻辑结果尚未通过扫描验证。',
          nextFocus: '先预测Q0.1，再运行INPUT→LOGIC→OUTPUT进行比较。',
          tone: 'neutral',
        } }));
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K12',
          eventType: 'LADDER_TOGGLE',
          payload: { i02: p.i02, sceneId: 'S03-04' },
        });
      }
      if (p.detail === 'MAP_IO') {
        setActiveSceneId('S03-02');
        const key = `${p.from}->${p.to}`;
        setMappings((current) => (current.includes(key) ? current : [...current, key]));
        setGuidanceFeedback((current) => ({ ...current, 'S03-02': {
          action: `已选择${String(p.from)}并追踪到${String(p.to)}`,
          result: '场景已高亮现场对象与PLC地址之间的信号关系。',
          nextFocus: '继续判断该信号是进入PLC，还是由PLC发送给执行侧。',
          tone: 'neutral',
        } }));
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K10',
          eventType: 'MAP_IO',
          payload: { from: p.from, to: p.to, sceneId: 'S03-02' },
        });
      }
      if (p.detail === 'PLC_SCAN_STEP') {
        const scanSceneId = m07Submitted ? 'S03-04' : 'S03-03';
        setActiveSceneId(scanSceneId);
        const step = String(p.step);
        const correct = p.isCorrect === true;
        if (!correct) {
          setErrors((current) =>
            current.includes('PLC_SCAN_SEQUENCE_ERROR')
              ? current
              : [...current, 'PLC_SCAN_SEQUENCE_ERROR'],
          );
          setScanErrors((current) => {
            const next = current + 1;
            setGuidanceFeedback((feedback) => ({
              ...feedback,
              [scanSceneId]: resolveGuidanceForError({
                errorCode: 'PLC_SCAN_SEQUENCE_ERROR',
                consecutiveErrors: next,
              }),
            }));
            return next;
          });
        } else {
          setScanErrors(0);
          setScanSteps((current) => (current.includes(step) ? current : [...current, step]));
          const stepFeedback: Record<string, SceneActionFeedback> = {
            input: {
              action: '已执行读取输入',
              result: `PLC已读取当前I0.2状态，输入映像已确定。`,
              nextFocus: '下一步依据该输入执行控制逻辑。',
              tone: 'neutral',
            },
            logic: {
              action: '已执行控制逻辑',
              result: '程序已根据输入状态完成逻辑判断。',
              nextFocus: '下一步把逻辑结果刷新到PLC输出。',
              tone: 'neutral',
            },
            output: {
              action: '已刷新PLC输出',
              result: 'PLC已更新Q0.1，一个完整扫描周期完成。',
              nextFocus: m07Submitted ? '把实际结果与预测进行比较。' : '继续进入动态梯形图预测验证。',
              tone: 'success',
            },
          };
          if (stepFeedback[step])
            setGuidanceFeedback((current) => ({ ...current, [scanSceneId]: stepFeedback[step] }));
        }
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K11',
          eventType: 'PLC_SCAN_STEP',
          isCorrect: correct,
          payload: { step, i02: p.i02, q01: p.q01, sceneId: scanSceneId },
        });
        if (correct && step === 'output') {
          complete('K11', { sceneId: 'S03-03' });
          if (m07Submitted) {
            complete('K12', { exercise: 'M07', verifiedBy: 'plc-scan', sceneId: 'S03-04' });
            setGuidanceFeedback((current) => ({
              ...current,
              'S03-04': latestM07Correct
                ? {
                    action: '已完成INPUT→LOGIC→OUTPUT扫描',
                    result: `梯形图信号传递完成，Q0.1为${p.q01 === true ? 'ON' : 'OFF'}；预测与实际一致。`,
                    nextFocus: '回看I0.2触点与Q0.1线圈之间的逻辑通路。',
                    tone: 'success',
                  }
                : resolveGuidanceForError({
                    errorCode: 'LADDER_LOGIC_CONFUSION',
                    consecutiveErrors: Math.max(1, m07ConsecutiveErrors),
                  }),
            }));
          }
        }
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [
    complete,
    context,
    latestM07Correct,
    m07ConsecutiveErrors,
    m07Submitted,
    record,
    spec.stationId,
  ]);
  const submitM06 = () => {
    setActiveSceneId('S03-02');
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
            sceneId: 'S03-02',
          },
        }),
    );
    complete('K10', { exercise: 'M06', sceneId: 'S03-02' });
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
    if (correct) {
      setMappingErrors(0);
      setGuidanceFeedback((current) => ({ ...current, 'S03-02': {
        action: '已提交现场设备与PLC地址映射',
        result: '现场输入信号与PLC输入区、PLC输出与执行侧的方向关系一致。',
        nextFocus: '进入PLC扫描，观察输入如何经过逻辑变成输出。',
        tone: 'success',
      } }));
    } else {
      setMappingErrors((current) => {
        const next = current + 1;
        setGuidanceFeedback((feedback) => ({
          ...feedback,
          'S03-02': resolveGuidanceForError({
            errorCode: 'FIELD_IO_MAPPING_ERROR',
            consecutiveErrors: next,
          }),
        }));
        return next;
      });
    }
  };
  const submitM07 = (prediction: boolean) => {
    setActiveSceneId('S03-04');
    const result = evaluateM07(i02, prediction);
    setLatestM07Correct(result.isCorrect);
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
        sceneId: 'S03-04',
      },
    });
    setM07Submitted(true);
    setM07Message('预测已记录。请在上方依次点击 INPUT → LOGIC → OUTPUT，运行后再比较实际结果。');
    setGuidanceFeedback((current) => ({ ...current, 'S03-04': {
      action: `已预测Q0.1为${prediction ? 'ON' : 'OFF'}`,
      result: '预测已记录，真实输出将在完成PLC扫描后揭示。',
      nextFocus: '按INPUT→LOGIC→OUTPUT执行扫描，观察梯形图信号传递。',
      tone: 'neutral',
    } }));
    if (result.isCorrect) {
      setM07ConsecutiveErrors(0);
    } else {
      setM07ConsecutiveErrors((current) => current + 1);
    }
  };
  const requestSceneHelp = useCallback(
    async ({ requestId }: GuidanceHelpRequest) => {
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
            question: '我需要动态梯形图预测任务的提示。',
            requestId,
            sceneId: 'S03-04',
            stationId: spec.stationId,
            knowledgePointId: 'K12',
            currentInteraction: `I0.2 ${i02 ? 'ON' : 'OFF'}；扫描步骤：${scanSteps.join('、') || '尚未开始'}`,
            studentAttempts: progress.knowledgePoints.K12.attempts,
            incorrectConcepts: errors,
            conceptErrors: errors,
            microExercise: 'M07',
          }),
        },
      );
      if (!response.ok) throw new Error('coach unavailable');
      const body = (await response.json()) as { message?: string; notice?: string };
      return `${body.message ?? '请先判断I0.2触点是否满足导通条件。'}${body.notice ? `\n${body.notice}` : ''}`;
    },
    [courseId, errors, i02, progress.knowledgePoints.K12.attempts, scanSteps, spec.stationId],
  );
  if (!context || !content)
    return <main className="rounded-xl border bg-white p-8">机电系统课件尚未注册。</main>;
  const station = progress.stations[spec.stationId];
  return (
    <main className="space-y-5" data-testid="learning-station-03">
      <InteractiveIframeHost />
      <StationHeader
        courseId={courseId}
        stationId="station-03-control"
        title="PLC怎样根据输入作出控制决定？"
        description="通过 I/O 映射、三步扫描和动态梯形图，建立“现场状态 → PLC输入 → 逻辑 → PLC输出”的理解。"
        progress={station.progressPercent}
        completed={station.status === 'completed'}
        previewMode={previewMode}
      />
      <SceneGuidanceLayer
        courseId={courseId}
        sceneId={activeSceneId}
        previewMode={previewMode}
        completed={
          activeSceneId === 'S03-01'
            ? progress.knowledgePoints.K09.completed
            : activeSceneId === 'S03-02'
              ? progress.knowledgePoints.K10.completed
              : activeSceneId === 'S03-03'
                ? progress.knowledgePoints.K11.completed
                : progress.knowledgePoints.K12.completed
        }
        recentChallengeCorrect={
          activeSceneId === 'S03-04'
            ? latestM07Correct ?? progress.knowledgePoints.K12.correct ?? undefined
            : activeSceneId === 'S03-02'
              ? progress.knowledgePoints.K10.correct ?? undefined
              : undefined
        }
        consecutiveErrors={
          activeSceneId === 'S03-02'
            ? mappingErrors
            : activeSceneId === 'S03-03'
              ? scanErrors
              : activeSceneId === 'S03-04'
                ? m07ConsecutiveErrors
                : 0
        }
        actionCount={
          activeSceneId === 'S03-02'
            ? mappings.length + progress.knowledgePoints.K10.attempts
            : activeSceneId === 'S03-03'
              ? scanSteps.length
              : activeSceneId === 'S03-04'
                ? progress.knowledgePoints.K12.attempts + scanSteps.length
                : progress.knowledgePoints.K09.attempts
        }
        progressSummary={
          activeSceneId === 'S03-01'
            ? '先区分现场信息进入PLC与PLC发出控制'
            : activeSceneId === 'S03-02'
              ? progress.knowledgePoints.K10.completed
                ? 'M06现场设备—PLC地址映射已完成'
                : `已选择${Object.keys(m06).length}/3个映射`
              : activeSceneId === 'S03-03'
                ? `扫描进度：${scanSteps.join('→') || '尚未开始'}`
                : progress.knowledgePoints.K12.completed
                  ? 'M07预测与扫描验证已完成'
                  : `已完成扫描：${scanSteps.join('→') || '尚未开始'}`
        }
        feedback={guidanceFeedback[activeSceneId] ?? null}
        onRequestHelp={activeSceneId === 'S03-04' ? requestSceneHelp : undefined}
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
                    onChange={(event) => {
                      setActiveSceneId('S03-02');
                      setM06((current) => ({ ...current, [id]: event.target.value }));
                      setGuidanceFeedback((current) => ({ ...current, 'S03-02': {
                        action: `已为${label}选择一个PLC地址`,
                        result: '当前映射已暂存，提交后系统才会验证信号方向。',
                        nextFocus: '继续判断该设备提供输入信息还是接收输出控制。',
                        tone: 'neutral',
                      } }));
                    }}
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
            sceneId={activeSceneId}
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

export function ActuationLearningStation({ courseId, previewMode = false }: Props) {
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
  const { progress, record, complete, syncWarning } = useKnowledgeStation(
    courseId,
    spec,
    previewMode,
  );
  const [mode, setMode] = useState('NORMAL_EXECUTION');
  const [q01, setQ01] = useState(false);
  const [nodes, setNodes] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [remediation, setRemediation] = useState<RemediationRecommendation | null>(null);
  const [errors, setErrors] = useState<ConceptErrorCode[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<'S04-01' | 'S04-02' | 'S04-03'>('S04-01');
  const [guidanceFeedback, setGuidanceFeedback] = useState<
    Partial<Record<'S04-01' | 'S04-02' | 'S04-03', SceneActionFeedback>>
  >({});
  const [checkpointErrors, setCheckpointErrors] = useState(0);
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
          payload: { chain: 'Q0.1-valve-cylinder', sceneId: 'S04-01' },
        });
        return;
      }
      if (message.type !== 'MECH_ACTION') return;
      const p = message.payload as Record<string, unknown>;
      if (p.detail === 'EXECUTION_SEQUENCE') {
        setActiveSceneId('S04-01');
        const node = String(p.node);
        setNodes((current) => (current.includes(node) ? current : [...current, node]));
        const nodeLabel: Record<string, string> = {
          q01: 'PLC输出Q0.1',
          valve: '电磁阀',
          air: '气路',
          cylinder: '气缸',
        };
        const nextNode: Record<string, string> = {
          q01: '继续观察该输出驱动的电磁阀。',
          valve: '继续观察气路是否把动作传递到气缸。',
          air: '继续确认气缸是否产生真实机械动作。',
          cylinder: '回看Q0.1到气缸的完整状态传递是否连续。',
        };
        setGuidanceFeedback((current) => ({ ...current, 'S04-01': {
          action: `已观察${nodeLabel[node] ?? node}`,
          result: `当前节点状态已确认：Q0.1 ${p.q01 === true ? 'ON' : 'OFF'}。`,
          nextFocus: nextNode[node] ?? '沿执行链继续观察下一个节点。',
          tone: 'neutral',
        } }));
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K13',
          eventType: 'EXECUTION_SEQUENCE',
          payload: { node, q01: p.q01, mode: p.mode, sceneId: 'S04-01' },
        });
        if (['q01', 'valve', 'air', 'cylinder'].every((item) => [...nodes, node].includes(item)))
          complete('K13', { chain: true, sceneId: 'S04-01' });
      }
      if (p.detail === 'OUTPUT_TOGGLE') {
        const nextMode = String(p.mode);
        const outputSceneId = nextMode === 'ACTUATION_FAILURE_DEMO' ? 'S04-03' : 'S04-02';
        setActiveSceneId(outputSceneId);
        setQ01(p.q01 === true);
        setMode(nextMode);
        setGuidanceFeedback((current) => ({ ...current, [outputSceneId]: {
          action: `已把Q0.1切换为${p.q01 === true ? 'ON' : 'OFF'}`,
          result:
            p.q01 === true
              ? p.cylinderExtended === true
                ? '控制信号已沿执行链传递，气缸产生了机械动作。'
                : 'PLC输出已经存在，但气缸没有产生真实动作。'
              : 'PLC输出关闭，执行链保持未动作状态。',
          nextFocus:
            outputSceneId === 'S04-03'
              ? '继续比较电磁阀、气路和气缸中间状态。'
              : '沿电磁阀和气路观察控制信号如何变成机械动作。',
          tone: p.q01 === true && p.cylinderExtended !== true ? 'warning' : 'neutral',
        } }));
        void record({
          stationId: spec.stationId,
          knowledgePointId: 'K13',
          eventType: 'OUTPUT_TOGGLE',
          payload: { q01: p.q01, cylinderExtended: p.cylinderExtended, mode: p.mode, sceneId: outputSceneId },
        });
      }
      if (p.detail === 'SET_EXECUTION_MODE') {
        const nextMode = String(p.mode);
        const modeSceneId = nextMode === 'ACTUATION_FAILURE_DEMO' ? 'S04-03' : 'S04-02';
        setMode(nextMode);
        setActiveSceneId(modeSceneId);
        setGuidanceFeedback((current) => ({ ...current, [modeSceneId]: {
          action: nextMode === 'ACTUATION_FAILURE_DEMO' ? '已切换到执行失败推演' : '已切换到正常执行情境',
          result:
            nextMode === 'ACTUATION_FAILURE_DEMO'
              ? '情境已准备，尚需打开Q0.1形成控制输出与机械动作的对比。'
              : '正常执行链情境已恢复。',
          nextFocus: nextMode === 'ACTUATION_FAILURE_DEMO' ? '把Q0.1切换为ON，再观察气缸是否动作。' : '切换Q0.1并逐级观察执行链。',
          tone: 'neutral',
        } }));
        void record({
          stationId: spec.stationId,
          knowledgePointId: nextMode === 'ACTUATION_FAILURE_DEMO' ? 'K14' : 'K13',
          eventType: 'VIEW_KNOWLEDGE_POINT',
          payload: { mode: nextMode, sceneId: modeSceneId },
        });
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [complete, context, nodes, record, spec.stationId]);
  const submitCheckpoint = (layer: string) => {
    setActiveSceneId('S04-03');
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
        sceneId: 'S04-03',
      },
    });
    complete('K14', { checkpoint: true, sceneId: 'S04-03' });
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
    if (result.isCorrect) {
      setCheckpointErrors(0);
      setGuidanceFeedback((current) => ({ ...current, 'S04-03': {
        action: '已提交执行侧情境判断',
        result: 'Q0.1 ON只证明PLC已输出控制，现场机械动作仍需单独验证。',
        nextFocus: '沿Q0.1之后的执行链逐级确认状态传递。',
        tone: 'success',
      } }));
    } else {
      setCheckpointErrors((current) => {
        const next = current + 1;
        setGuidanceFeedback((feedback) => ({
          ...feedback,
          'S04-03': resolveGuidanceForError({
            errorCode: 'OUTPUT_EQUALS_ACTUATION_SUCCESS',
            consecutiveErrors: next,
          }),
        }));
        return next;
      });
    }
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
        stationId="station-04-actuation"
        title="一个控制信号怎样变成机械动作？"
        description="沿 Q0.1、电磁阀、气路到气缸观察执行链，并区分有 PLC 输出和真实动作成功。"
        progress={station.progressPercent}
        completed={station.status === 'completed'}
        previewMode={previewMode}
      />
      <SceneGuidanceLayer
        courseId={courseId}
        sceneId={activeSceneId}
        previewMode={previewMode}
        completed={
          activeSceneId === 'S04-03'
            ? progress.knowledgePoints.K14.completed
            : progress.knowledgePoints.K13.completed
        }
        recentChallengeCorrect={
          activeSceneId === 'S04-03'
            ? progress.knowledgePoints.K14.correct ?? undefined
            : undefined
        }
        consecutiveErrors={activeSceneId === 'S04-03' ? checkpointErrors : 0}
        actionCount={
          activeSceneId === 'S04-01'
            ? nodes.length
            : activeSceneId === 'S04-02'
              ? progress.knowledgePoints.K13.attempts
              : progress.knowledgePoints.K14.attempts
        }
        progressSummary={
          activeSceneId === 'S04-01'
            ? `已观察${nodes.length}/4个执行链节点`
            : activeSceneId === 'S04-02'
              ? `当前Q0.1 ${q01 ? 'ON' : 'OFF'}；气缸${q01 && mode === 'NORMAL_EXECUTION' ? '已动作' : '未动作'}`
              : failureReady
                ? 'Q0.1 ON且气缸未动作，执行侧判断已就绪'
                : '请先建立执行失败对比情境'
        }
        feedback={guidanceFeedback[activeSceneId] ?? null}
      />
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="h-[min(67vh,650px)] min-h-[520px] overflow-hidden rounded-xl border bg-slate-950">
            <InteractiveRenderer content={content} sceneId="learning-center-actuation-cylinder" />
          </section>
          <section id="K14-checkpoint" className="rounded-xl border bg-white p-5">
            <Badge variant="outline">K14 · 知识检查点</Badge>
            <h2 className="mt-2 text-lg font-semibold">有输出 ≠ 一定有动作</h2>
            <p id="execution-checkpoint-status" className="mt-2 text-sm text-slate-600">
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
                  aria-describedby="execution-checkpoint-status"
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
            sceneId={activeSceneId}
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
  stationId,
  title,
  description,
  progress,
  completed,
  previewMode,
}: {
  courseId: string;
  stationId: StationId;
  title: string;
  description: string;
  progress: number;
  completed: boolean;
  previewMode: boolean;
}) {
  return (
    <LearningStationHero
      courseId={courseId}
      stationId={stationId}
      headline={title}
      description={description}
      progressPercent={progress}
      completed={completed}
      previewMode={previewMode}
    />
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
