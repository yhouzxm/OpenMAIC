import { describe, expect, it } from 'vitest';
import { calculateLearnerProfile } from '@/lib/zhiban/profile';
describe('learner profile calculator', () => {
  it('is deterministic, bounded and evidence-backed', () => {
    const input = {
      eventCount: 12,
      activeDays: 3,
      classroomProgress: [80],
      pblProgress: [60],
      scores: [90, 70],
      submissionCount: 2,
      collaborationCount: 3,
      resourceCount: 4,
    };
    const a = calculateLearnerProfile(input);
    expect(a).toEqual(calculateLearnerProfile(input));
    expect(Object.values(a.dimensions).every((v) => v >= 0 && v <= 100)).toBe(true);
    expect(a.evidenceSummary.eventCount).toBe(12);
  });
});
