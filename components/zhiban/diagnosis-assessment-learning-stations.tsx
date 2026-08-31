'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, RefreshCw, Send, Sparkles, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  isStationPracticeMode,
  LearningStationHero,
  useStationPracticeMode,
} from '@/components/zhiban/learning-station-hero';
import { LearningProfileRadar } from '@/components/zhiban/learning-profile-radar';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import {
  DIAGNOSIS_METHOD_STEPS,
  DIAGNOSIS_SCENARIOS,
  deriveDiagnosisLearningMilestones,
  evaluateM08,
  type ConceptErrorCode,
  type DiagnosisScenarioType,
  type LearningCenterProfile,
  type LearningCenterProgress,
  type LearningEvent,
  type LearningEventInput,
  type StationId,
} from '@/lib/zhiban/learning-center';
import { attachClassroomSceneContext } from '@/lib/zhiban/classroom/client-scene-context';
import { evaluateSignalTraceChoice, SIGNAL_TRACE_PATH } from '@/lib/zhiban/classroom/signal-trace-challenge';
import type { PersistedVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence/types';
import { SmartRemediationCard } from '@/components/zhiban/smart-remediation-card';
import { SceneGuidanceLayer } from '@/components/zhiban/scene-guidance-layer';
import { LearningTaskStatusBadge } from '@/components/zhiban/learning-task-status-badge';
import {
  JudgmentFeedback,
  JudgmentOptionIndicator,
  judgmentOptionClass,
} from '@/components/zhiban/judgment-feedback';
import {
  resolveRemediationScene,
  type RemediationRecommendation,
} from '@/lib/zhiban/scene-orchestration';
import {
  conceptErrorStatusLabel,
  conceptErrorStudentLabel,
  createGuidanceRequestId,
  isCurrentGuidanceHelpResponse,
  resolveGuidanceForError,
  virtualLabErrorPatternMessage,
  type SceneActionFeedback,
} from '@/lib/zhiban/scene-orchestration/guidance';
import type { ConceptErrorStateRecord } from '@/lib/zhiban/scene-orchestration';
import type {
  AssessmentDimensionKey,
  ErrorPattern,
  VirtualLabAssessment,
} from '@/lib/zhiban/virtual-lab/assessment';

const COURSE_ID = 'mech-mechatronics-system';
const dimensionLabels = {
  systemUnderstanding: '系统机理理解',
  sensorDetection: '传感检测能力',
  plcSignalAnalysis: 'PLC信号分析',
  toolMeasurement: '工具检测能力',
  evidenceReasoning: '证据推理能力',
  faultDiagnosisVerification: '故障诊断与验证',
} as const;

const assessmentDimensionLabels: Record<AssessmentDimensionKey, string> = {
  diagnosisAccuracy: '故障定位',
  procedureQuality: '流程规范',
  evidenceReasoning: '证据推理',
  independence: '独立完成',
  verification: '结果验证',
};

const pathStageDefinitions: Array<{
  stage: '察' | '查' | '测' | '断' | '验';
  label: string;
  missingWhen: ErrorPattern[];
}> = [
  { stage: '察', label: '观察现场现象', missingWhen: [] },
  { stage: '查', label: '检查PLC输入/输出', missingWhen: ['SKIP_PLC_INSPECTION'] },
  { stage: '测', label: '测量供电与输出', missingWhen: ['SKIP_POWER_MEASUREMENT', 'SKIP_OUTPUT_MEASUREMENT'] },
  { stage: '断', label: '依据证据提交判断', missingWhen: ['BLIND_GUESS'] },
  { stage: '验', label: '维修后重启验证', missingWhen: ['INSUFFICIENT_VERIFICATION'] },
];

async function postLearningEvent(courseId: string, event: LearningEventInput) {
  const contextualEvent = attachClassroomSceneContext({
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
  const response = await fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(contextualEvent),
    keepalive: true,
  });
  if (response.ok) return;
  if (response.status === 401) throw new Error('登录状态已失效，请重新登录后继续学习。');
  if (response.status === 403) throw new Error('学习记录未同步，请确认已完成上一学习站。');
  throw new Error('学习记录暂未同步，不影响本次学习。');
}

function elapsedSince(startedAt: number) {
  return Date.now() - startedAt;
}

function Header({
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

export function DiagnosisLearningStation({
  courseId,
  previewMode = false,
}: {
  courseId: string;
  previewMode?: boolean;
}) {
  const [scenarioId, setScenarioId] = useState<DiagnosisScenarioType>('sensing');
  const [observed, setObserved] = useState<Record<string, string[]>>({});
  const [selectedLayers, setSelectedLayers] = useState<Record<string, string>>({});
  const [selectedEvidence, setSelectedEvidence] = useState<Record<string, string[]>>({});
  const [completedScenarios, setCompletedScenarios] = useState<Record<string, boolean>>({});
  const [methodSteps, setMethodSteps] = useState<string[]>([]);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [conceptErrors, setConceptErrors] = useState<ConceptErrorCode[]>([]);
  const [syncWarning, setSyncWarning] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [remediation, setRemediation] = useState<RemediationRecommendation | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<
    'S05-01' | 'S05-02' | 'S05-03' | 'S05-04'
  >('S05-01');
  const [guidanceFeedback, setGuidanceFeedback] = useState<
    Partial<Record<'S05-01' | 'S05-02' | 'S05-03' | 'S05-04', SceneActionFeedback>>
  >({});
  const [scenarioErrors, setScenarioErrors] = useState<Record<string, number>>({});
  const [latestScenarioCorrect, setLatestScenarioCorrect] = useState<Record<string, boolean>>({});
  const startedAt = useRef(0);
  const completionSent = useRef(false);
  const diagnosisAttemptBase = useRef(0);
  const [challengeRemaining, setChallengeRemaining] = useState(60);
  const [challengeRunning, setChallengeRunning] = useState(false);
  const [challengeAttempts, setChallengeAttempts] = useState(0);
  const [challengeMessage, setChallengeMessage] = useState('');
  const [challengeSelection, setChallengeSelection] = useState<string>();
  const [challengeCorrect, setChallengeCorrect] = useState<boolean>();
  const challengeStartedAt = useRef(0);
  const challengeFirstChoice = useRef<string | null>(null);
  const latestAiRequestId = useRef<string | null>(null);
  const currentSceneIdRef = useRef(activeSceneId);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  useEffect(() => {
    currentSceneIdRef.current = activeSceneId;
    latestAiRequestId.current = null;
  }, [activeSceneId]);
  useEffect(() => {
    if (previewMode) return;
    let active = true;
    void fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('progress');
        const body = (await response.json()) as {
          events?: LearningEvent[];
          progress?: LearningCenterProgress;
          diagnosisMilestones?: ReturnType<typeof deriveDiagnosisLearningMilestones>;
        };
        if (!active) return;
        // Prefer the compact server projection. Keep the old event fallback so
        // rolling deployments remain compatible while server and client
        // instances are being restarted.
        const milestones =
          body.diagnosisMilestones ?? deriveDiagnosisLearningMilestones(body.events ?? []);
        // A production database can respond after the learner has already
        // started interacting. Merge persisted evidence instead of replacing
        // newer local milestones with an older response snapshot.
        const practiceMode = isStationPracticeMode(window.location.search);
        diagnosisAttemptBase.current = practiceMode
          ? (body.progress?.knowledgePoints.K15.attempts ?? 0)
          : 0;
        if (!practiceMode) {
          setMethodSteps((current) => [...new Set([...milestones.methodSteps, ...current])]);
          setCompletedScenarios((current) => ({
            ...milestones.completedScenarios,
            ...current,
          }));
        }
        completionSent.current =
          body.progress?.stations['station-05-diagnosis'].status === 'completed';
      })
      .catch(() => {
        if (active) setSyncWarning('学习记录暂未同步，不影响本次学习。');
      });
    return () => {
      active = false;
    };
  }, [courseId, previewMode]);
  useEffect(() => {
    if (!challengeRunning) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, 60 - Math.floor((Date.now() - challengeStartedAt.current) / 1000));
      setChallengeRemaining(remaining);
      if (remaining === 0) {
        setChallengeRunning(false);
        setChallengeMessage('本轮已结束，可重新挑战并沿信号链逐点比较。');
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [challengeRunning]);

  const record = useCallback(
    (event: LearningEventInput) => {
      if (previewMode) return Promise.resolve();
      // Start every small event write immediately. `keepalive` lets an active
      // request finish during navigation or refresh; client timestamps retain
      // the teaching order even if production responses complete out of order.
      return postLearningEvent(courseId, event)
        .then(() => setSyncWarning(''))
        .catch((error: unknown) =>
          setSyncWarning(
            error instanceof Error
              ? error.message
              : '学习记录暂未同步，不影响本次学习。',
          ),
        );
    },
    [courseId, previewMode],
  );
  const scenario = useMemo(
    () => DIAGNOSIS_SCENARIOS.find((item) => item.id === scenarioId)!,
    [scenarioId],
  );
  const scenarioSceneId =
    scenarioId === 'sensing' ? 'S05-02' : scenarioId === 'control' ? 'S05-03' : 'S05-04';
  const reveal = (kind: 'field' | 'input' | 'output') => {
    setActiveSceneId(scenarioSceneId);
    setObserved((current) => ({
      ...current,
      [scenarioId]: [...new Set([...(current[scenarioId] ?? []), kind])],
    }));
    void record({
      stationId: 'station-05-diagnosis',
      knowledgePointId: 'K15',
      eventType: 'VIEW_DIAGNOSIS_SCENARIO',
      payload: { scenarioType: scenarioId, evidenceType: kind, sceneId: scenarioSceneId },
    });
    const evidenceLabel =
      kind === 'field' ? '现场状态' : kind === 'input' ? 'PLC输入状态' : 'PLC输出状态';
    setGuidanceFeedback((current) => ({ ...current, [scenarioSceneId]: {
      action: `已查看${evidenceLabel}`,
      result: `当前证据已揭示：${kind === 'field' ? scenario.fieldState : kind === 'input' ? scenario.inputState : scenario.outputState}`,
      nextFocus:
        [...new Set([...viewed, kind])].length >= 3
          ? '三项状态已获取，请选择优先故障层并勾选关键证据。'
          : '继续获取尚未查看的现场、输入或输出状态。',
      tone: 'neutral',
    } }));
  };
  const toggleEvidence = (value: string) => {
    setActiveSceneId(scenarioSceneId);
    setMessages((current) => ({ ...current, [scenarioId]: '' }));
    setLatestScenarioCorrect((current) => {
      const next = { ...current };
      delete next[scenarioId];
      return next;
    });
    setSelectedEvidence((current) => ({
      ...current,
      [scenarioId]: (current[scenarioId] ?? []).includes(value)
        ? (current[scenarioId] ?? []).filter((item) => item !== value)
        : [...(current[scenarioId] ?? []), value],
    }));
    void record({
      stationId: 'station-05-diagnosis',
      knowledgePointId: 'K15',
      eventType: 'SELECT_DIAGNOSIS_EVIDENCE',
      payload: { scenarioType: scenarioId, evidence: value, sceneId: scenarioSceneId },
    });
    setGuidanceFeedback((current) => ({ ...current, [scenarioSceneId]: {
      action: `已${(selectedEvidence[scenarioId] ?? []).includes(value) ? '取消' : '选择'}一项关键证据`,
      result: '证据选择已更新，系统尚未替你形成故障判断。',
      nextFocus: '检查所选证据是否能同时支持现场、输入和输出之间的关系。',
      tone: 'neutral',
    } }));
  };
  const submit = () => {
    setActiveSceneId(scenarioSceneId);
    const evidence = selectedEvidence[scenarioId] ?? [];
    const result = evaluateM08(scenario, selectedLayers[scenarioId] ?? '', evidence);
    setLatestScenarioCorrect((current) => ({ ...current, [scenarioId]: result.isCorrect }));
    setCompletedScenarios((current) => ({ ...current, [scenarioId]: true }));
    setConceptErrors((current) => [...new Set([...current, ...result.conceptErrors])]);
    setMessages((current) => ({
      ...current,
      [scenarioId]: result.isCorrect
        ? '判断与证据链一致。请继续下一个情境。'
        : '请重新比较现场、PLC输入与PLC输出，确认信号在哪一段中断。',
    }));
    void record({
      stationId: 'station-05-diagnosis',
      knowledgePointId: 'K15',
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: result.isCorrect,
      attempt: diagnosisAttemptBase.current + Object.keys(completedScenarios).length + 1,
      payload: {
        exercise: 'M08',
        scenarioType: scenario.id,
        fieldState: scenario.fieldState,
        inputState: scenario.inputState,
        outputState: scenario.outputState,
        selectedLayer: selectedLayers[scenarioId] ?? null,
        selectedEvidence: evidence,
        correctLayer: result.correctLayer,
        durationMs: elapsedSince(startedAt.current),
        conceptErrors: result.conceptErrors,
        sceneId: scenarioSceneId,
      },
    });
    const sourceSceneId = scenarioSceneId;
    setRemediation(
      result.isCorrect || !result.conceptErrors.length
        ? null
        : resolveRemediationScene({
            conceptErrors: result.conceptErrors,
            currentSceneId: sourceSceneId,
            stationId: 'station-05-diagnosis',
            currentCheckpoint: `M08-${scenario.id}`,
            contextMode: 'SELF_LEARNING',
          }),
    );
    if (result.isCorrect) {
      setScenarioErrors((current) => ({ ...current, [scenarioId]: 0 }));
      setGuidanceFeedback((current) => ({ ...current, [scenarioSceneId]: {
        action: '已提交故障层级与关键证据',
        result: '当前判断与现场、PLC输入和PLC输出证据链一致。',
        nextFocus:
          scenarioId === 'sensing'
            ? '继续进入控制层情境，比较输入与输出。'
            : scenarioId === 'control'
              ? '继续进入执行层情境，比较输出与机械动作。'
              : '三个故障层级已完成，可继续进行信号追踪挑战。',
        tone: 'success',
      } }));
    } else {
      setScenarioErrors((current) => {
        const next = (current[scenarioId] ?? 0) + 1;
        const errorCode = result.conceptErrors[0] ?? 'EVIDENCE_SELECTION_ERROR';
        setGuidanceFeedback((feedback) => ({
          ...feedback,
          [scenarioSceneId]: resolveGuidanceForError({
            errorCode,
            consecutiveErrors: next,
          }),
        }));
        return { ...current, [scenarioId]: next };
      });
    }
  };
  useEffect(() => {
    const allScenarios = DIAGNOSIS_SCENARIOS.every((item) => completedScenarios[item.id]);
    if (
      !allScenarios ||
      methodSteps.length !== DIAGNOSIS_METHOD_STEPS.length ||
      completionSent.current
    )
      return;
    completionSent.current = true;
    void record({
      stationId: 'station-05-diagnosis',
      knowledgePointId: 'K15',
      eventType: 'COMPLETE_KNOWLEDGE_POINT',
      payload: { method: DIAGNOSIS_METHOD_STEPS.map((item) => item.label), exercise: 'M08' },
    });
    void record({
      stationId: 'station-05-diagnosis',
      eventType: 'COMPLETE_STATION',
      payload: { knowledgePoints: ['K15'], exercises: ['M08'], conceptErrors },
    });
  }, [completedScenarios, conceptErrors, methodSteps, record]);
  const selectMethodStep = (stepId: string, label: string, description: string) => {
    setActiveSceneId('S05-01');
    setMethodSteps((current) =>
      current.includes(stepId) ? current : [...current, stepId],
    );
    void record({
      stationId: 'station-05-diagnosis',
      knowledgePointId: 'K15',
      eventType: 'SEQUENCE_STEP',
      payload: { step: stepId, label, sceneId: 'S05-01' },
    });
    setGuidanceFeedback((current) => ({ ...current, 'S05-01': {
      action: `已选择“${label}”`,
      result: description,
      nextFocus: '继续判断这一步之前需要什么证据、之后应完成什么诊断行为。',
      tone: 'neutral',
    } }));
  };
  const ask = async () => {
    if (!question.trim() || aiBusy) return;
    const requestId = createGuidanceRequestId();
    const requestSceneId = activeSceneId;
    latestAiRequestId.current = requestId;
    setAiBusy(true);
    setAnswer('');
    void record({
      stationId: 'station-05-diagnosis',
      knowledgePointId: 'K15',
      eventType: 'REQUEST_AI_HELP',
      payload: {
        question,
        mode: 'cognitive_diagnosis',
        scenarioType: scenarioId,
        conceptErrors,
        sceneId: requestSceneId,
        requestId,
      },
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
            mode: 'cognitive_diagnosis',
            stationId: 'station-05-diagnosis',
            knowledgePointId: 'K15',
            currentInteraction: `${scenario.fieldState}；${scenario.inputState}；${scenario.outputState}`,
            studentAttempts: Object.keys(completedScenarios).length,
            incorrectConcepts: conceptErrors,
            conceptErrors,
            microExercise: 'M08',
            selectedEvidence: selectedEvidence[scenarioId] ?? [],
            selectedLayer: selectedLayers[scenarioId],
            sceneId: requestSceneId,
            requestId,
          }),
        },
      );
      const body = (await response.json()) as { message?: string; notice?: string };
      if (
        !isCurrentGuidanceHelpResponse({
          currentSceneId: currentSceneIdRef.current,
          latestRequestId: latestAiRequestId.current,
          responseSceneId: requestSceneId,
          responseRequestId: requestId,
        })
      )
        return;
      setAnswer(
        `${body.message ?? '请沿现场、输入、输出逐段比较。'}${body.notice ? `\n${body.notice}` : ''}`,
      );
    } catch {
      if (latestAiRequestId.current !== requestId || currentSceneIdRef.current !== requestSceneId)
        return;
      setAnswer('AI学习伙伴暂时繁忙，请沿现场状态、PLC输入、PLC输出逐段比较信号链。');
    } finally {
      if (latestAiRequestId.current === requestId && currentSceneIdRef.current === requestSceneId) {
        setAiBusy(false);
        setQuestion('');
      }
    }
  };
  const evidenceOptions = [
    ...new Set([...scenario.keyEvidence, 'power_24v', 'motor_stopped', 'plc_program_unknown']),
  ];
  const startChallenge = () => {
    setActiveSceneId('S05-04');
    challengeStartedAt.current = Date.now();
    challengeFirstChoice.current = null;
    setChallengeAttempts(0);
    setChallengeRemaining(60);
    setChallengeMessage('');
    setChallengeSelection(undefined);
    setChallengeCorrect(undefined);
    setChallengeRunning(true);
    setGuidanceFeedback((current) => ({ ...current, 'S05-04': {
      action: '已开始60秒信号追踪挑战',
      result: '原有计时器已经启动，尚未选择矛盾节点。',
      nextFocus: '先确认信号已经到达哪里，再选择第一个状态矛盾节点。',
      tone: 'neutral',
    } }));
  };
  const chooseChallengeNode = (selectedNode: string) => {
    if (!challengeRunning) return;
    setActiveSceneId('S05-04');
    const attempts = challengeAttempts + 1;
    setChallengeAttempts(attempts);
    challengeFirstChoice.current ??= selectedNode;
    const result = evaluateSignalTraceChoice(selectedNode);
    setChallengeSelection(selectedNode);
    setChallengeCorrect(result.isCorrect);
    if (result.isCorrect) setChallengeRunning(false);
    setChallengeMessage(result.message);
    setGuidanceFeedback((current) => ({
      ...current,
      'S05-04': result.isCorrect
        ? {
            action: `已选择${selectedNode}作为第一个矛盾节点`,
            result: '当前选择与既有信号链证据一致，挑战完成。',
            nextFocus: '回看已检查节点与矛盾节点之间的证据关系。',
            tone: 'success',
          }
        : resolveGuidanceForError({
            errorCode: 'ACTUATION_LAYER_CONFUSION',
            consecutiveErrors: attempts,
          }),
    }));
    void record({
      stationId: 'station-05-diagnosis',
      knowledgePointId: 'K15',
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: result.isCorrect,
      attempt: attempts,
      payload: {
        exercise: 'S05-04-60-second',
        sceneId: 'S05-04',
        selectedNode,
        firstChoice: challengeFirstChoice.current,
        path: SIGNAL_TRACE_PATH,
        attempts,
        durationMs: Date.now() - challengeStartedAt.current,
        isCorrect: result.isCorrect,
        conceptErrors: result.conceptErrors,
      },
    });
  };
  const viewed = observed[scenarioId] ?? [];
  const missingEvidence = [
    ['field', '现场状态'],
    ['input', 'PLC输入状态'],
    ['output', 'PLC输出状态'],
  ].filter(([kind]) => !viewed.includes(kind));
  const activeCompleted =
    activeSceneId === 'S05-01'
      ? methodSteps.length === DIAGNOSIS_METHOD_STEPS.length
      : activeSceneId === 'S05-02'
        ? Boolean(completedScenarios.sensing)
        : activeSceneId === 'S05-03'
          ? Boolean(completedScenarios.control)
          : Boolean(completedScenarios.actuation);
  const activeScenario =
    activeSceneId === 'S05-02'
      ? 'sensing'
      : activeSceneId === 'S05-03'
        ? 'control'
        : 'actuation';
  const diagnosisMilestones =
    (methodSteps.length === DIAGNOSIS_METHOD_STEPS.length ? 1 : 0) +
    Number(Boolean(completedScenarios.sensing)) +
    Number(Boolean(completedScenarios.control)) +
    Number(Boolean(completedScenarios.actuation));
  const diagnosisProgress = Math.round((diagnosisMilestones / 4) * 100);
  const methodCompleted = methodSteps.length === DIAGNOSIS_METHOD_STEPS.length;
  const nextMethodStep = DIAGNOSIS_METHOD_STEPS.find((step) => !methodSteps.includes(step.id));
  return (
    <main className="space-y-5" data-testid="learning-station-05">
      <Header
        courseId={courseId}
        stationId="station-05-diagnosis"
        title="你能沿着信号链找到故障吗？"
        description="使用“察—查—测—断—验”组织证据，在三个轻量情境中判断故障优先层级。"
        progress={diagnosisProgress}
        completed={diagnosisProgress === 100}
        previewMode={previewMode}
      />
      <SceneGuidanceLayer
        courseId={courseId}
        sceneId={activeSceneId}
        previewMode={previewMode}
        completed={activeCompleted}
        recentChallengeCorrect={
          activeSceneId === 'S05-01' ? activeCompleted : latestScenarioCorrect[activeScenario]
        }
        consecutiveErrors={activeSceneId === 'S05-01' ? 0 : (scenarioErrors[activeScenario] ?? 0)}
        actionCount={
          activeSceneId === 'S05-01'
            ? methodSteps.length
            : (observed[activeScenario]?.length ?? 0) +
              (selectedEvidence[activeScenario]?.length ?? 0) +
              (activeSceneId === 'S05-04' ? challengeAttempts : 0)
        }
        progressSummary={
          activeSceneId === 'S05-01'
            ? `已查看 ${methodSteps.length}/5 个诊断步骤`
            : `已获取 ${observed[activeScenario]?.length ?? 0}/3 类状态证据`
        }
        feedback={guidanceFeedback[activeSceneId] ?? null}
      />
      <section className="rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                交互任务
              </Badge>
              <h2 className="font-semibold">K15 · 察—查—测—断—验</h2>
              <LearningTaskStatusBadge completed={methodCompleted} />
            </div>
            <p className="mt-2 text-sm text-slate-600">
              请点击下方五个诊断步骤，逐项了解每一步需要完成的任务。
            </p>
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            已查看 {methodSteps.length} / {DIAGNOSIS_METHOD_STEPS.length}
          </p>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-5" aria-label="五步循证诊断导航">
          {DIAGNOSIS_METHOD_STEPS.map((step, index) => {
            const active = methodSteps.includes(step.id);
            return (
              <button
                key={step.id}
                type="button"
                aria-pressed={active}
                aria-label={`${step.label}：${step.description}；${active ? '已查看' : '点击学习'}`}
                onClick={() => selectMethodStep(step.id, step.label, step.description)}
                className={`group cursor-pointer rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${active ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:-translate-y-0.5 hover:border-blue-400 hover:bg-blue-50 hover:shadow-sm'}`}
              >
                <span className={`text-[11px] font-medium ${active ? 'text-emerald-700' : 'text-blue-600'}`}>
                  第 {index + 1} 步 · {active ? '已查看' : '点击学习'}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <b className="text-lg text-blue-700">{step.label}</b>
                  {active && <CheckCircle2 className="size-4 text-emerald-600" />}
                </span>
                <p className="mt-1 text-xs text-slate-600">{step.description}</p>
              </button>
            );
          })}
        </div>
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${methodCompleted ? 'bg-emerald-50 text-emerald-800' : 'bg-blue-50 text-blue-800'}`}
          aria-live="polite"
        >
          {methodCompleted
            ? '五个诊断步骤均已查看，可以继续完成下方三层故障诊断。'
            : `下一步：点击“${nextMethodStep?.label}”，了解${nextMethodStep?.description}。`}
        </p>
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="rounded-xl border bg-slate-950 p-5 text-white">
            <div className="flex flex-wrap gap-2">
              {DIAGNOSIS_SCENARIOS.map((item) => (
                <Button
                  key={item.id}
                  variant={scenarioId === item.id ? 'default' : 'outline'}
                  className={
                    scenarioId === item.id ? '' : 'border-slate-600 bg-slate-900 text-white'
                  }
                  onClick={() => {
                    const nextSceneId =
                      item.id === 'sensing'
                        ? 'S05-02'
                        : item.id === 'control'
                          ? 'S05-03'
                          : 'S05-04';
                    setScenarioId(item.id);
                    setActiveSceneId(nextSceneId);
                    void record({
                      stationId: 'station-05-diagnosis',
                      knowledgePointId: 'K15',
                      eventType: 'VIEW_DIAGNOSIS_SCENARIO',
                      payload: { scenarioType: item.id, sceneId: nextSceneId },
                    });
                  }}
                >
                  {item.title}
                </Button>
              ))}
            </div>
            <h2 id={`M08-${scenario.id}`} className="mt-5 text-lg font-semibold">M08 · 三层故障诊断</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                ['field', '察 · 查看现场', scenario.fieldState],
                ['input', '查 · 查看PLC输入', scenario.inputState],
                ['output', '查 · 查看PLC输出', scenario.outputState],
              ].map(([kind, title, value]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => reveal(kind as 'field' | 'input' | 'output')}
                  className="rounded-xl border border-slate-600 bg-slate-900 p-4 text-left"
                >
                  <b>{title}</b>
                  <p className="mt-3 text-sm text-cyan-200">
                    {viewed.includes(kind) ? value : '点击获取证据'}
                  </p>
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-2 rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-xs sm:grid-cols-2">
              <div>
                <b className="text-emerald-300">已有证据</b>
                <p className="mt-1 text-slate-200">
                  {viewed.length
                    ? viewed
                        .map((kind) =>
                          kind === 'field' ? '现场状态' : kind === 'input' ? 'PLC输入状态' : 'PLC输出状态',
                        )
                        .join('、')
                    : '尚未获取，请从现场状态开始观察'}
                </p>
              </div>
              <div>
                <b className="text-cyan-300">仍需关注</b>
                <p className="mt-1 text-slate-200">
                  {missingEvidence.length
                    ? missingEvidence.map(([, label]) => label).join('、')
                    : '三类状态已齐全，可比较证据链'}
                </p>
              </div>
            </div>
            {scenarioId === 'control' && (
              <div className="mt-3 grid gap-2 rounded-lg border border-blue-400/30 bg-blue-950/40 p-3 text-xs sm:grid-cols-3" aria-label="控制层输入逻辑输出证据链">
                <p><b className="text-cyan-300">输入</b><span className="mt-1 block text-slate-200">{viewed.includes('input') ? scenario.inputState : '待查看'}</span></p>
                <p><b className="text-cyan-300">逻辑</b><span className="mt-1 block text-slate-200">根据输入与输出关系核对</span></p>
                <p><b className="text-cyan-300">输出</b><span className="mt-1 block text-slate-200">{viewed.includes('output') ? scenario.outputState : '待查看'}</span></p>
              </div>
            )}
            {viewed.length >= 3 && (
              <div className="mt-5 rounded-xl bg-white p-5 text-slate-900">
                <h3 className="font-semibold">断 · 选择优先故障层与关键证据</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    ['sensing', '感知层'],
                    ['control', '控制层'],
                    ['actuation', '执行层'],
                  ].map(([id, label]) => (
                    <Button
                      key={id}
                      variant="outline"
                      className={judgmentOptionClass({
                        selected: selectedLayers[scenarioId] === id,
                        result:
                          selectedLayers[scenarioId] === id && messages[scenarioId]
                            ? latestScenarioCorrect[scenarioId]
                            : undefined,
                      })}
                      aria-pressed={selectedLayers[scenarioId] === id}
                      onClick={() => {
                        setActiveSceneId(scenarioSceneId);
                        setSelectedLayers((current) => ({ ...current, [scenarioId]: id }));
                        setMessages((current) => ({ ...current, [scenarioId]: '' }));
                        setLatestScenarioCorrect((current) => {
                          const next = { ...current };
                          delete next[scenarioId];
                          return next;
                        });
                        void record({
                          stationId: 'station-05-diagnosis',
                          knowledgePointId: 'K15',
                          eventType: 'SELECT_DIAGNOSIS_LAYER',
                          payload: { scenarioType: scenarioId, selectedLayer: id, sceneId: scenarioSceneId },
                        });
                        setGuidanceFeedback((current) => ({
                          ...current,
                          [scenarioSceneId]: {
                            action: `已选择“${label}”作为优先检查层级`,
                            result: '选择已记录，系统尚未替你验证结论。',
                            nextFocus: '勾选能够支持该判断的关键证据，再提交验证。',
                            tone: 'neutral',
                          },
                        }));
                      }}
                    >
                      {label}
                      <JudgmentOptionIndicator
                        selected={selectedLayers[scenarioId] === id}
                        result={
                          selectedLayers[scenarioId] === id && messages[scenarioId]
                            ? latestScenarioCorrect[scenarioId]
                            : undefined
                        }
                      />
                    </Button>
                  ))}
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {evidenceOptions.map((evidence) => (
                    <label
                      key={evidence}
                      className="flex items-center gap-2 rounded border p-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={(selectedEvidence[scenarioId] ?? []).includes(evidence)}
                        onChange={() => toggleEvidence(evidence)}
                      />
                      {evidence}
                    </label>
                  ))}
                </div>
                <Button
                  className="mt-4"
                  disabled={!selectedLayers[scenarioId] || !selectedEvidence[scenarioId]?.length}
                  aria-describedby="diagnosis-submit-requirement"
                  onClick={submit}
                >
                  提交本情境诊断
                </Button>
                <p id="diagnosis-submit-requirement" className="mt-2 text-xs text-slate-500">
                  {!selectedLayers[scenarioId]
                    ? '请先选择优先故障层。'
                    : !selectedEvidence[scenarioId]?.length
                      ? '请至少选择一项关键证据。'
                      : '层级与证据已具备，可以提交验证。'}
                </p>
                <JudgmentFeedback
                  isCorrect={messages[scenarioId] ? latestScenarioCorrect[scenarioId] : undefined}
                  message={messages[scenarioId]}
                />
              </div>
            )}
            {remediation && (
              <div className="mt-5 text-slate-900">
                <SmartRemediationCard
                  courseId={courseId}
                  recommendation={remediation}
                  onDismiss={() => setRemediation(null)}
                />
              </div>
            )}
          </section>
        </div>
        <aside className="space-y-5">
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">M08完成情况</h2>
            <div className="mt-3 space-y-2 text-sm">
              {DIAGNOSIS_SCENARIOS.map((item) => (
                <p key={item.id} className="flex items-center justify-between gap-3">
                  <span>{item.title}</span>
                  <LearningTaskStatusBadge completed={Boolean(completedScenarios[item.id])} />
                </p>
              ))}
            </div>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <div className="flex items-center gap-2 font-semibold">
              <Bot className="size-4 text-blue-600" />
              AI学习伙伴
            </div>
            {answer && (
              <p className="mt-3 whitespace-pre-wrap rounded bg-blue-50 p-3 text-sm text-blue-950">
                {answer}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="如：信号可能在哪一段丢失？"
              />
              <Button size="icon" onClick={() => void ask()} disabled={aiBusy || !question.trim()}>
                {aiBusy ? (
                  <Sparkles className="size-4 animate-pulse" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
          </section>
          {syncWarning && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {syncWarning}
            </p>
          )}
        </aside>
      </section>
      <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5" data-testid="signal-trace-challenge">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 font-semibold"><Timer className="size-5 text-cyan-700" />S05-04 · 60秒信号追踪挑战</h2>
              <LearningTaskStatusBadge completed={challengeCorrect === true} />
            </div>
            <p className="mt-1 text-sm text-slate-600">状态：S2 ON → I0.2 ON → PLC逻辑成立 → Q0.1 ON → 电磁阀得电，但气缸未动作。请选择第一个状态矛盾节点。</p>
          </div>
          <Button onClick={startChallenge}>{challengeRunning ? `剩余 ${challengeRemaining}s` : '开始挑战'}</Button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-describedby="signal-trace-action-status">
          {[['S2', 'S2'], ['I0.2', 'I0.2'], ['PLC Logic', 'PLC Logic'], ['Q0.1', 'Q0.1'], ['solenoid_valve', '电磁阀'], ['cylinder', '气缸']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              disabled={!challengeRunning}
              aria-pressed={challengeSelection === id}
              onClick={() => chooseChallengeNode(id)}
              className={`${judgmentOptionClass({
                selected: challengeSelection === id,
                result: challengeSelection === id ? challengeCorrect : undefined,
              })} flex items-center rounded-lg border px-3 py-4 text-sm font-medium disabled:opacity-60`}
            >
              {label}
              <JudgmentOptionIndicator
                selected={challengeSelection === id}
                result={challengeSelection === id ? challengeCorrect : undefined}
              />
            </button>
          ))}
        </div>
        <p id="signal-trace-action-status" className="mt-2 text-xs text-slate-600">
          {challengeRunning
            ? '计时进行中：请选择信号链上第一个与前序状态矛盾的节点。'
            : challengeMessage
              ? '本轮已结束；点击“开始挑战”可再次尝试。'
              : '请先点击“开始挑战”，节点选择才会启用。'}
        </p>
        <JudgmentFeedback
          isCorrect={challengeCorrect}
          message={challengeMessage}
          pendingLabel={challengeSelection ? '已选择，等待验证' : '本轮未完成'}
        />
      </section>
    </main>
  );
}

export function AssessmentLearningStation({
  courseId,
  previewMode = false,
}: {
  courseId: string;
  previewMode?: boolean;
}) {
  const practiceMode = useStationPracticeMode();
  const [progress, setProgress] = useState<LearningCenterProgress>();
  const [profile, setProfile] = useState<LearningCenterProfile>();
  const [sessions, setSessions] = useState<PersistedVirtualLabSession[]>([]);
  const [conceptErrorStates, setConceptErrorStates] = useState<ConceptErrorStateRecord[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<'S07-01' | 'S07-02' | 'S07-03'>('S07-01');
  const [viewedScenes, setViewedScenes] = useState<Set<string>>(() => new Set());
  const [guidanceFeedback, setGuidanceFeedback] = useState<
    Partial<Record<'S07-01' | 'S07-02' | 'S07-03', SceneActionFeedback>>
  >({});
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const completionSent = useRef(false);
  const viewedEventSent = useRef(new Set<string>());
  const latestAiRequestId = useRef<string | null>(null);
  const currentSceneIdRef = useRef(activeSceneId);
  useEffect(() => {
    const load = async () => {
      const endpoint = `/api/zhiban/student/courses/${courseId}/learning-center`;
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('load');
      if (!previewMode && !completionSent.current) {
        completionSent.current = true;
        await postLearningEvent(courseId, {
          stationId: 'station-07-assessment',
          eventType: 'COMPLETE_STATION',
          payload: { mode: 'assessment_mentor' },
        });
      }
      const refreshed = await fetch(endpoint);
      const body = (await (refreshed.ok ? refreshed : response).json()) as {
        progress: LearningCenterProgress;
        profile: LearningCenterProfile;
        sessions: PersistedVirtualLabSession[];
        conceptErrorStates?: ConceptErrorStateRecord[];
      };
      setProgress(body.progress);
      setProfile(body.profile);
      setSessions(body.sessions);
      setConceptErrorStates(body.conceptErrorStates ?? []);
    };
    void load()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [courseId, previewMode]);
  const assessmentRemediation = useMemo(() => {
    if (!profile) return null;
    return resolveRemediationScene({
      conceptErrors: profile.conceptErrors.flatMap((item) => Array(item.count).fill(item.code)),
      currentSceneId: 'S06-02',
      stationId: 'station-07-assessment',
      learnerProfile: Object.fromEntries(
        Object.entries(profile.dimensions).map(([key, value]) => [key, value.score]),
      ),
      weakDimensions: Object.entries(profile.dimensions)
        .filter(([, value]) => value.score < 75)
        .map(([key]) => key) as Array<keyof typeof profile.dimensions>,
      attemptHistory: profile.conceptErrors.map((item) => ({ code: item.code, count: item.count })),
      currentCheckpoint: 'mech-lab-line-stop',
      contextMode: 'POST_ASSESSMENT',
    });
  }, [profile]);
  const viewScene = useCallback(
    (sceneId: 'S07-01' | 'S07-02' | 'S07-03') => {
      currentSceneIdRef.current = sceneId;
      latestAiRequestId.current = null;
      setFeedback('');
      setActiveSceneId(sceneId);
      setViewedScenes((current) => new Set(current).add(sceneId));
      if (previewMode || viewedEventSent.current.has(sceneId)) return;
      viewedEventSent.current.add(sceneId);
      void postLearningEvent(courseId, {
        stationId: 'station-07-assessment',
        eventType: 'VIEW_KNOWLEDGE_POINT',
        payload: { sceneId, area: 'station-07-review' },
      }).catch(() => undefined);
    },
    [courseId, previewMode],
  );
  const askMentor = async () => {
    if (!profile) return;
    const requestId = createGuidanceRequestId();
    const requestSceneId = activeSceneId;
    latestAiRequestId.current = requestId;
    setFeedback('');
    if (!previewMode)
      void postLearningEvent(courseId, {
        stationId: 'station-07-assessment',
        eventType: 'REQUEST_AI_HELP',
        payload: { mode: 'assessment_mentor', sceneId: requestSceneId, requestId },
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
            question: '请解释我的课件级学习画像，并给出下一步学习行动。',
            mode: 'assessment_mentor',
            stationId: 'station-07-assessment',
            currentInteraction: JSON.stringify({
              dimensions: profile.dimensions,
              strengths: profile.strengths,
              weaknesses: profile.weaknesses,
              recommendations: profile.recommendations,
            }),
            studentAttempts: profile.virtualLab.attempts,
            incorrectConcepts: profile.conceptErrors.map((item) => item.code),
            conceptErrors: profile.conceptErrors.map((item) => item.code),
            sceneId: requestSceneId,
            requestId,
          }),
        },
      );
      const body = (await response.json()) as { message?: string; notice?: string };
      if (
        !isCurrentGuidanceHelpResponse({
          currentSceneId: currentSceneIdRef.current,
          latestRequestId: latestAiRequestId.current,
          responseSceneId: requestSceneId,
          responseRequestId: requestId,
        })
      )
        return;
      setFeedback(
        `${body.message ?? '请优先回学最低维度对应的学习站。'}${body.notice ? `\n${body.notice}` : ''}`,
      );
    } catch {
      if (latestAiRequestId.current !== requestId || currentSceneIdRef.current !== requestSceneId)
        return;
      setFeedback('AI学习伙伴暂时繁忙。请优先完成高优先级补练，再次进入综合实训验证提升。');
    }
  };
  if (loading) return <main className="rounded-xl border bg-white p-8">正在聚合真实学习数据…</main>;
  if (!progress || !profile)
    return (
      <main className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-amber-900">
        暂时无法读取学习画像，请稍后重试。
      </main>
    );
  const completedSessions = sessions.filter((item) => item.status === 'completed');
  const latestAssessment = completedSessions[0]?.assessment ?? null;
  const activeConceptErrors = conceptErrorStates.filter(
    (item) => item.status === 'ACTIVE' || item.status === 'REOPENED',
  );
  const activeCompleted =
    activeSceneId === 'S07-01'
      ? viewedScenes.has(activeSceneId) && Boolean(latestAssessment)
      : activeSceneId === 'S07-02'
        ? viewedScenes.has(activeSceneId) && activeConceptErrors.length === 0
        : viewedScenes.has(activeSceneId) && !assessmentRemediation;
  const dimensionEntries = Object.entries(profile.dimensions) as Array<
    [keyof typeof dimensionLabels, (typeof profile.dimensions)[keyof typeof dimensionLabels]]
  >;
  const strongestDimension = [...dimensionEntries].sort((a, b) => b[1].score - a[1].score)[0];
  const priorityDimension = [...dimensionEntries].sort((a, b) => a[1].score - b[1].score)[0];
  const currentRoundProgress = Math.round((viewedScenes.size / 3) * 100);
  const assessmentSceneCompleted = (sceneId: 'S07-01' | 'S07-02' | 'S07-03') =>
    sceneId === 'S07-01'
      ? viewedScenes.has(sceneId) && Boolean(latestAssessment)
      : sceneId === 'S07-02'
        ? viewedScenes.has(sceneId) && activeConceptErrors.length === 0
        : viewedScenes.has(sceneId) && !assessmentRemediation;
  const radarDimensions = dimensionEntries.map(([key, item]) => ({
    label: dimensionLabels[key],
    shortLabel:
      key === 'systemUnderstanding'
        ? '系统机理'
        : key === 'sensorDetection'
          ? '传感检测'
          : key === 'plcSignalAnalysis'
            ? 'PLC信号'
            : key === 'toolMeasurement'
              ? '工具检测'
              : key === 'evidenceReasoning'
                ? '证据推理'
                : '故障诊断',
    score: item.score,
  }));
  return (
    <main className="space-y-5" data-testid="learning-station-07">
      <Header
        courseId={courseId}
        stationId="station-07-assessment"
        title="我哪里会了，哪里还需要加强？"
        description="六维能力由知识学习、微练习和综合实训的真实表现汇总生成，AI只负责解释结果。"
        progress={
          practiceMode
            ? currentRoundProgress
            : progress.stations['station-07-assessment'].progressPercent
        }
        completed={
          practiceMode
            ? viewedScenes.size === 3
            : progress.stations['station-07-assessment'].status === 'completed'
        }
        previewMode={previewMode}
      />
      <nav className="grid gap-2 rounded-xl border bg-white p-3 md:grid-cols-3" aria-label="评价提升任务">
        {([
          ['S07-01', '过程评价与路径'],
          ['S07-02', '六维画像与误区'],
          ['S07-03', '智能补练与再挑战'],
        ] as const).map(([sceneId, label], index) => (
          <Button
            key={sceneId}
            type="button"
            variant={activeSceneId === sceneId ? 'default' : 'outline'}
            className="h-auto justify-between gap-3 py-3"
            aria-current={activeSceneId === sceneId ? 'step' : undefined}
            onClick={() => viewScene(sceneId)}
          >
            <span>{index + 1}. {label}</span>
            <LearningTaskStatusBadge completed={assessmentSceneCompleted(sceneId)} />
          </Button>
        ))}
      </nav>
      <SceneGuidanceLayer
        courseId={courseId}
        sceneId={activeSceneId}
        previewMode={previewMode}
        completed={activeCompleted}
        consecutiveErrors={activeSceneId === 'S07-02' && activeConceptErrors.length > 0 ? Math.min(3, activeConceptErrors.length + 1) : 0}
        // Station 07 is a read-and-reflect experience. Once its real data has
        // loaded, the learner is already reviewing evidence rather than
        // waiting to operate a simulation object.
        actionCount={1}
        progressSummary={
          activeSceneId === 'S07-01'
            ? latestAssessment ? `最近一次实训：${latestAssessment.overallScore}分 · 五项过程评分` : '尚无可回看的实训过程'
            : activeSceneId === 'S07-02'
              ? `六维画像已聚合 · ${conceptErrorStates.length}项概念状态`
              : assessmentRemediation ? '当前已给出1个优先补练任务，补练后需再挑战' : '当前无需优先补练，可再次实训验证提升'
        }
        feedback={guidanceFeedback[activeSceneId] ?? null}
      />
      {activeSceneId === 'S07-01' && (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">最近综合得分</p><b className="mt-2 block text-3xl text-blue-700">{latestAssessment?.overallScore ?? '—'}</b></div>
            <div className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">本次综合实训用时</p><b className="mt-2 block text-3xl text-blue-700">{latestAssessment ? `${latestAssessment.durationSeconds}s` : '—'}</b></div>
            <div className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">关键证据</p><b className="mt-2 block text-3xl text-blue-700">{latestAssessment?.keyEvidenceCollected.length ?? 0}</b></div>
            <div className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">AI提示</p><b className="mt-2 block text-3xl text-blue-700">{latestAssessment?.hintsUsed ?? 0}</b></div>
          </section>
          <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800">
            时间统计仅包含06综合实训，不包含知识站学习与评价浏览时间。
          </p>
          <section className="rounded-xl border bg-white p-5" data-testid="station-07-process-assessment">
            <h2 className="font-semibold">确定性过程评分（5项）</h2>
            <p className="mt-1 text-sm text-slate-600">综合实训过程评价保持原有五项与100分权重；点击评分项只查看已确定的原因，不会重新评分。</p>
            {latestAssessment ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {(Object.entries(latestAssessment.dimensions) as Array<[AssessmentDimensionKey, VirtualLabAssessment['dimensions'][AssessmentDimensionKey]]>).map(([key, item]) => (
                  <button key={key} type="button" className="rounded-lg border bg-slate-50 p-4 text-left hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => {
                    viewScene('S07-01');
                    setGuidanceFeedback((current) => ({ ...current, 'S07-01': {
                      action: `已查看“${assessmentDimensionLabels[key]}”`, result: `${item.score}/${item.maxScore}分。${item.reason}`, nextFocus: '将该原因与下方循证路径的已形成或缺失证据进行对照。', tone: 'neutral',
                    } }));
                  }}>
                    <span className="text-sm font-medium">{assessmentDimensionLabels[key]}</span>
                    <b className="mt-2 block text-2xl text-blue-700">{item.score}<small className="text-sm text-slate-500">/{item.maxScore}</small></b>
                  </button>
                ))}
              </div>
            ) : <p className="mt-4 text-sm text-slate-500">完成一次综合实训后显示过程评分。</p>}
          </section>
          <section className="rounded-xl border bg-white p-5" data-testid="station-07-path-summary">
            <h2 className="font-semibold">循证诊断路径摘要</h2>
            <p className="mt-1 text-sm text-slate-600">完整操作顺序仍在综合实训完成页以“我的诊断路径 vs 循证诊断路径”只读回放；此处只根据已保存评价显示路径完整度。</p>
            <div className="mt-4 grid gap-2 md:grid-cols-5">
              {pathStageDefinitions.map((node) => {
                const issue = latestAssessment?.errorPatterns.find((pattern) => node.missingWhen.includes(pattern));
                return (
                  <button key={node.stage} type="button" className={`rounded-lg border p-4 text-left ${issue ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`} onClick={() => {
                    viewScene('S07-01');
                    setGuidanceFeedback((current) => ({ ...current, 'S07-01': {
                      action: `已查看“${node.stage}·${node.label}”`, result: issue ? virtualLabErrorPatternMessage(issue) : '本轮确定性分析未标记该步骤缺口。', nextFocus: issue ? '查看对应过程评分原因，并在再挑战时补全证据。' : '继续检查其他路径节点是否完整。', tone: issue ? 'warning' : 'success',
                    } }));
                  }}>
                    <span className="flex size-8 items-center justify-center rounded-full bg-white font-semibold text-blue-700">{node.stage}</span>
                    <b className="mt-2 block text-sm">{node.label}</b>
                    <span className="mt-1 block text-xs">{issue ? '有待补全证据' : '本轮已形成'}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}
      {activeSceneId === 'S07-02' && (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">总体学习进度</p><b className="mt-2 block text-3xl text-blue-700">{profile.overallProgress}%</b></div>
            <div className="rounded-xl border bg-emerald-50 p-5"><p className="text-sm text-emerald-800">我的优势</p><b className="mt-2 block text-lg text-emerald-950">{strongestDimension ? dimensionLabels[strongestDimension[0]] : '尚无足够证据'}</b></div>
            <div className="rounded-xl border bg-amber-50 p-5"><p className="text-sm text-amber-800">当前最需要提升</p><b className="mt-2 block text-lg text-amber-950">{priorityDimension ? dimensionLabels[priorityDimension[0]] : '尚无足够证据'}</b></div>
          </section>
          <section className="rounded-xl border bg-white p-5" data-testid="station-07-six-dimension-profile">
            <h2 className="font-semibold">课件级六维能力画像</h2>
            <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-950">能力画像不会因为浏览过某个学习页面自动提高，只有新的答题、实训或再挑战表现才会更新。</p>
            <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)] xl:items-center">
              <figure className="rounded-xl border border-blue-100 bg-gradient-to-b from-sky-50 to-white p-3">
                <LearningProfileRadar dimensions={radarDimensions} />
                <figcaption className="px-2 pb-2 text-xs leading-5 text-slate-600">
                  雷达图用于快速查看六项能力的均衡程度；具体分数、学习证据和下一步建议请查看右侧。
                </figcaption>
              </figure>
              <div className="grid gap-3 md:grid-cols-2">
                {dimensionEntries.map(([key, item]) => (
                  <button type="button" key={key} className="rounded-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => {
                    viewScene('S07-02');
                    setGuidanceFeedback((current) => ({ ...current, 'S07-02': {
                      action: `已查看“${dimensionLabels[key]}”`, result: `当前${item.score}分，共有${item.evidenceCount}项证据。${item.reason}`, nextFocus: `证据来自：${item.sources.join('、') || '尚无数据'}。`, tone: item.score >= 75 ? 'success' : 'warning',
                    } }));
                  }}>
                    <div className="flex justify-between text-sm"><b>{dimensionLabels[key]}</b><strong>{item.score}</strong></div>
                    <div className="mt-2 h-3 overflow-hidden rounded bg-slate-100" aria-label={`${dimensionLabels[key]} ${item.score}分`}><div className="h-full rounded bg-gradient-to-r from-blue-600 to-cyan-500" style={{ width: `${item.score}%` }} /></div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">证据 {item.evidenceCount} 项 · 来源：{item.sources.join('、') || '尚无数据'}。{item.reason}</p>
                  </button>
                ))}
              </div>
            </div>
          </section>
          <section className="rounded-xl border bg-white p-5" data-testid="station-07-concept-review">
            <h2 className="font-semibold">认知误区复盘</h2>
            {conceptErrorStates.length ? (
              <ul className="mt-4 grid gap-3 md:grid-cols-2">
                {conceptErrorStates.map((item) => <li key={item.code} className="rounded-lg border bg-slate-50 p-4"><b className="text-sm">{conceptErrorStudentLabel(item.code)}</b><p className="mt-1 text-sm text-slate-600">{conceptErrorStatusLabel(item.status)}</p></li>)}
              </ul>
            ) : <p className="mt-3 text-sm text-slate-500">当前没有已记录的结构化概念误区。</p>}
          </section>
        </>
      )}
      {activeSceneId === 'S07-03' && <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-5">
          <h2 className="font-semibold">当前优先任务</h2>
          {assessmentRemediation ? (
            <div className="mt-4">
              <SmartRemediationCard courseId={courseId} recommendation={assessmentRemediation} />
            </div>
          ) : <p className="mt-3 rounded bg-emerald-50 p-3 text-sm text-emerald-900">当前没有需要优先处理的结构化误区。可再次进入综合实训，用新的真实表现继续验证。</p>}
          <p className="mt-4 text-sm text-slate-600">补练完成不等于问题已解决。需要回到原任务重新挑战，才能根据新表现更新状态与画像。</p>
        </section>
        <section className="rounded-xl border bg-white p-5">
          <h2 className="font-semibold">AI学习伙伴</h2>
          <p className="mt-2 text-sm text-slate-600">AI仅解释确定性评价、弱项和推荐原因，不修改分数、画像、误区状态或补练路径。</p>
          {feedback && (
            <p className="mt-3 whitespace-pre-wrap rounded bg-blue-50 p-3 text-sm leading-6 text-blue-950" aria-live="polite">
              {feedback}
            </p>
          )}
          <Button className="mt-4" variant="outline" onClick={() => void askMentor()}>
            <Sparkles className="mr-2 size-4" />
            请AI解释学习建议
          </Button>
          <div className="mt-5 border-t pt-4">
            <h3 className="font-medium">学习增值</h3>
            {completedSessions.length >= 2 ? (
              <p className="mt-2 text-sm text-slate-700">
                得分变化{' '}
                {profile.virtualLab.scoreChange !== null && profile.virtualLab.scoreChange >= 0
                  ? '+'
                  : ''}
                {profile.virtualLab.scoreChange ?? '—'}；综合实训用时变化{' '}
                {profile.virtualLab.durationChangeSeconds ?? '—'} 秒；提示变化{' '}
                {profile.virtualLab.hintsChange ?? '—'} 次。
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                完成至少两次综合实训后显示学习增值比较。
              </p>
            )}
            <Button asChild className="mt-4">
              <Link
                href={`/zhiban/student/courses/${courseId}/learning-center/station-06-virtual-lab`}
              >
                <RefreshCw className="mr-2 size-4" />
                再次实训
              </Link>
            </Button>
          </div>
        </section>
      </div>}
    </main>
  );
}

export const LEARNING_CENTER_COURSE = COURSE_ID;
