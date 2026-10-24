import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import {
  activitySelection,
  summarize,
  type AnalyticsStudent,
} from '@/lib/zhiban/application/analytics/service';
it('requires an exact activity/version pair and canonical integer versions', () => {
  const id = v7();
  expect(activitySelection({})).toBeNull();
  expect(activitySelection({ activityId: id, version: '1' })).toEqual({
    activityId: id,
    version: 1,
  });
  const invalid: Record<string, string>[] = [
    { activityId: id },
    { version: '1' },
    { activityId: id, version: '01' },
    { activityId: id, version: '1e0' },
    { activityId: id, version: '2147483648' },
    { activityId: id, version: '1', teacher: 'true' },
  ];
  for (const input of invalid) expect(() => activitySelection(input)).toThrow('INVALID_INPUT');
});
it('uses individual score ratios and excludes unpublished scores; no selected activity has no activity metrics', () => {
  const row: AnalyticsStudent = {
    membershipId: v7(),
    displayName: null,
    attemptNo: 1,
    submissionVersion: 1,
    submittedAt: 1,
    gradeVersion: 1,
    scorePoints: 8000,
    maxPoints: 10000,
  };
  const students = [
    row,
    { ...row, membershipId: v7(), scorePoints: 1000, maxPoints: 2000 },
    { ...row, membershipId: v7(), gradeVersion: null, scorePoints: null, maxPoints: null },
  ];
  expect(summarize(students, 2, true)).toMatchObject({
    enrolled: 3,
    submitted: 3,
    graded: 2,
    awaitingGrade: 1,
    averagePercent: 65,
  });
  expect(summarize(students, 0, false)).toMatchObject({
    enrolled: 3,
    submitted: null,
    graded: null,
    averagePercent: null,
  });
  expect(summarize([], 1, true).averagePercent).toBeNull();
});
