import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { randomUUID } from 'node:crypto';
import {
  validateRules,
  publishedThreshold,
  type CompletionRule,
} from '@/lib/zhiban/domain/progress/rules';
import { curriculumCommand } from '@/lib/zhiban/domain/curriculum/model';
const rule = (patch: Partial<CompletionRule> = {}): CompletionRule => ({
  kind: 'SUBMITTED',
  version: 1,
  required: true,
  thresholdBps: 0,
  requires: [],
  ...patch,
});
const unit = (progress = rule()) => ({
  id: randomUUID(),
  title: '任务',
  kind: 'ACTIVITY' as const,
  target: v7(),
  progress,
});
it('defaults old outlines to free learning; configured rules survive normal strict outline parsing', () => {
  const a = unit(),
    b = unit(rule({ requires: [a.target], kind: 'PUBLISHED_GRADE', thresholdBps: 6000 }));
  expect(validateRules([{ kind: 'LECTURE', target: randomUUID() }]).size).toBe(0);
  const chapters = [{ id: randomUUID(), title: '章', units: [a, b] }];
  expect(curriculumCommand({ type: 'SAVE_OUTLINE', revision: '1', chapters })).toMatchObject({
    chapters,
  });
});
it('rejects self links, cycles, missing rules, duplicates and ambiguous activity repetitions', () => {
  const a = unit(),
    b = unit();
  for (const units of [
    [{ ...a, progress: rule({ requires: [a.target] }) }],
    [
      { ...a, progress: rule({ requires: [b.target] }) },
      { ...b, progress: rule({ requires: [a.target] }) },
    ],
    [{ ...a, progress: rule({ requires: [b.target] }) }],
    [{ ...a, progress: rule({ requires: [b.target, b.target] }) }, b],
    [a, { ...a, id: randomUUID(), progress: undefined }],
    [{ ...a, kind: 'LECTURE' }],
  ])
    expect(() => validateRules(units)).toThrow();
});
it('rejects forged keys, NULL, practice-like kinds, malformed versions and threshold bounds', () => {
  for (const patch of [
    { version: 0 },
    { version: 1.5 },
    { required: 'true' },
    { kind: 'READ' },
    { thresholdBps: 1 },
    { kind: 'PUBLISHED_GRADE', thresholdBps: 10001 },
    { kind: 'PUBLISHED_GRADE', thresholdBps: 0.1 },
    { extra: true },
    { requires: Array.from({ length: 9 }, () => randomUUID()) },
  ]) {
    const a = unit();
    Object.assign(a.progress, patch);
    expect(() => validateRules([a])).toThrow();
  }
  const a = unit();
  expect(() => validateRules([{ ...a, progress: null as unknown as CompletionRule }])).toThrow();
});
it('uses exact integer ratios on immutable published points; no rounding promotion or empty denominator', () => {
  expect(publishedThreshold(2, 3, 6667)).toBe(false);
  expect(publishedThreshold(2, 3, 6666)).toBe(true);
  expect(publishedThreshold(6000, 10000, 6000)).toBe(true);
  expect(publishedThreshold(0, 10000, 0)).toBe(true);
  for (const args of [
    [0, 0, 0],
    [10, 9, 0],
    [-1, 10, 0],
    [1, 10, 1.5],
    [1, 10, 10001],
    [1, 10, -1],
    [NaN, 10, 0],
  ])
    expect(() => publishedThreshold(...(args as [number, number, number]))).toThrow();
});
