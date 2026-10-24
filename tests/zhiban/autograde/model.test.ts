import { describe, it, expect } from 'vitest';
import {
  parseAutoResult,
  autoCommand,
  type AutoInput,
} from '../../../lib/zhiban/domain/autograde/model';
const input: AutoInput = {
  kind: 'QUIZ',
  title: '安全',
  rubric: '固定',
  provider: 'glm',
  model: 'glm-5.3',
  maxPoints: 1000,
  activityId: 'a',
  submissionId: 's',
  limits: [
    { id: 'o', type: 'single', question: '确认', maxPoints: 200 },
    { id: 's', type: 'short_answer', question: '步骤', maxPoints: 800 },
  ],
  objective: { o: 200 },
};
const model = { provider: input.provider, model: input.model, promptSha256: '1'.repeat(64) };
describe('formal AI closed result', () => {
  it('merges only fixed objective evidence and actual short-answer marks', () => {
    expect(parseAutoResult('{"marks":{"s":500},"feedback":"依据"}', input, model)).toEqual({
      marks: { o: 200, s: 500 },
      feedback: '依据',
      model,
    });
  });
  it.each([
    '{"marks":{"o":0,"s":500},"feedback":"试图覆盖"}',
    '{"marks":{"s":801},"feedback":"越界"}',
    '{"marks":{"s":0.1},"feedback":"单位错误"}',
    '{"marks":{},"feedback":"缺题"}',
    '{"marks":{"s":500},"feedback":"依据","actor":"teacher"}',
  ])('rejects untrusted result %s', (raw) => {
    expect(() => parseAutoResult(raw, input, model)).toThrow();
  });
  it('rejects client model/actor injection and unsupported commands', () => {
    expect(() => autoCommand({ type: 'PUBLISH', actor: 'teacher', score: 100 })).toThrow();
  });
});
