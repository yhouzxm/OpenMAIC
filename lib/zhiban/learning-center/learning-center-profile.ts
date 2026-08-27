import type { PersistedVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence/types';
import { deriveLearningCenterProgress } from './progress';
import { CONCEPT_ERROR_STATION_MAP } from './diagnosis';
import {
  CONCEPT_ERROR_CODES,
  LEARNING_CENTER_DIMENSIONS,
  type ConceptErrorCode,
  type LearningCenterDimensionKey,
  type LearningCenterDimensionResult,
  type LearningCenterProfile,
  type LearningEvent,
  type StationId,
} from './types';
import { getScene } from '@/lib/zhiban/scene-orchestration/orchestrator';
import {
  deriveConceptErrorStates,
  resolveRemediationScene,
} from '@/lib/zhiban/scene-orchestration/remediation';

export const LEARNING_CENTER_PROFILE_WEIGHTS = {
  knowledge: 0.4,
  application: 0.6,
} as const;

const labels: Record<LearningCenterDimensionKey, string> = {
  systemUnderstanding: '系统机理理解',
  sensorDetection: '传感检测能力',
  plcSignalAnalysis: 'PLC信号分析',
  toolMeasurement: '工具检测能力',
  evidenceReasoning: '证据推理能力',
  faultDiagnosisVerification: '故障诊断与验证',
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function microScores(events: LearningEvent[], exercises: string[]) {
  return events
    .filter(
      (event) =>
        event.eventType === 'SUBMIT_MICRO_EXERCISE' &&
        exercises.includes(String(event.payload?.exercise ?? '')) &&
        typeof event.isCorrect === 'boolean',
    )
    .map((event) => (event.isCorrect ? 100 : 0));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function assessmentPercent(
  session: PersistedVirtualLabSession | undefined,
  keys: Array<'diagnosisAccuracy' | 'procedureQuality' | 'evidenceReasoning' | 'verification'>,
) {
  const assessment = session?.assessment;
  if (!assessment) return null;
  return average(
    keys.map((key) => {
      const item = assessment.dimensions[key];
      return (item.score / item.maxScore) * 100;
    }),
  );
}

function result(
  knowledgeValues: number[],
  applicationValue: number | null,
  sources: string[],
  reason: string,
): LearningCenterDimensionResult {
  const knowledge = average(knowledgeValues);
  const score =
    knowledge === null
      ? (applicationValue ?? 0)
      : applicationValue === null
        ? knowledge
        : knowledge * LEARNING_CENTER_PROFILE_WEIGHTS.knowledge +
          applicationValue * LEARNING_CENTER_PROFILE_WEIGHTS.application;
  return {
    score: clamp(score),
    evidenceCount: knowledgeValues.length + (applicationValue === null ? 0 : 1),
    sources,
    reason,
  };
}

export function extractConceptErrors(events: LearningEvent[]) {
  const counts = new Map<ConceptErrorCode, number>();
  for (const event of events) {
    const values = Array.isArray(event.payload?.conceptErrors) ? event.payload.conceptErrors : [];
    for (const value of values) {
      if (!(CONCEPT_ERROR_CODES as readonly unknown[]).includes(value)) continue;
      const code = value as ConceptErrorCode;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count, stationId: CONCEPT_ERROR_STATION_MAP[code] }))
    .sort((a, b) => b.count - a.count);
}

export function calculateLearningCenterProfile(
  courseId: string,
  events: LearningEvent[],
  sessions: PersistedVirtualLabSession[],
): LearningCenterProfile {
  const progress = deriveLearningCenterProgress(courseId, events);
  const completed = sessions.filter((item) => item.status === 'completed' && item.assessment);
  const latest = completed[0];
  const previous = completed[1];
  const stationCompletion = (ids: StationId[]) =>
    ids.map((id) => progress.stations[id].progressPercent);

  const dimensions = {
    systemUnderstanding: result(
      [
        ...stationCompletion(['station-01-system']),
        ...microScores(events, ['M01', 'M02', 'M07', 'K14-checkpoint']),
      ],
      assessmentPercent(latest, ['procedureQuality']),
      ['Station 01', 'Station 03', 'Station 04', ...(latest ? ['最近一次 Virtual Lab'] : [])],
      '由系统认知、控制/执行知识表现与实训流程规范性分层加权。',
    ),
    sensorDetection: result(
      microScores(events, ['M03', 'M04', 'M05']),
      assessmentPercent(latest, ['evidenceReasoning']),
      ['Station 02', ...(latest ? ['最近一次 Virtual Lab 证据行为'] : [])],
      '由感知站预测、测量和证据决策，以及实训证据表现分层加权。',
    ),
    plcSignalAnalysis: result(
      microScores(events, ['M05', 'M06', 'M07']),
      assessmentPercent(latest, ['procedureQuality', 'evidenceReasoning']),
      ['Station 02', 'Station 03', ...(latest ? ['最近一次 Virtual Lab PLC检查'] : [])],
      '由I/O映射、梯形图推演及实训PLC检查表现分层加权。',
    ),
    toolMeasurement: result(
      microScores(events, ['M04', 'M05']),
      assessmentPercent(latest, ['evidenceReasoning']),
      ['Station 02', ...(latest ? ['最近一次 Virtual Lab 万用表操作'] : [])],
      '由供电/输出测量判断与实训测量证据表现分层加权。',
    ),
    evidenceReasoning: result(
      microScores(events, ['M05', 'M08']),
      assessmentPercent(latest, ['evidenceReasoning']),
      ['Station 02', 'Station 05', ...(latest ? ['Virtual Lab evidenceReasoning'] : [])],
      '由知识情境证据选择与实训证据推理维度分层加权。',
    ),
    faultDiagnosisVerification: result(
      microScores(events, ['M08']),
      assessmentPercent(latest, ['diagnosisAccuracy', 'verification']),
      ['Station 05', ...(latest ? ['Virtual Lab diagnosisAccuracy/verification'] : [])],
      '由三层故障判断与实训定位、验证结果分层加权。',
    ),
  } satisfies Record<LearningCenterDimensionKey, LearningCenterDimensionResult>;

  const activeErrorCodes = new Set(
    deriveConceptErrorStates(events)
      .filter((item) => item.status === 'ACTIVE' || item.status === 'REOPENED')
      .map((item) => item.code),
  );
  const conceptErrors = extractConceptErrors(events).filter((item) => activeErrorCodes.has(item.code));
  const weakDimensions = LEARNING_CENTER_DIMENSIONS.filter((key) => dimensions[key].score < 75);
  const remediation = resolveRemediationScene({
    conceptErrors: conceptErrors.flatMap((item) => Array(item.count).fill(item.code)),
    currentSceneId: 'S06-02',
    stationId: 'station-07-assessment',
    learnerProfile: Object.fromEntries(
      LEARNING_CENTER_DIMENSIONS.map((key) => [key, dimensions[key].score]),
    ),
    attemptHistory: conceptErrors.map((item) => ({ code: item.code, count: item.count })),
    weakDimensions,
    currentCheckpoint: 'mech-lab-line-stop',
    contextMode: 'POST_ASSESSMENT',
  });
  const primaryDimension = weakDimensions[0] ?? 'evidenceReasoning';
  const recommendations: LearningCenterProfile['recommendations'] = remediation
    ? [{
        dimension: primaryDimension,
        stationId: getScene(remediation.sceneId)!.stationId,
        sceneId: remediation.sceneId,
        title: `补强${labels[primaryDimension]}`,
        reason: remediation.briefRationale,
        priority: remediation.priority === 'medium' ? 'medium' : 'high',
      }]
    : [];

  const dimensionEntries = Object.entries(dimensions) as Array<
    [LearningCenterDimensionKey, LearningCenterDimensionResult]
  >;
  return {
    overallProgress: Math.round(
      Object.values(progress.stations).reduce((sum, station) => sum + station.progressPercent, 0) /
        7,
    ),
    dimensions,
    conceptErrors,
    strengths: dimensionEntries
      .filter(([, value]) => value.score >= 80)
      .map(([key]) => labels[key]),
    weaknesses: dimensionEntries
      .filter(([, value]) => value.score < 60)
      .map(([key]) => labels[key]),
    recommendations,
    virtualLab: {
      latestScore: latest?.overallScore ?? null,
      attempts: completed.length,
      scoreChange:
        latest && previous && latest.overallScore !== null && previous.overallScore !== null
          ? Number(latest.overallScore) - Number(previous.overallScore)
          : null,
      durationChangeSeconds:
        latest && previous && latest.durationSeconds !== null && previous.durationSeconds !== null
          ? Number(latest.durationSeconds) - Number(previous.durationSeconds)
          : null,
      hintsChange: latest && previous ? latest.hintsUsed - previous.hintsUsed : null,
    },
  };
}
