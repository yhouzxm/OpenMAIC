'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, GripVertical, Send, Sparkles } from 'lucide-react';
import { InteractiveIframeHost } from '@/components/scene-renderers/InteractiveIframeHost';
import { InteractiveRenderer } from '@/components/scene-renderers/interactive-renderer';
import type { InteractiveContent } from '@/lib/types/stage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SensingLearningStation } from '@/components/zhiban/sensing-learning-station';
import { LearningStationCompletionGuide } from '@/components/zhiban/learning-station-completion-guide';
import { LearningTaskStatusBadge } from '@/components/zhiban/learning-task-status-badge';
import {
  isStationPracticeMode,
  LearningStationHero,
} from '@/components/zhiban/learning-station-hero';
import { RemediationRunBanner } from '@/components/zhiban/smart-remediation-card';
import { SceneGuidanceLayer } from '@/components/zhiban/scene-guidance-layer';
import { VirtualLabRunner } from '@/components/zhiban/virtual-lab-runner';
import {
  ActuationLearningStation,
  ControlLearningStation,
} from '@/components/zhiban/control-actuation-learning-stations';
import {
  AssessmentLearningStation,
  DiagnosisLearningStation,
} from '@/components/zhiban/diagnosis-assessment-learning-stations';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import { createMechSystemRecognitionInteractiveContent } from '@/lib/zhiban/virtual-lab/interactive-template';
import { getMechLabActivity } from '@/lib/zhiban/virtual-lab/registry';
import { isMechLabMessageForContext, type MechLabMessage } from '@/lib/zhiban/virtual-lab/types';
import { getStation } from '@/lib/zhiban/learning-center/registry';
import { attachClassroomSceneContext } from '@/lib/zhiban/classroom/client-scene-context';
import {
  emptyLearningCenterProgress,
  createStationPracticeProgress,
  type LearningCenterProgress,
  type LearningEventInput,
} from '@/lib/zhiban/learning-center';
import {
  resolveGuidanceForError,
  type GuidanceHelpRequest,
  type SceneActionFeedback,
} from '@/lib/zhiban/scene-orchestration/guidance';

const stationId = 'station-01-system' as const;
const sceneId = 'learning-center-line-stop-001';
const deviceInfo: Record<
  string,
  { name: string; layer: string; role: string; input: string; output: string }
> = {
  s1: {
    name: '光电传感器 S1',
    layer: '感知层',
    role: '检测工件进入生产线',
    input: '工件进入检测区域',
    output: '电信号 → PLC 输入',
  },
  s2: {
    name: '光电传感器 S2',
    layer: '感知层',
    role: '检测工件到达检测工位',
    input: '工件到达 S2 检测区域',
    output: '到位电信号 → PLC I0.2',
  },
  plc: {
    name: 'PLC 控制柜',
    layer: '控制层',
    role: '读取传感器信号并作出控制决策',
    input: 'S1/S2 等现场输入信号',
    output: '电机、气缸等控制输出',
  },
  motor: {
    name: '输送电机',
    layer: '执行层',
    role: '驱动输送带移动工件',
    input: 'PLC 电机控制输出',
    output: '旋转运动',
  },
  conveyor: {
    name: '输送带',
    layer: '执行层',
    role: '承载并将工件输送到检测与推料工位',
    input: '输送电机提供的旋转动力',
    output: '工件沿生产线产生物理移动',
  },
  workpiece: {
    name: '工件',
    layer: '物理对象',
    role: '作为生产线传送、检测与推料的加工对象',
    input: '输送带提供的移动与气缸提供的推力',
    output: '位置变化触发 S1、S2 的检测状态',
  },
  cylinder: {
    name: '推料气缸',
    layer: '执行层',
    role: '将工件推入完成区域',
    input: 'PLC 气缸控制输出',
    output: '直线机械动作',
  },
};
const classTargets = [
  { id: 's2', label: 'S2 光电传感器', answer: 'sensing' },
  { id: 'plc', label: 'PLC 控制柜', answer: 'control' },
  { id: 'cylinder', label: '推料气缸', answer: 'actuation' },
] as const;
const layers = { sensing: '感知层', control: '控制层', actuation: '执行层' } as const;
const flowSteps = [
  ['physical', '物理流：工件进入生产线'],
  ['sensing', '信息流：S1 检测并发送信号'],
  ['control', '控制流：PLC 读取输入'],
  ['physical', '物理流：电机驱动输送带'],
  ['sensing', '信息流：S2 检测到位'],
  ['control', '控制流：PLC 输出推料控制'],
  ['actuation', '执行流：气缸完成推料'],
] as const;
const defaultOrder = ['工件进入', '电机输送', 'S1检测', 'PLC读取', 'S2到位', 'PLC控制', '气缸推料'];
const correctOrder = ['工件进入', 'S1检测', 'PLC读取', '电机输送', 'S2到位', 'PLC控制', '气缸推料'];
type SystemSceneId = 'S01-01' | 'S01-02' | 'S01-03' | 'S01-04';

function addLearningHighlightBridge(content: InteractiveContent): InteractiveContent {
  if (!content.html) return content;
  const bridge = `<script>(function(){window.addEventListener('message',function(e){var d=e.data||{},p=d.payload||{};if(d.source!=='zhiban-virtual-lab'||d.version!=='1.0'||d.type!=='MECH_ACTION'||p.action!=='HIGHLIGHT_COMPONENT')return;document.querySelectorAll('[data-device]').forEach(function(node){if(node.getAttribute('data-device')===p.componentId)node.click()})})})()</script>`;
  return { ...content, html: content.html.replace('</body>', `${bridge}</body>`) };
}

export function LearningStation({
  courseId,
  stationId: requestedStationId,
  previewMode,
}: {
  courseId: string;
  stationId: string;
  previewMode?: 'teacher' | 'review';
}) {
  const station = getStation(requestedStationId);
  if (!station) return null;
  const isMechatronicsCourse = Boolean(getMechLabActivity(courseId, 'mech-lab-line-stop'));
  if (isMechatronicsCourse && requestedStationId === 'station-02-sensing')
    return (
      <StationShell courseId={courseId} stationId="station-02-sensing" previewMode={previewMode}>
        <SensingLearningStation courseId={courseId} previewMode={previewMode === 'teacher'} />
      </StationShell>
    );
  if (isMechatronicsCourse && requestedStationId === 'station-03-control')
    return (
      <StationShell courseId={courseId} stationId="station-03-control" previewMode={previewMode}>
        <ControlLearningStation courseId={courseId} previewMode={previewMode === 'teacher'} />
      </StationShell>
    );
  if (isMechatronicsCourse && requestedStationId === 'station-04-actuation')
    return (
      <StationShell courseId={courseId} stationId="station-04-actuation" previewMode={previewMode}>
        <ActuationLearningStation courseId={courseId} previewMode={previewMode === 'teacher'} />
      </StationShell>
    );
  if (isMechatronicsCourse && requestedStationId === 'station-05-diagnosis')
    return (
      <StationShell courseId={courseId} stationId="station-05-diagnosis" previewMode={previewMode}>
        <DiagnosisLearningStation courseId={courseId} previewMode={previewMode === 'teacher'} />
      </StationShell>
    );
  if (isMechatronicsCourse && requestedStationId === 'station-07-assessment')
    return (
      <StationShell courseId={courseId} stationId="station-07-assessment" previewMode={previewMode}>
        <AssessmentLearningStation courseId={courseId} previewMode={previewMode === 'teacher'} />
      </StationShell>
    );
  if (isMechatronicsCourse && requestedStationId === 'station-06-virtual-lab') {
    const virtualLabContext = getMechLabActivity(courseId, 'mech-lab-line-stop');
    if (!virtualLabContext) return null;
    return (
      <StationShell courseId={courseId} stationId="station-06-virtual-lab" previewMode={previewMode}>
        {previewMode === 'teacher' ? (
          <VirtualLabRunner
            context={virtualLabContext}
            presentation="learning-center"
            previewOnly
          />
        ) : (
          <VirtualLabRunner context={virtualLabContext} presentation="learning-center" />
        )}
      </StationShell>
    );
  }
  if (!isMechatronicsCourse || requestedStationId !== stationId)
    return (
      <main className="rounded-xl border bg-white p-8">
        <Link
          href={`/zhiban/student/courses/${courseId}/learning-center`}
          className="text-sm text-blue-600"
        >
          ← 返回学习中心
        </Link>
        <h1 className="mt-5 text-2xl font-semibold">{station.title}</h1>
        <p className="mt-3 text-slate-600">该学习站将在后续批次开放。</p>
      </main>
    );
  return (
    <StationShell courseId={courseId} stationId="station-01-system" previewMode={previewMode}>
      <SystemLearningStation courseId={courseId} previewMode={previewMode === 'teacher'} />
    </StationShell>
  );
}

function StationShell({
  children,
  courseId,
  stationId,
  previewMode,
}: {
  children: ReactNode;
  courseId: string;
  stationId:
    | 'station-01-system'
    | 'station-02-sensing'
    | 'station-03-control'
    | 'station-04-actuation'
    | 'station-05-diagnosis'
    | 'station-06-virtual-lab'
    | 'station-07-assessment';
  previewMode?: 'teacher' | 'review';
}) {
  return (
    <div>
      <RemediationRunBanner courseId={courseId} />
      {previewMode === 'review' && (
        <p className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          评审演示：此账号已获授权快速预览；学习数据仍按真实操作记录。
        </p>
      )}
      {children}
      <LearningStationCompletionGuide courseId={courseId} stationId={stationId} previewMode={previewMode} />
    </div>
  );
}

function SystemLearningStation({
  courseId,
  previewMode = false,
}: {
  courseId: string;
  previewMode?: boolean;
}) {
  const context = getMechLabActivity(courseId, 'mech-lab-line-stop');
  const content = useMemo(
    () =>
      context
        ? addLearningHighlightBridge(
            createMechSystemRecognitionInteractiveContent({
              ...context,
              title: '系统认知 · 自动生产线设备探索',
            }),
          )
        : null,
    [context],
  );
  const [progress, setProgress] = useState<LearningCenterProgress>(() =>
    emptyLearningCenterProgress(courseId),
  );
  const [selectedDevice, setSelectedDevice] = useState('s2');
  const [classification, setClassification] = useState<Record<string, string>>({});
  const [classificationAttempts, setClassificationAttempts] = useState(0);
  const [classificationMessage, setClassificationMessage] = useState('');
  const [order, setOrder] = useState(defaultOrder);
  const [sequenceAttempts, setSequenceAttempts] = useState(0);
  const [sequenceMessage, setSequenceMessage] = useState('');
  const [sequenceComplete, setSequenceComplete] = useState(false);
  const [flowStep, setFlowStep] = useState(-1);
  const [flowPlaying, setFlowPlaying] = useState(false);
  const [flowComplete, setFlowComplete] = useState(false);
  const [syncWarning, setSyncWarning] = useState('');
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [activeSceneId, setActiveSceneId] = useState<SystemSceneId>('S01-01');
  const [guidanceFeedback, setGuidanceFeedback] = useState<
    Partial<Record<SystemSceneId, SceneActionFeedback>>
  >({});
  const [k01ConsecutiveErrors, setK01ConsecutiveErrors] = useState(0);
  const getSendMessage = useWidgetIframeStore((state) => state.getSendMessage);
  const flowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stationCompletedReported = useRef(false);
  const viewReported = useRef(false);
  const stationStartedAt = useRef(Date.now());

  const applyLocalEvent = useCallback((event: LearningEventInput) => {
    setProgress((current) => {
      const next = JSON.parse(JSON.stringify(current)) as LearningCenterProgress;
      next.eventCount += 1;
      const point = event.knowledgePointId
        ? next.knowledgePoints[event.knowledgePointId]
        : undefined;
      if (point) {
        point.attempts = Math.max(point.attempts, event.attempt ?? 1);
        point.lastEventAt = event.timestamp ?? new Date().toISOString();
        if (typeof event.isCorrect === 'boolean') point.correct = event.isCorrect;
        if (event.eventType === 'COMPLETE_KNOWLEDGE_POINT') point.completed = true;
        const station = next.stations[event.stationId];
        const ids = (
          event.stationId === stationId ? ['K01', 'K02', 'K03'] : Object.keys(next.knowledgePoints)
        )
          .map((id) => next.knowledgePoints[id])
          .filter(Boolean);
        const completed = ids.filter((item) => item.completed).length;
        station.completedKnowledgePoints = completed;
        station.progressPercent = station.totalKnowledgePoints
          ? Math.round((completed / station.totalKnowledgePoints) * 100)
          : 0;
        station.status = station.progressPercent === 100 ? 'completed' : 'in_progress';
        station.lastEventAt = point.lastEventAt;
      }
      return next;
    });
  }, []);

  const record = useCallback(
    async (input: LearningEventInput) => {
      const event = attachClassroomSceneContext({ ...input, timestamp: input.timestamp ?? new Date().toISOString() });
      if (previewMode) {
        applyLocalEvent(event);
        return;
      }
      try {
        const response = await fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
        });
        if (!response.ok) throw new Error('event persistence failed');
      } catch {
        setSyncWarning('学习记录暂未同步，不影响本次学习。');
        try {
          localStorage.setItem(`zhiban-learning-center:${courseId}`, JSON.stringify(progress));
        } catch {
          /* optional fallback */
        }
      }
      applyLocalEvent(event);
    },
    [applyLocalEvent, courseId, previewMode, progress],
  );

  useEffect(() => {
    void fetch(`/api/zhiban/student/courses/${courseId}/learning-center`)
      .then(async (response) => {
        if (!response.ok) throw new Error('progress');
        const body = (await response.json()) as { progress?: LearningCenterProgress };
        if (body.progress) {
          stationCompletedReported.current =
            body.progress.stations[stationId].status === 'completed';
          const practiceMode = isStationPracticeMode(window.location.search);
          setProgress(
            practiceMode
              ? createStationPracticeProgress(body.progress, stationId)
              : body.progress,
          );
          setActiveSceneId(
            practiceMode
              ? 'S01-01'
              : !body.progress.knowledgePoints.K01.completed
              ? 'S01-01'
              : !body.progress.knowledgePoints.K02.completed
                ? 'S01-03'
                : 'S01-04',
          );
          setClassificationAttempts(body.progress.knowledgePoints.K02.attempts);
          setSequenceAttempts(body.progress.knowledgePoints.K03.attempts);
        }
      })
      .catch(() => {
        try {
          const cached = localStorage.getItem(`zhiban-learning-center:${courseId}`);
          if (cached) {
            const cachedProgress = JSON.parse(cached) as LearningCenterProgress;
            setProgress(
              isStationPracticeMode(window.location.search)
                ? createStationPracticeProgress(cachedProgress, stationId)
                : cachedProgress,
            );
          }
        } catch {
          /* optional fallback */
        }
        setSyncWarning('学习记录暂未同步，不影响本次学习。');
      });
  }, [courseId]);

  useEffect(() => {
    if (!viewReported.current) {
      viewReported.current = true;
      void record({
        stationId,
        knowledgePointId: 'K01',
        eventType: 'VIEW_KNOWLEDGE_POINT',
        payload: { mode: 'learning' },
      });
    }
  }, [record]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!context || !isMechLabMessageForContext(event.data, context)) return;
      const message = event.data as MechLabMessage;
      if (message.type !== 'MECH_ACTION') return;
      const payload = message.payload as Record<string, unknown>;
      if (payload.action !== 'CLICK_COMPONENT' || typeof payload.target !== 'string') return;
      const target = payload.target;
      setActiveSceneId('S01-02');
      setSelectedDevice(target);
      const targetInfo = deviceInfo[target] ?? deviceInfo.s2;
      void record({
        stationId,
        knowledgePointId: 'K01',
        eventType: 'CLICK_COMPONENT',
        payload: { target, sceneId: 'S01-02' },
      });
      const correct = target === 's2';
      const attempt = Math.max(1, progress.knowledgePoints.K01.attempts + 1);
      void record({
        stationId,
        knowledgePointId: 'K01',
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: correct,
        attempt,
        payload: {
          exercise: 'M01',
          target,
          firstCorrect: correct && attempt === 1,
          durationMs: Date.now() - stationStartedAt.current,
          sceneId: 'S01-02',
        },
      });
      if (correct) {
        setK01ConsecutiveErrors(0);
        setGuidanceFeedback((current) => ({ ...current, 'S01-02': {
          action: `已点击${targetInfo.name}`,
          result: 'S2负责检测工件是否到达检测工位，并把到位信号送往PLC输入。',
          nextFocus: '继续比较S2与PLC、电机和气缸在系统中的不同作用。',
          tone: 'success',
          targetId: target,
        } }));
        void record({
          stationId,
          knowledgePointId: 'K01',
          eventType: 'COMPLETE_KNOWLEDGE_POINT',
          payload: { exercise: 'M01', sceneId: 'S01-02' },
        });
      } else {
        setK01ConsecutiveErrors((current) => {
          const next = current + 1;
          setGuidanceFeedback((feedback) => ({
            ...feedback,
            'S01-02': resolveGuidanceForError({
              errorCode: 'M01_WRONG_TARGET',
              consecutiveErrors: next,
            }),
          }));
          return next;
        });
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [context, progress.knowledgePoints.K01.attempts, record]);

  useEffect(() => {
    if (!flowPlaying) return;
    if (flowStep >= flowSteps.length - 1) {
      setFlowPlaying(false);
      setFlowComplete(true);
      return;
    }
    flowTimer.current = setTimeout(() => {
      const next = flowStep + 1;
      setFlowStep(next);
      void record({
        stationId,
        knowledgePointId: 'K03',
        eventType: 'SEQUENCE_STEP',
        payload: { step: next + 1, label: flowSteps[next][1], sceneId: 'S01-04' },
      });
    }, 900);
    return () => {
      if (flowTimer.current) clearTimeout(flowTimer.current);
    };
  }, [flowPlaying, flowStep, record]);

  useEffect(() => {
    if (flowComplete && sequenceComplete && !progress.knowledgePoints.K03.completed)
      void record({
        stationId,
        knowledgePointId: 'K03',
        eventType: 'COMPLETE_KNOWLEDGE_POINT',
        payload: { exercise: 'M02', sceneId: 'S01-04' },
      });
  }, [flowComplete, progress.knowledgePoints.K03.completed, record, sequenceComplete]);

  useEffect(() => {
    if (progress.stations[stationId]?.status === 'completed' && !stationCompletedReported.current) {
      stationCompletedReported.current = true;
      void record({
        stationId,
        eventType: 'COMPLETE_STATION',
        payload: { knowledgePoints: ['K01', 'K02', 'K03'], exercises: ['M01', 'M02'] },
      });
    }
  }, [progress.stations, record]);

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
            question: '我需要当前设备识别任务的提示。',
            requestId,
            sceneId: 'S01-02',
            stationId,
            knowledgePointId: 'K01',
            currentInteraction: (deviceInfo[selectedDevice] ?? deviceInfo.s2).name,
            studentAttempts: progress.knowledgePoints.K01.attempts,
            incorrectConcepts: [],
          }),
        },
      );
      if (!response.ok) throw new Error('coach unavailable');
      const body = (await response.json()) as { message?: string; notice?: string };
      return `${body.message ?? '请先比较各设备的主要作用。'}${body.notice ? `\n${body.notice}` : ''}`;
    },
    [courseId, progress.knowledgePoints.K01.attempts, selectedDevice],
  );

  if (!context || !content)
    return <main className="rounded-xl border bg-white p-8">机电系统课件尚未注册。</main>;
  const selected = deviceInfo[selectedDevice] ?? deviceInfo.s2;
  const k01Done = progress.knowledgePoints.K01.completed;
  const k02Done = progress.knowledgePoints.K02.completed;
  const k03Done = progress.knowledgePoints.K03.completed;
  const stationDone = progress.stations[stationId].status === 'completed';

  const selectDeviceInfo = (deviceId: string) => {
    setActiveSceneId('S01-02');
    setSelectedDevice(deviceId);
    const info = deviceInfo[deviceId] ?? deviceInfo.s2;
    setGuidanceFeedback((current) => ({ ...current, 'S01-02': {
      action: `已选择${info.name}`,
      result: `设备信息区已显示它的所属层级、输入、作用和输出。`,
      nextFocus: '在3D场景中点击设备，可以完成真实对象识别任务。',
      tone: 'neutral',
      targetId: deviceId,
    } }));
    getSendMessage(sceneId)?.('MECH_ACTION', {
      source: 'zhiban-virtual-lab',
      version: '1.0',
      activityId: context.activityId,
      scenarioId: context.scenarioId,
      timestamp: new Date().toISOString(),
      payload: { action: 'HIGHLIGHT_COMPONENT', componentId: deviceId },
    });
  };

  const submitClassification = () => {
    setActiveSceneId('S01-03');
    const attempt = classificationAttempts + 1;
    setClassificationAttempts(attempt);
    const correct = classTargets.every((item) => classification[item.id] === item.answer);
    if (correct) {
      for (const item of classTargets)
        getSendMessage(sceneId)?.('MECH_ACTION', {
          source: 'zhiban-virtual-lab',
          version: '1.0',
          activityId: context.activityId,
          scenarioId: context.scenarioId,
          timestamp: new Date().toISOString(),
          payload: { action: 'HIGHLIGHT_COMPONENT', componentId: item.id },
        });
    }
    for (const item of classTargets)
      void record({
        stationId,
        knowledgePointId: 'K02',
        eventType: 'CLASSIFY_COMPONENT',
        isCorrect: classification[item.id] === item.answer,
        attempt,
        payload: { componentId: item.id, layer: classification[item.id] ?? null, sceneId: 'S01-03' },
      });
    void record({
      stationId,
      knowledgePointId: 'K02',
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: correct,
      attempt,
      payload: { exercise: 'classification', sceneId: 'S01-03' },
    });
    if (correct) {
      setClassificationMessage('分类正确：信息获取、控制决策和机械动作已形成三层链路。');
      setGuidanceFeedback((current) => ({ ...current, 'S01-03': {
        action: '已提交三层分类',
        result: 'S2、PLC和气缸已形成“感知—控制—执行”系统关系。',
        nextFocus: '继续观察三层关系在正常生产流程中如何依次传递。',
        tone: 'success',
      } }));
      void record({
        stationId,
        knowledgePointId: 'K02',
        eventType: 'COMPLETE_KNOWLEDGE_POINT',
        payload: { sceneId: 'S01-03' },
      });
    } else {
      setClassificationMessage(
        '再想一想：这个设备主要是在获取信息、作出控制决策，还是执行机械动作？',
      );
      setGuidanceFeedback((current) => ({
        ...current,
        'S01-03': resolveGuidanceForError({
          errorCode: 'CLASSIFICATION_ROLE_MISMATCH',
          consecutiveErrors: attempt,
        }),
      }));
    }
  };

  const submitSequence = () => {
    setActiveSceneId('S01-04');
    const correct = order.every((item, index) => item === correctOrder[index]);
    const attempt = sequenceAttempts + 1;
    setSequenceAttempts(attempt);
    const payload = {
      exercise: 'M02',
      order,
      durationMs: Date.now() - stationStartedAt.current,
      sceneId: 'S01-04',
    };
    void record({
      stationId,
      knowledgePointId: 'K03',
      eventType: 'SEQUENCE_STEP',
      isCorrect: correct,
      attempt,
      payload,
    });
    void record({
      stationId,
      knowledgePointId: 'K03',
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: correct,
      attempt,
      payload,
    });
    setSequenceComplete(correct);
    setSequenceMessage(
      correct
        ? '顺序正确。现在播放一次流程，观察三种流如何同步。'
        : '顺序还不完整，请比较“先感知、再控制、后执行”的关系。',
    );
    setGuidanceFeedback((current) => ({
      ...current,
      'S01-04': correct
        ? {
            action: '已提交正常生产流程排序',
            result: '物理流、信息流与控制流已形成正确的先后关系。',
            nextFocus: '播放一次流程，观察三种流如何连续协同。',
            tone: 'success',
          }
        : resolveGuidanceForError({
            errorCode: 'SEQUENCE_CAUSALITY_ERROR',
            consecutiveErrors: attempt,
          }),
    }));
  };

  const askCompanion = async () => {
    const question = aiQuestion.trim();
    if (!question || aiBusy) return;
    setAiBusy(true);
    setAiAnswer('');
    void record({
      stationId,
      knowledgePointId: selectedDevice === 's2' ? 'K01' : undefined,
      eventType: 'REQUEST_AI_HELP',
      payload: { question, sceneId: activeSceneId },
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
            knowledgePointId: 'K01',
            currentInteraction: selected.name,
            studentAttempts: progress.knowledgePoints.K01.attempts,
            incorrectConcepts: Object.values(progress.knowledgePoints)
              .filter((item) => item.correct === false)
              .map((item) => item.knowledgePointId),
          }),
        },
      );
      const body = (await response.json()) as { message?: string; notice?: string };
      setAiAnswer(
        `${body.message ?? '请先观察设备在系统中的输入与输出。'}${body.notice ? `\n${body.notice}` : ''}`,
      );
    } catch {
      setAiAnswer('AI学习伙伴暂时繁忙，请先观察设备在系统中的输入与输出。');
    } finally {
      setAiBusy(false);
      setAiQuestion('');
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= order.length) return;
    const next = [...order];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setOrder(next);
    setActiveSceneId('S01-04');
    setGuidanceFeedback((current) => ({ ...current, 'S01-04': {
      action: `已把“${order[index]}”移动到第${nextIndex + 1}步`,
      result: '当前流程顺序已更新，尚未提交验证。',
      nextFocus: '继续判断下一步应由现场变化、PLC判断还是执行机构动作触发。',
      tone: 'neutral',
    } }));
  };

  return (
    <main className="space-y-5" data-testid="learning-station-01">
      <InteractiveIframeHost />
      <LearningStationHero
        courseId={courseId}
        stationId={stationId}
        headline="自动生产线基本组成与三层结构"
        description="从设备、层级和三种流三个角度建立自动生产线的系统认知。"
        progressPercent={progress.stations[stationId].progressPercent}
        completed={stationDone}
        previewMode={previewMode}
      />
      <SceneGuidanceLayer
        courseId={courseId}
        sceneId={activeSceneId}
        previewMode={previewMode}
        completed={
          activeSceneId === 'S01-02'
            ? k01Done
            : activeSceneId === 'S01-03'
              ? k02Done
              : activeSceneId === 'S01-04'
                ? k03Done
                : false
        }
        recentChallengeCorrect={
          activeSceneId === 'S01-02'
            ? progress.knowledgePoints.K01.correct ?? undefined
            : activeSceneId === 'S01-03'
              ? progress.knowledgePoints.K02.correct ?? undefined
              : activeSceneId === 'S01-04'
                ? progress.knowledgePoints.K03.correct ?? undefined
                : undefined
        }
        consecutiveErrors={
          activeSceneId === 'S01-02'
            ? k01ConsecutiveErrors
            : activeSceneId === 'S01-03' && !k02Done
              ? classificationAttempts
              : activeSceneId === 'S01-04' && !sequenceComplete
                ? sequenceAttempts
                : 0
        }
        actionCount={
          activeSceneId === 'S01-02'
            ? progress.knowledgePoints.K01.attempts
            : activeSceneId === 'S01-03'
              ? Object.keys(classification).length
              : activeSceneId === 'S01-04'
                ? sequenceAttempts
                : 0
        }
        progressSummary={
          activeSceneId === 'S01-01'
            ? '浏览生产线整体结构后，点击设备进入系统认知'
            : activeSceneId === 'S01-02'
              ? k01Done
                ? 'M01已完成'
                : `已尝试${progress.knowledgePoints.K01.attempts}次`
              : activeSceneId === 'S01-03'
                ? k02Done
                  ? '三层系统模型已完成'
                  : `已分类${Object.keys(classification).length}/3个设备`
                : k03Done
                  ? '正常运行基线已建立'
                  : `排序已提交${sequenceAttempts}次`
        }
        feedback={guidanceFeedback[activeSceneId] ?? null}
        onHighlightTarget={activeSceneId === 'S01-02' ? selectDeviceInfo : undefined}
        onRequestHelp={activeSceneId === 'S01-02' ? requestSceneHelp : undefined}
      />
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="relative h-[min(68vh,700px)] min-h-[480px] overflow-hidden rounded-xl border bg-slate-950 shadow-sm">
            <InteractiveRenderer content={content} sceneId={sceneId} />
            <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-cyan-300/30 bg-slate-950/75 px-3 py-2 text-xs text-cyan-100">
              认知模式：拖动旋转，点击设备或工件查看作用。无需启动故障诊断。
            </div>
            {(activeSceneId === 'S01-01' ||
              (activeSceneId === 'S01-02' && progress.knowledgePoints.K01.attempts === 0)) && (
              <div className="pointer-events-none absolute right-4 top-4 max-w-56 rounded-lg border border-cyan-300 bg-cyan-950/90 px-3 py-2 text-xs text-cyan-50 shadow motion-safe:animate-[pulse_1.4s_ease-in-out_2]">
                {activeSceneId === 'S01-01'
                  ? '先浏览生产线整体结构，再点击一个设备查看作用。'
                  : '可点击S1、S2、PLC、电机、输送带、工件和气缸。'}
              </div>
            )}
          </section>
          <section className="rounded-xl border bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Badge variant="outline">K01 · M01</Badge>
                <h2 className="mt-2 text-lg font-semibold">在生产线上找到负责检测工件到位的设备</h2>
              </div>
              <LearningTaskStatusBadge completed={k01Done} />
            </div>
            <p className="mt-2 text-sm text-slate-600">
              请点击三维场景中的设备。目标是找到检测工件到达检测工位的元件。
            </p>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="设备信息速览">
              {Object.entries(deviceInfo).map(([deviceId, device]) => (
                <Button
                  key={deviceId}
                  type="button"
                  size="sm"
                  variant={selectedDevice === deviceId ? 'default' : 'outline'}
                  onClick={() => selectDeviceInfo(deviceId)}
                >
                  {device.name}
                </Button>
              ))}
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm">
              <b>{selected.name}</b>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">所属层级</dt>
                  <dd>{k02Done ? selected.layer : '待完成K02分类后揭示'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">主要作用</dt>
                  <dd>{selected.role}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">输入</dt>
                  <dd>{selected.input}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">输出</dt>
                  <dd>{selected.output}</dd>
                </div>
              </dl>
            </div>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Badge variant="outline">K02</Badge>
                <h2 className="mt-2 text-lg font-semibold">把设备归入感知—控制—执行三层</h2>
              </div>
              <LearningTaskStatusBadge completed={k02Done} />
            </div>
            <div className="mt-4 space-y-3">
              {classTargets.map((item) => (
                <label
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
                >
                  <span className="min-w-40 font-medium">{item.label}</span>
                  <select
                    value={classification[item.id] ?? ''}
                    onChange={(event) => {
                      setActiveSceneId('S01-03');
                      setClassification((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }));
                      setGuidanceFeedback((current) => ({ ...current, 'S01-03': {
                        action: `已为${item.label}选择一个系统层级`,
                        result: '当前分类已暂存，提交后系统才会验证。',
                        nextFocus: '继续从设备接收什么、输出什么判断其角色。',
                        tone: 'neutral',
                      } }));
                    }}
                    className="rounded border px-3 py-2"
                  >
                    <option value="">请选择层级</option>
                    {Object.entries(layers).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <Button className="mt-4" onClick={submitClassification}>
              提交分类
            </Button>
            {classificationMessage && (
              <p className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-900">
                {classificationMessage}
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              已尝试 {classificationAttempts} 次。答错时只提供方向提示，不直接代答。
            </p>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Badge variant="outline">K03 · M02</Badge>
                <h2 className="mt-2 text-lg font-semibold">排序：一次正常生产流程</h2>
              </div>
              <LearningTaskStatusBadge completed={k03Done} />
            </div>
            <p className="mt-2 text-sm text-slate-600">
              拖动或使用上下箭头排序，形成“观察—信号—控制—执行”的流程。
            </p>
            <div className="mt-4 space-y-2">
              {order.map((item, index) => (
                <div
                  key={item}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const from = Number(event.dataTransfer.getData('text/plain'));
                    if (!Number.isInteger(from)) return;
                    const next = [...order];
                    const [moved] = next.splice(from, 1);
                    next.splice(index, 0, moved);
                    setOrder(next);
                    setActiveSceneId('S01-04');
                    setGuidanceFeedback((current) => ({ ...current, 'S01-04': {
                      action: `已把“${moved}”放在第${index + 1}步`,
                      result: '当前流程顺序已更新，尚未提交验证。',
                      nextFocus: '继续检查现场变化、PLC判断和执行动作的因果顺序。',
                      tone: 'neutral',
                    } }));
                  }}
                  className="flex items-center gap-2 rounded border bg-slate-50 p-2 text-sm"
                >
                  <GripVertical className="size-4 text-slate-400" />
                  <span className="w-6 text-center text-xs text-slate-500">{index + 1}</span>
                  <span className="flex-1">{item}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, -1)}
                    aria-label="上移"
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, 1)}
                    aria-label="下移"
                  >
                    ↓
                  </Button>
                </div>
              ))}
            </div>
            <Button className="mt-4" onClick={submitSequence}>
              提交排序
            </Button>
            {sequenceMessage && (
              <p className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-900">{sequenceMessage}</p>
            )}
            <div className="mt-5 border-t pt-4">
              <div className="flex items-center justify-between gap-2">
                <b className="text-sm">正常流程观察</b>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={flowPlaying}
                  onClick={() => {
                    setActiveSceneId('S01-04');
                    setFlowStep(-1);
                    setFlowComplete(false);
                    setFlowPlaying(true);
                  }}
                >
                  播放一次流程
                </Button>
              </div>
              {flowStep >= 0 && (
                <div className="mt-3 rounded-lg bg-slate-900 p-4 text-sm text-white">
                  <p className="text-cyan-300">
                    步骤 {flowStep + 1} / {flowSteps.length}
                  </p>
                  <p className="mt-2 font-medium">{flowSteps[flowStep][1]}</p>
                  <p className="mt-2 text-xs text-slate-300">感知 → 控制 → 执行</p>
                </div>
              )}
            </div>
          </section>
        </div>
        <aside className="space-y-5">
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">当前学习目标</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
              <li>认识 S1、S2、PLC、电机、输送带和气缸</li>
              <li>区分感知层、控制层和执行层</li>
              <li>理解物理流、信息流与控制流的协同</li>
            </ul>
            <div className="mt-4 h-2 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full rounded bg-blue-600"
                style={{ width: `${progress.stations[stationId].progressPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              本站进度 {progress.stations[stationId].progressPercent}%
            </p>
          </section>
          <section className="rounded-xl border bg-white p-5" data-testid="knowledge-companion">
            <div className="flex items-center gap-2 font-semibold">
              <Bot className="size-4 text-blue-600" />
              AI学习伙伴
            </div>
            <p className="mt-2 text-sm text-slate-600">
              可以让我解释概念、打个比方或追问你的判断，但不会直接替你完成练习。
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
                placeholder="如：PLC属于哪一层？"
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
