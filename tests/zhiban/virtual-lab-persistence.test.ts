import { describe, expect, it } from 'vitest';
import { calculateAssessment } from '@/lib/zhiban/virtual-lab/assessment';
import { buildTrainingContext } from '@/lib/zhiban/virtual-lab/ai/context';
import { buildTeacherVirtualLabAnalytics, buildVirtualLabLearningProfile, makeHistorySummary } from '@/lib/zhiban/virtual-lab/persistence';
import type { PersistedVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence/types';
import { getMechLabActivity, MECH_LAB_ACTIVITY_ID, MECH_LAB_SAMPLE_COURSE_ID } from '@/lib/zhiban/virtual-lab/registry';

const activity = getMechLabActivity(MECH_LAB_SAMPLE_COURSE_ID, MECH_LAB_ACTIVITY_ID)!;
const actions = ['OPEN_PLC_MONITOR', 'INSPECT_COMPONENT', 'MEASURE_SENSOR_POWER', 'MEASURE_SENSOR_OUTPUT', 'SUBMIT_DIAGNOSIS', 'REPLACE_COMPONENT', 'RESTART_MACHINE'].map((action, index) => ({ action, timestamp: `2026-08-23T12:00:0${index}.000Z`, phase: 'inspection', ...(action === 'SUBMIT_DIAGNOSIS' ? { value: 'S2_OUTPUT_ABNORMAL' } : {}) }));
const context = buildTrainingContext({ activity, actions, snapshot: { phase: 'completed', operationalPhase: 'completed', workpiece: { detectedByS1: true, detectedByS2: true, position: { x: 1, y: 1, z: 1 } }, sensors: { s1: false, s2: true, s2Powered: true, s2Output: true, s2Faulty: false }, motor: false, conveyor: false, cylinder: false, plc: { inputs: { s1: false, s2: true }, outputs: { motor: false, cylinder: false } }, training: { measurements: { s2Power: 24, s2Output: 0 }, repaired: true, verificationPassed: true } } });
const assessment = calculateAssessment({ trainingContext: context, attemptNumber: 1, durationSeconds: 120 });
function session(overrides: Partial<PersistedVirtualLabSession & { userId: string; name: string }> = {}) {
  return { id: 'session-1', userId: 'student-1', name: '学生甲', courseId: activity.courseId, chapterId: activity.chapterId, activityId: activity.activityId, scenarioId: activity.scenarioId, attemptNumber: 1, status: 'completed' as const, startedAt: '2026-08-23T12:00:00.000Z', completedAt: '2026-08-23T12:02:00.000Z', durationSeconds: 120, overallScore: assessment.overallScore, assessment, hintsUsed: 0, wrongActions: [], actionsCount: actions.length, verificationPassed: true, ...overrides } as PersistedVirtualLabSession & { userId: string; name: string };
}

describe('Virtual Lab persistence data logic', () => {
  it('keeps an ordered attempt history and derives learner summary values', () => {
    const first = session({ attemptNumber: 1, overallScore: 78, durationSeconds: 210 });
    const second = session({ id: 'session-2', attemptNumber: 2, overallScore: 92, durationSeconds: 130 });
    expect(makeHistorySummary([second, first])).toMatchObject({ attempts: 2, highestScore: 92, latestScore: 92, bestDurationSeconds: 130 });
  });

  it('updates abilities with an explainable weighted Virtual Lab source', () => {
    const profile = buildVirtualLabLearningProfile({ sensorKnowledgeMastery: 50, plcKnowledgeMastery: 50 }, assessment, 2);
    expect(profile.sensorKnowledgeMastery).toBeGreaterThan(50);
    expect(profile.plcKnowledgeMastery).toBeGreaterThan(50);
    expect(profile.previousVirtualLabPerformance).toMatchObject({ source: 'Virtual Lab 实训 Assessment', completedAttempts: 2 });
  });

  it('returns no fabricated aggregates when there are no sessions', () => {
    const analytics = buildTeacherVirtualLabAnalytics([]);
    expect(analytics.metrics.participatingStudents).toBe(0);
    expect(analytics.metrics.completionRate).toBeNull();
    expect(analytics.errorPatterns).toEqual([]);
  });

  it('calculates course metrics and error-pattern percentages from completed records', () => {
    const weak = session({ id: 'weak', userId: 'student-2', assessment: { ...assessment, errorPatterns: ['SKIP_PLC_INSPECTION', 'SKIP_OUTPUT_MEASUREMENT'] } });
    const analytics = buildTeacherVirtualLabAnalytics([session(), weak]);
    expect(analytics.metrics.participatingStudents).toBe(2);
    expect(analytics.metrics.completedStudents).toBe(2);
    expect(analytics.metrics.averageScore).toBe(assessment.overallScore);
    expect(analytics.errorPatterns).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SKIP_PLC_INSPECTION', percent: 50 })]));
    expect(analytics.interventions).toContain('建议加强现场设备状态与 PLC I/O 对应关系训练。');
  });

  it('does not treat an unfinished session as completed performance', () => {
    const history = makeHistorySummary([session({ status: 'in_progress', completedAt: null, overallScore: null, assessment: null, durationSeconds: null })]);
    expect(history.highestScore).toBeNull();
    expect(history.latestScore).toBeNull();
  });
});
