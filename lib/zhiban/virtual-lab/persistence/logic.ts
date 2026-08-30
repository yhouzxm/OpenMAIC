import type { VirtualLabAssessment } from '../assessment';
import type { VirtualLabLearningProfile } from '../ai/types';
import type { PersistedVirtualLabSession, TeacherVirtualLabAnalytics } from './types';

const DIMENSIONS = [
  ['diagnosisAccuracy', '故障定位'],
  ['procedureQuality', '流程规范'],
  ['evidenceReasoning', '证据推理'],
  ['independence', '独立完成'],
  ['verification', '结果验证'],
] as const;

export function buildVirtualLabLearningProfile(
  previous: VirtualLabLearningProfile | null,
  assessment: VirtualLabAssessment,
  completedAttempts: number,
): VirtualLabLearningProfile {
  const percent = (key: keyof VirtualLabAssessment['dimensions']) => {
    const dimension = assessment.dimensions[key];
    return Math.round((dimension.score / dimension.maxScore) * 100);
  };
  const prior = (key: keyof VirtualLabLearningProfile) =>
    typeof previous?.[key] === 'number' ? Number(previous[key]) : null;
  const blend = (key: keyof VirtualLabLearningProfile, current: number) => {
    const value = prior(key);
    return value === null ? current : Math.round(value * 0.6 + current * 0.4);
  };
  return {
    sensorKnowledgeMastery: blend('sensorKnowledgeMastery', percent('evidenceReasoning')),
    plcKnowledgeMastery: blend(
      'plcKnowledgeMastery',
      Math.round((percent('diagnosisAccuracy') + percent('procedureQuality')) / 2),
    ),
    weakPoints: assessment.weakPoints.map((point) => point.knowledgePoint),
    previousVirtualLabPerformance: {
      source: 'Virtual Lab 实训 Assessment',
      completedAttempts,
      latestScore: assessment.overallScore,
      evidenceReasoning: percent('evidenceReasoning'),
      independence: percent('independence'),
      verification: percent('verification'),
    },
  };
}

export function makeHistorySummary(sessions: PersistedVirtualLabSession[]) {
  const completed = sessions.filter((item) => item.status === 'completed');
  return {
    attempts: sessions.length,
    highestScore: completed.length
      ? Math.max(...completed.map((item) => item.overallScore ?? 0))
      : null,
    latestScore: completed[0]?.overallScore ?? null,
    bestDurationSeconds: completed.length
      ? Math.min(...completed.map((item) => item.durationSeconds ?? Number.MAX_SAFE_INTEGER))
      : null,
    latestHintsUsed: completed[0]?.hintsUsed ?? null,
  };
}

export function buildTeacherVirtualLabAnalytics(
  sessions: PersistedVirtualLabSession[],
  enrolledLearnerIds?: string[],
): TeacherVirtualLabAnalytics {
  const completed = sessions.filter((item) => item.status === 'completed' && item.assessment);
  const latestCompletedByStudent = new Map<string, PersistedVirtualLabSession>();
  for (const session of completed) {
    const userId = (session as PersistedVirtualLabSession & { userId?: string }).userId;
    if (!userId) continue;
    const current = latestCompletedByStudent.get(userId);
    if (
      !current ||
      session.attemptNumber > current.attemptNumber ||
      (session.attemptNumber === current.attemptNumber &&
        (session.completedAt ?? '') > (current.completedAt ?? ''))
    )
      latestCompletedByStudent.set(userId, session);
  }
  const latestCompleted = [...latestCompletedByStudent.values()];
  const byStudent = new Map<string, PersistedVirtualLabSession[]>();
  for (const session of sessions) {
    const key = (session as PersistedVirtualLabSession & { userId?: string }).userId ?? '';
    if (!key) continue;
    byStudent.set(key, [...(byStudent.get(key) ?? []), session]);
  }
  const completedStudents = latestCompleted.length;
  const participatingStudents = sessions.length
    ? new Set(
        sessions.map((item) => (item as PersistedVirtualLabSession & { userId?: string }).userId),
      ).size
    : 0;
  const enrolledStudents = enrolledLearnerIds
    ? new Set(enrolledLearnerIds).size
    : participatingStudents;
  const affectedStudents = new Map<string, Set<string>>();
  latestCompleted.forEach((item) => {
    const userId = (item as PersistedVirtualLabSession & { userId?: string }).userId;
    if (!userId) return;
    item.assessment?.errorPatterns.forEach((code) => {
      const learners = affectedStudents.get(code) ?? new Set<string>();
      learners.add(userId);
      affectedStudents.set(code, learners);
    });
  });
  const errorPatterns = [...affectedStudents.entries()]
    .map(([code, learners]) => ({
      code,
      count: learners.size,
      percent: enrolledStudents ? Math.round((learners.size / enrolledStudents) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
  const dimensions = DIMENSIONS.map(([key, label]) => {
    const values = latestCompleted.map(
      (item) =>
        (item.assessment!.dimensions[key].score / item.assessment!.dimensions[key].maxScore) * 100,
    );
    return {
      key,
      label,
      average: values.length
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null,
    };
  });
  const interventions: string[] = [];
  const has = (code: string) => errorPatterns.find((item) => item.code === code)?.percent ?? 0;
  if (has('SKIP_OUTPUT_MEASUREMENT') >= 25)
    interventions.push('较多学习者未完成传感器输出测量，建议强化第3章传感器检测方法。');
  if (has('SKIP_PLC_INSPECTION') >= 25)
    interventions.push('建议加强现场设备状态与 PLC I/O 对应关系训练。');
  if (has('INSUFFICIENT_VERIFICATION') >= 25)
    interventions.push('建议在课堂中强调维修后重新启动和结果验证的规范流程。');
  return {
    metrics: {
      enrolledStudents,
      participatingStudents,
      completedStudents,
      completionRate: enrolledStudents
        ? Math.round((completedStudents / enrolledStudents) * 100)
        : null,
      averageScore: latestCompleted.length
        ? Math.round(
            latestCompleted.reduce((sum, item) => sum + (item.overallScore ?? 0), 0) /
              latestCompleted.length,
          )
        : null,
      averageDurationSeconds: latestCompleted.length
        ? Math.round(
            latestCompleted.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0) /
              latestCompleted.length,
          )
        : null,
      averageHintsUsed: latestCompleted.length
        ? Math.round(
            (latestCompleted.reduce((sum, item) => sum + item.hintsUsed, 0) /
              latestCompleted.length) *
              10,
          ) / 10
        : null,
    },
    students: [],
    errorPatterns,
    dimensions,
    interventions,
    knowledgeLearning: {
      enrolledStudents: 0,
      participatingStudents: 0,
      stationCompletion: [],
      dimensions: [],
      conceptErrors: [],
      interventions: [],
    },
  };
}
