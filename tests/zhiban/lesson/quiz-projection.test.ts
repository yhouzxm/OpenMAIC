import { describe, it, expect } from 'vitest';
import { quizProjection } from '../../../lib/zhiban/infrastructure/lesson/quiz-projection';
const doc = () => ({
  stage: { name: '安全测验' },
  scenes: [
    {
      type: 'quiz',
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'native',
            type: 'single',
            question: '先断电？',
            points: 2,
            options: [
              { value: 'A', label: '是' },
              { value: 'B', label: '否' },
            ],
            answer: ['是'],
            analysis: '先断电',
          },
        ],
      },
    },
  ],
});
describe('native Quiz projection', () => {
  it('reuses exact native key normalization and creates deterministic isolated question IDs', () => {
    const a = quizProjection('run1', doc()),
      b = quizProjection('run1', doc());
    expect(a).toEqual(b);
    expect(a.content.questions[0].answer).toEqual(['A']);
    expect(a.content.questions[0].id).not.toBe('native');
    expect(quizProjection('run2', doc()).content.questions[0].id).not.toBe(
      a.content.questions[0].id,
    );
  });
  it('binds all source bytes and refuses mixed or unsupported scenes/types and invalid answer keys', () => {
    const a = doc();
    const original = quizProjection('r', a);
    a.stage.name = '不同来源';
    expect(quizProjection('r', a).sourceHash).not.toBe(original.sourceHash);
    expect(() => quizProjection('r', null)).toThrow();
    const mixed = doc();
    mixed.scenes.push({ type: 'slide', content: mixed.scenes[0].content });
    expect(() => quizProjection('r', mixed)).toThrow();
    const invalid = doc();
    invalid.scenes[0].content.questions[0].answer = ['未知'];
    expect(() => quizProjection('r', invalid)).toThrow();
  });
});
