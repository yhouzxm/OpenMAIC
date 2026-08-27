'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, CheckCircle2, RefreshCw, Send, Sparkles, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import {
  DIAGNOSIS_METHOD_STEPS,
  DIAGNOSIS_SCENARIOS,
  evaluateM08,
  type ConceptErrorCode,
  type DiagnosisScenarioType,
  type LearningCenterProfile,
  type LearningCenterProgress,
  type LearningEventInput,
} from '@/lib/zhiban/learning-center';
import { attachClassroomSceneContext } from '@/lib/zhiban/classroom/client-scene-context';
import { evaluateSignalTraceChoice, SIGNAL_TRACE_PATH } from '@/lib/zhiban/classroom/signal-trace-challenge';
import type { PersistedVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence/types';
import { SmartRemediationCard } from '@/components/zhiban/smart-remediation-card';
import {
  resolveRemediationScene,
  type RemediationRecommendation,
} from '@/lib/zhiban/scene-orchestration';

const COURSE_ID = 'mech-mechatronics-system';
const dimensionLabels = {
  systemUnderstanding: '系统机理理解',
  sensorDetection: '传感检测能力',
  plcSignalAnalysis: 'PLC信号分析',
  toolMeasurement: '工具检测能力',
  evidenceReasoning: '证据推理能力',
  faultDiagnosisVerification: '故障诊断与验证',
} as const;

async function postLearningEvent(courseId: string, event: LearningEventInput) {
  const contextualEvent = attachClassroomSceneContext({
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
  const response = await fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(contextualEvent),
  });
  if (!response.ok) throw new Error('event persistence failed');
}

function elapsedSince(startedAt: number) {
  return Date.now() - startedAt;
}

function Header({
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

export function DiagnosisLearningStation({ courseId }: { courseId: string }) {
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
  const startedAt = useRef(0);
  const completionSent = useRef(false);
  const [challengeRemaining, setChallengeRemaining] = useState(60);
  const [challengeRunning, setChallengeRunning] = useState(false);
  const [challengeAttempts, setChallengeAttempts] = useState(0);
  const [challengeMessage, setChallengeMessage] = useState('');
  const challengeStartedAt = useRef(0);
  const challengeFirstChoice = useRef<string | null>(null);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
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
    async (event: LearningEventInput) => {
      try {
        await postLearningEvent(courseId, event);
      } catch {
        setSyncWarning('学习记录暂未同步，不影响本次学习。');
      }
    },
    [courseId],
  );
  const scenario = useMemo(
    () => DIAGNOSIS_SCENARIOS.find((item) => item.id === scenarioId)!,
    [scenarioId],
  );
  const reveal = (kind: 'field' | 'input' | 'output') => {
    setObserved((current) => ({
      ...current,
      [scenarioId]: [...new Set([...(current[scenarioId] ?? []), kind])],
    }));
    void record({
      stationId: 'station-05-diagnosis',
      knowledgePointId: 'K15',
      eventType: 'VIEW_DIAGNOSIS_SCENARIO',
      payload: { scenarioType: scenarioId, evidenceType: kind },
    });
  };
  const toggleEvidence = (value: string) => {
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
      payload: { scenarioType: scenarioId, evidence: value },
    });
  };
  const submit = () => {
    const evidence = selectedEvidence[scenarioId] ?? [];
    const result = evaluateM08(scenario, selectedLayers[scenarioId] ?? '', evidence);
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
      attempt: Object.keys(completedScenarios).length + 1,
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
      },
    });
    const sourceSceneId = scenario.id === 'sensing' ? 'S05-02' : scenario.id === 'control' ? 'S05-03' : 'S05-04';
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
  const ask = async () => {
    if (!question.trim() || aiBusy) return;
    setAiBusy(true);
    setAnswer('');
    void record({
      stationId: 'station-05-diagnosis',
      knowledgePointId: 'K15',
      eventType: 'REQUEST_AI_HELP',
      payload: { question, mode: 'cognitive_diagnosis', scenarioType: scenarioId, conceptErrors },
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
          }),
        },
      );
      const body = (await response.json()) as { message?: string; notice?: string };
      setAnswer(
        `${body.message ?? '请沿现场、输入、输出逐段比较。'}${body.notice ? `\n${body.notice}` : ''}`,
      );
    } catch {
      setAnswer('AI学习伙伴暂时繁忙，请沿现场状态、PLC输入、PLC输出逐段比较信号链。');
    } finally {
      setAiBusy(false);
      setQuestion('');
    }
  };
  const evidenceOptions = [
    ...new Set([...scenario.keyEvidence, 'power_24v', 'motor_stopped', 'plc_program_unknown']),
  ];
  const startChallenge = () => {
    challengeStartedAt.current = Date.now();
    challengeFirstChoice.current = null;
    setChallengeAttempts(0);
    setChallengeRemaining(60);
    setChallengeMessage('');
    setChallengeRunning(true);
  };
  const chooseChallengeNode = (selectedNode: string) => {
    if (!challengeRunning) return;
    const attempts = challengeAttempts + 1;
    setChallengeAttempts(attempts);
    challengeFirstChoice.current ??= selectedNode;
    const result = evaluateSignalTraceChoice(selectedNode);
    if (result.isCorrect) setChallengeRunning(false);
    setChallengeMessage(result.message);
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
  return (
    <main className="space-y-5" data-testid="learning-station-05">
      <Header
        courseId={courseId}
        badge="05 诊断训练"
        title="你能沿着信号链找到故障吗？"
        description="使用“察—查—测—断—验”组织证据，在三个轻量情境中判断故障优先层级。"
      />
      <section className="rounded-xl border bg-white p-5">
        <h2 className="font-semibold">K15 · 察—查—测—断—验</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          {DIAGNOSIS_METHOD_STEPS.map((step) => {
            const active = methodSteps.includes(step.id);
            return (
              <button
                key={step.id}
                type="button"
                onClick={() =>
                  setMethodSteps((current) =>
                    current.includes(step.id) ? current : [...current, step.id],
                  )
                }
                className={`rounded-xl border p-4 text-left ${active ? 'border-emerald-400 bg-emerald-50' : 'bg-slate-50'}`}
              >
                <b className="text-xl text-blue-700">{step.label}</b>
                <p className="mt-2 text-sm text-slate-600">{step.description}</p>
                {active && <CheckCircle2 className="mt-2 size-4 text-emerald-600" />}
              </button>
            );
          })}
        </div>
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
                    setScenarioId(item.id);
                    void record({
                      stationId: 'station-05-diagnosis',
                      knowledgePointId: 'K15',
                      eventType: 'VIEW_DIAGNOSIS_SCENARIO',
                      payload: { scenarioType: item.id },
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
                      variant={selectedLayers[scenarioId] === id ? 'default' : 'outline'}
                      onClick={() => {
                        setSelectedLayers((current) => ({ ...current, [scenarioId]: id }));
                        void record({
                          stationId: 'station-05-diagnosis',
                          knowledgePointId: 'K15',
                          eventType: 'SELECT_DIAGNOSIS_LAYER',
                          payload: { scenarioType: scenarioId, selectedLayer: id },
                        });
                      }}
                    >
                      {label}
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
                  onClick={submit}
                >
                  提交本情境诊断
                </Button>
                {messages[scenarioId] && (
                  <p className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-950">
                    {messages[scenarioId]}
                  </p>
                )}
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
                <p key={item.id} className="flex justify-between">
                  <span>{item.title}</span>
                  <b>{completedScenarios[item.id] ? '已完成' : '未完成'}</b>
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
            <h2 className="flex items-center gap-2 font-semibold"><Timer className="size-5 text-cyan-700" />S05-04 · 60秒信号追踪挑战</h2>
            <p className="mt-1 text-sm text-slate-600">状态：S2 ON → I0.2 ON → PLC逻辑成立 → Q0.1 ON → 电磁阀得电，但气缸未动作。请选择第一个状态矛盾节点。</p>
          </div>
          <Button onClick={startChallenge}>{challengeRunning ? `剩余 ${challengeRemaining}s` : '开始挑战'}</Button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[['S2', 'S2'], ['I0.2', 'I0.2'], ['PLC Logic', 'PLC Logic'], ['Q0.1', 'Q0.1'], ['solenoid_valve', '电磁阀'], ['cylinder', '气缸']].map(([id, label]) => (
            <button key={id} type="button" disabled={!challengeRunning} onClick={() => chooseChallengeNode(id)} className="rounded-lg border bg-white px-3 py-4 text-sm font-medium disabled:opacity-60">{label}</button>
          ))}
        </div>
        {challengeMessage && <p className="mt-3 rounded-md bg-white p-3 text-sm text-slate-700">{challengeMessage}</p>}
      </section>
    </main>
  );
}

export function AssessmentLearningStation({ courseId }: { courseId: string }) {
  const [progress, setProgress] = useState<LearningCenterProgress>();
  const [profile, setProfile] = useState<LearningCenterProfile>();
  const [sessions, setSessions] = useState<PersistedVirtualLabSession[]>([]);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const completionSent = useRef(false);
  useEffect(() => {
    const load = async () => {
      const endpoint = `/api/zhiban/student/courses/${courseId}/learning-center`;
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('load');
      if (!completionSent.current) {
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
      };
      setProgress(body.progress);
      setProfile(body.profile);
      setSessions(body.sessions);
    };
    void load()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [courseId]);
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
  const askMentor = async () => {
    if (!profile) return;
    setFeedback('');
    void postLearningEvent(courseId, {
      stationId: 'station-07-assessment',
      eventType: 'REQUEST_AI_HELP',
      payload: { mode: 'assessment_mentor' },
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
          }),
        },
      );
      const body = (await response.json()) as { message?: string; notice?: string };
      setFeedback(
        `${body.message ?? '请优先回学最低维度对应的学习站。'}${body.notice ? `\n${body.notice}` : ''}`,
      );
    } catch {
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
  return (
    <main className="space-y-5" data-testid="learning-station-07">
      <Header
        courseId={courseId}
        badge="07 评价提升"
        title="我哪里会了，哪里还需要加强？"
        description="六维分数由知识站事件与真实 Virtual Lab Assessment 确定性聚合，AI只解释结果。"
      />
      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border bg-white p-5">
          <p className="text-sm text-slate-500">总体学习进度</p>
          <b className="mt-2 block text-3xl text-blue-700">{profile.overallProgress}%</b>
        </div>
        <div className="rounded-xl border bg-white p-5">
          <p className="text-sm text-slate-500">已完成Station</p>
          <b className="mt-2 block text-3xl text-blue-700">
            {Object.values(progress.stations).filter((item) => item.status === 'completed').length}
            /7
          </b>
        </div>
        <div className="rounded-xl border bg-white p-5">
          <p className="text-sm text-slate-500">Virtual Lab尝试</p>
          <b className="mt-2 block text-3xl text-blue-700">{profile.virtualLab.attempts}</b>
        </div>
        <div className="rounded-xl border bg-white p-5">
          <p className="text-sm text-slate-500">最近实训得分</p>
          <b className="mt-2 block text-3xl text-blue-700">
            {profile.virtualLab.latestScore ?? '—'}
          </b>
        </div>
      </section>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="font-semibold">7个学习站完成情况</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {Object.values(progress.stations).map((station, index) => (
            <div key={station.stationId} className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span>
                  {station.status === 'completed'
                    ? '已完成'
                    : station.status === 'in_progress'
                      ? '学习中'
                      : '未开始'}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200">
                <div
                  className="h-full bg-blue-600"
                  style={{ width: `${station.progressPercent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="font-semibold">课件级六维能力画像</h2>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {Object.entries(profile.dimensions).map(([key, item]) => (
            <article key={key}>
              <div className="flex justify-between text-sm">
                <b>{dimensionLabels[key as keyof typeof dimensionLabels]}</b>
                <strong>{item.score}</strong>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded bg-gradient-to-r from-blue-600 to-cyan-500"
                  style={{ width: `${item.score}%` }}
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                证据 {item.evidenceCount} 项 · 来源：{item.sources.join('、') || '尚无数据'}。
                {item.reason}
              </p>
            </article>
          ))}
        </div>
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-5">
          <h2 className="font-semibold">概念误区与精准补救</h2>
          {profile.conceptErrors.length ? (
            <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">
              已识别 {profile.conceptErrors.length} 类待补强概念；系统只推荐当前优先级最高的一项。
            </p>
          ) : (
            <p className="mt-3 text-sm text-slate-500">当前没有已记录的结构化概念误区。</p>
          )}
          {assessmentRemediation && (
            <div className="mt-4">
              <SmartRemediationCard courseId={courseId} recommendation={assessmentRemediation} />
            </div>
          )}
        </section>
        <section className="rounded-xl border bg-white p-5">
          <h2 className="font-semibold">AI学习伙伴</h2>
          <p className="mt-2 text-sm text-slate-600">AI仅解释确定性画像和推荐，不修改分数。</p>
          {feedback && (
            <p className="mt-3 whitespace-pre-wrap rounded bg-blue-50 p-3 text-sm leading-6 text-blue-950">
              {feedback}
            </p>
          )}
          <Button className="mt-4" variant="outline" onClick={() => void askMentor()}>
            <Sparkles className="mr-2 size-4" />
            生成学习建议
          </Button>
          <div className="mt-5 border-t pt-4">
            <h3 className="font-medium">学习增值</h3>
            {completedSessions.length >= 2 ? (
              <p className="mt-2 text-sm text-slate-700">
                得分变化{' '}
                {profile.virtualLab.scoreChange !== null && profile.virtualLab.scoreChange >= 0
                  ? '+'
                  : ''}
                {profile.virtualLab.scoreChange ?? '—'}；用时变化{' '}
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
      </div>
    </main>
  );
}

export const LEARNING_CENTER_COURSE = COURSE_ID;
