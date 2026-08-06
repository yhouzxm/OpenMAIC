export const LEARNER_PROFILE_ALGORITHM_VERSION = 'zhiban-profile-v1';
export interface ProfileSignals {
  eventCount: number;
  activeDays: number;
  classroomProgress: number[];
  pblProgress: number[];
  scores: number[];
  submissionCount: number;
  collaborationCount: number;
  resourceCount: number;
}
const avg = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const cap = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
export function calculateLearnerProfile(s: ProfileSignals) {
  return {
    dimensions: {
      engagement: cap(s.activeDays * 8 + Math.min(40, s.eventCount)),
      completion: cap(avg([...s.classroomProgress, ...s.pblProgress])),
      achievement: cap(avg(s.scores)),
      collaboration: cap(s.collaborationCount * 12),
      selfDirection: cap(s.submissionCount * 10 + s.resourceCount * 4),
    },
    evidenceSummary: {
      eventCount: s.eventCount,
      activeDays: s.activeDays,
      classroomCount: s.classroomProgress.length,
      pblProjectCount: s.pblProgress.length,
      scoreEvidenceCount: s.scores.length,
      submissionCount: s.submissionCount,
      collaborationEventCount: s.collaborationCount,
      resourceEventCount: s.resourceCount,
    },
    algorithmVersion: LEARNER_PROFILE_ALGORITHM_VERSION,
  };
}
