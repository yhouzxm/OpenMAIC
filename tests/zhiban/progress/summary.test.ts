import { expect, it } from 'vitest';
import {
  personalSummary,
  type PersonalActivity,
  type PersonalAttempt,
} from '@/lib/zhiban/application/progress/service';
it('shows null average for no published grades, including empty or unstarted activities', () => {
  expect(personalSummary([])).toEqual({
    activities: 0,
    started: 0,
    submitted: 0,
    notSubmitted: 0,
    graded: 0,
    awaitingGrade: 0,
    averagePercent: null,
  });
  expect(
    personalSummary([
      { id: 'activity', version: 1, title: '活动', deadlineAt: null, latest: null },
    ]),
  ).toMatchObject({ activities: 1, notSubmitted: 1, averagePercent: null });
});
it('counts each current activity once and averages published score ratios instead of raw points', () => {
  const attempt: PersonalAttempt = {
    id: 'attempt',
    activityId: 'activity',
    activityVersion: 1,
    title: '活动',
    attemptNo: 2,
    submissionVersion: 1,
    submittedAt: 1,
    gradeVersion: 1,
    scorePoints: 8000,
    maxPoints: 10000,
    feedback: '已发布',
    correctionReason: null,
    publishedAt: 1,
  };
  const activities: PersonalActivity[] = [
    { id: 'a', version: 1, title: '活动A', deadlineAt: null, latest: attempt },
    {
      id: 'b',
      version: 1,
      title: '活动B',
      deadlineAt: null,
      latest: { ...attempt, scorePoints: 1000, maxPoints: 2000 },
    },
    {
      id: 'c',
      version: 1,
      title: '活动C',
      deadlineAt: null,
      latest: {
        ...attempt,
        gradeVersion: null,
        scorePoints: null,
        maxPoints: null,
        feedback: null,
        publishedAt: null,
      },
    },
  ];
  expect(personalSummary(activities)).toEqual({
    activities: 3,
    started: 3,
    submitted: 3,
    notSubmitted: 0,
    graded: 2,
    awaitingGrade: 1,
    averagePercent: 65,
  });
});
