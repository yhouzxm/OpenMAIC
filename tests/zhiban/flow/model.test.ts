import { describe, it, expect } from 'vitest';
import { v7 } from 'uuid';
import {
  flowCommand,
  flowDigest,
  flowSteps,
  labValues,
  labReportText,
  type FlowStep,
} from '../../../lib/zhiban/domain/flow/model';
const target = v7(),
  classroom = v7(),
  stepId = '41726018-b265-4d14-a301-8ab8b15d3507';
const spec = {
  instructions: '比较设置与测量结果',
  parameters: [{ key: 'voltage', label: '电压', unit: 'V', min: 0, max: 24, initial: 6 }],
  measurements: [{ key: 'current', label: '电流', unit: 'A', min: 0, max: 5, initial: 0 }],
  conclusionPrompt: '说明测量结果和误差。',
};
const step: FlowStep = {
  id: stepId,
  title: '实验',
  kind: 'LAB',
  target,
  version: '1',
  interactiveId: null,
  publicationId: null,
  requires: [],
  lab: spec,
};
describe('published classroom orchestration and learner-reported lab boundary', () => {
  it('accepts independent native scene IDs while retaining UUIDv7 authority locators', () => {
    expect(flowSteps([step])[0].id).toBe(stepId);
    expect(
      flowCommand({ type: 'SAVE_PLAN', classroomId: classroom, revision: '0', steps: [step] }),
    ).toMatchObject({ revision: '0' });
    expect(() => flowSteps([{ ...step, target: stepId }])).toThrow();
    expect(() =>
      flowCommand({
        type: 'START_FLOW',
        classroomId: classroom,
        planVersion: '1',
        classroomRevision: '2',
        serviceActor: 'forged',
      }),
    ).toThrow();
  });
  it('rejects forward/cyclic prerequisites, lecture completion and repeated activity reuse', () => {
    const before = { ...step, id: v7(), requires: [] },
      after = {
        ...step,
        id: v7(),
        target: v7(),
        requires: [{ stepId: before.id, kind: 'SUBMITTED', percent: null }],
      };
    expect(flowSteps([before, after])).toHaveLength(2);
    expect(() => flowSteps([after, before])).toThrow();
    expect(() => flowSteps([before, { ...after, target: before.target }])).toThrow();
    expect(() =>
      flowSteps([{ ...before, kind: 'LECTURE', lab: null, publicationId: v7() }, after]),
    ).toThrow();
  });
  it('rejects forged trusted events, native grades and unbounded measurement payloads', () => {
    expect(() =>
      flowCommand({
        type: 'SAVE_LAB',
        id: v7(),
        revision: '1',
        attemptRevision: '1',
        parameters: { voltage: 6 },
        rows: [],
        conclusion: '',
        source: 'NATIVE',
      }),
    ).toThrow();
    for (const bad of [NaN, Infinity, 25])
      expect(() =>
        labValues({ parameters: { voltage: bad }, rows: [], conclusion: '' }, spec),
      ).toThrow();
    expect(() =>
      labValues(
        {
          parameters: { voltage: 6 },
          rows: [{ values: { current: 6 }, note: '' }],
          conclusion: '测量结果',
        },
        spec,
        true,
      ),
    ).toThrow();
    expect(() =>
      labValues(
        {
          parameters: { voltage: 6 },
          rows: [{ values: { other: 1 }, note: '' }],
          conclusion: '测量结果',
        },
        spec,
        true,
      ),
    ).toThrow();
    expect(() =>
      labValues({ parameters: { voltage: 6 }, rows: [], conclusion: '测量结果' }, spec, true),
    ).toThrow();
  });
  it('produces an original submission with a fixed report locator and honest source', () => {
    const id = v7(),
      values = labValues(
        {
          parameters: { voltage: 6 },
          rows: [{ values: { current: 0.3 }, note: '手动读取' }],
          conclusion: '说明测量依据',
        },
        spec,
        true,
      );
    const answer = labReportText(step, values, id);
    expect(flowDigest({ a: 1, b: { x: 2, y: 3 } })).toBe(flowDigest({ b: { y: 3, x: 2 }, a: 1 }));
    expect(answer).toContain(id);
    expect(answer).toContain('学生手动记录');
    expect(answer).toContain('非 Native');
    expect(answer.length).toBeLessThanOrEqual(4000);
    expect(() =>
      flowCommand({ type: 'CANCEL_FLOW', classroomId: classroom, revision: '1', reason: '' }),
    ).toThrow();
  });
});
