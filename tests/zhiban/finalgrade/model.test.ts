import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { weights, weightedPoints, finalGradeCommand } from '@/lib/zhiban/domain/finalgrade/model';
const a = v7(),
  b = v7();
it('requires explicit 100% unique positive fixed-version activity weights', () => {
  expect(
    weights([
      { activityId: a, version: 1, weightBps: 6000 },
      { activityId: b, version: 2, weightBps: 4000 },
    ]),
  ).toHaveLength(2);
  for (const rows of [
    [],
    [{ activityId: a, version: 1, weightBps: 9999 }],
    [
      { activityId: a, version: 1, weightBps: 5000 },
      { activityId: a, version: 1, weightBps: 5000 },
    ],
    [{ activityId: a, version: 0, weightBps: 10000 }],
    [{ activityId: a, version: 1, weightBps: 10000, teacher: true }],
  ])
    expect(() => weights(rows)).toThrow();
});
it('normalizes each official score ratio and rounds exactly once without zero-filling', () => {
  expect(
    weightedPoints([
      { score: 80, maximum: 100, weightBps: 6000 },
      { score: 10, maximum: 20, weightBps: 4000 },
    ]),
  ).toBe(6800);
  expect(
    weightedPoints([
      { score: 1, maximum: 3, weightBps: 5000 },
      { score: 2, maximum: 3, weightBps: 5000 },
    ]),
  ).toBe(5000);
  expect(weightedPoints([{ score: 1, maximum: 32, weightBps: 10000 }])).toBe(313);
  expect(() => weightedPoints([{ score: 0, maximum: 0, weightBps: 10000 }])).toThrow();
  expect(() => weightedPoints([{ score: 10, maximum: 20, weightBps: 6000 }])).toThrow();
});
it('rejects client scores, forged identity, empty explanations and malformed concurrency inputs', () => {
  const c = {
    type: 'PUBLISH_TOTAL',
    memberId: a,
    sourceDigest: 'a'.repeat(64),
    previousId: null,
    reason: '首发',
  };
  expect(finalGradeCommand(c)).toEqual(c);
  for (const v of [
    { ...c, score: 99 },
    { ...c, reason: '' },
    { ...c, previousId: 'x' },
    { type: 'OPEN_APPEAL', publicationId: a, body: '核对权重', memberId: b },
    {
      type: 'RESOLVE_APPEAL',
      id: a,
      memberId: b,
      revision: '0',
      decision: 'EXPLAINED',
      body: '说明',
    },
  ])
    expect(() => finalGradeCommand(v)).toThrow();
});
