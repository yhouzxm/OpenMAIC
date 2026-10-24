import { describe, it, expect } from 'vitest';
import { content, answers, canonical, quizCommand } from '../../../lib/zhiban/domain/quiz/model';
import {
  gradeChoiceQuestions,
  publicQuestions,
  normalizeQuizContent,
  validateQuizContent,
} from '@openmaic/dsl/quiz';
const quiz = () => ({
  type: 'quiz' as const,
  questions: [
    {
      id: 'q',
      type: 'multiple' as const,
      question: '准备事项',
      options: [
        { value: 'A', label: '断电' },
        { value: 'B', label: '带电' },
        { value: 'C', label: '确认隔离' },
      ],
      answer: ['A', 'C'],
      analysis: '维护前断电隔离',
      commentPrompt: 'private',
      points: 1.25,
    },
  ],
});
describe('trusted Quiz host contract', () => {
  it('student projection contains no key, analysis or grading prompt', () => {
    expect(publicQuestions(quiz().questions)).toEqual([
      {
        id: 'q',
        type: 'multiple',
        question: '准备事项',
        points: 1.25,
        options: quiz().questions[0].options,
      },
    ]);
  });
  it('uses exact unordered matching without partial credit or learner-label aliases', () => {
    const q = quiz();
    expect(gradeChoiceQuestions(q.questions, { q: ['C', 'A'] })[0].earned).toBe(1.25);
    for (const a of [['A'], ['A', 'A'], ['断电', '确认隔离'], ['A', 'B', 'C']])
      expect(gradeChoiceQuestions(q.questions, { q: a })[0].earned).toBe(0);
  });
  it('rejects duplicate/unknown answers before storing', () => {
    expect(() => answers({ q: ['A', 'A'] }, quiz().questions)).toThrow();
    expect(() => answers({ q: ['D'] }, quiz().questions)).toThrow();
    expect(() => answers({ foreign: 'A' }, quiz().questions)).toThrow();
  });
  it('keeps an empty choice unanswered rather than accidentally grading it correct', () => {
    expect(answers({}, quiz().questions)).toEqual({ q: [] });
    expect(gradeChoiceQuestions(quiz().questions, { q: [] })[0].earned).toBe(0);
  });
  it('allows incomplete draft but refuses its publication', () => {
    expect(() => content({ type: 'quiz', questions: [] }, false)).not.toThrow();
    expect(() => content({ type: 'quiz', questions: [] }, true)).toThrow();
    const q = quiz();
    q.questions[0].answer = [];
    expect(() => content(q, true)).toThrow();
  });
  it('requires canonical new answer keys while supporting explicit upstream legacy normalization', () => {
    const q = quiz();
    q.questions[0].answer = ['断电'];
    expect(() => content(q, true)).toThrow();
    expect(normalizeQuizContent(q).questions[0].answer).toEqual(['A']);
  });
  it('bounds score precision, finite values and total', () => {
    for (const points of [0, -1, NaN, Infinity, 0.001, 1001]) {
      const q = quiz();
      q.questions[0].points = points;
      expect(() => content(q, true)).toThrow();
    }
  });
  it('rejects unknown fields and browser-supplied scores', () => {
    expect(() =>
      quizCommand({
        type: 'SUBMIT_QUIZ',
        attemptId: '01a14a50-4a7b-7058-a532-b85b3f1d51e2',
        revision: '1',
        answers: {},
        score: 100,
      }),
    ).toThrow();
  });
  it('hash encoding is stable across object insertion order', () => {
    expect(canonical({ b: 2, a: { y: 1, x: 0 } })).toBe(canonical({ a: { x: 0, y: 1 }, b: 2 }));
  });
  it('supports authoring hints without mutating teacher content', () => {
    const q = quiz();
    const before = JSON.stringify(q);
    expect(validateQuizContent(q)).toEqual([]);
    expect(JSON.stringify(q)).toBe(before);
  });
});
