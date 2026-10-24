import { describe, it, expect } from 'vitest';
import { content, answers, type Content } from '../../../lib/zhiban/domain/quiz/model';
import {
  gradeQuiz,
  publicQuiz,
  algorithm,
  FILL_ALGORITHM,
} from '../../../lib/zhiban/domain/quiz/fill';
const quiz = (): Content => ({
  type: 'quiz',
  questions: [
    {
      id: 'f',
      type: 'fill_blank',
      question: '依次填写',
      points: 3.25,
      blanks: [
        { label: '术语', points: 1.25, accepted: ['PG', 'PostgreSQL'] },
        { label: '版本', points: 2, accepted: ['16'] },
      ],
      analysis: 'private',
    },
  ],
});
describe('trusted fill contract', () => {
  it('uses positional trimmed case-sensitive variants and cent-accurate partial scores', () => {
    const q = content(quiz(), true);
    for (const [a, score] of [
      [[' PG ', '16'], 3.25],
      [['PostgreSQL', '16'], 3.25],
      [['pg', '16'], 2],
      [['16', 'PG'], 0],
      [['', ''], 0],
      [['PG', '016'], 1.25],
    ] as const)
      expect(gradeQuiz(q.questions, answers({ f: [...a] }, q.questions))[0].earned).toBe(score);
    expect(algorithm(q.questions)).toBe(FILL_ALGORITHM);
    expect(algorithm([])).toBe('zhiban-quiz-1');
  });
  it('projects only labels and points, never accepted variants/analysis', () => {
    const p = JSON.stringify(publicQuiz(quiz().questions));
    for (const secret of ['accepted', 'PostgreSQL', 'analysis', 'private'])
      expect(p).not.toContain(secret);
  });
  it('rejects malformed authoring, mismatched totals, empty/duplicate normalized keys', () => {
    for (const mutate of [
      (q: Content) => (q.questions[0].blanks = []),
      (q: Content) => {
        q.questions[0].points = 4;
      },
      (q: Content) => (q.questions[0].blanks![0].accepted = ['PG', ' PG ']),
      (q: Content) => (q.questions[0].blanks![0].accepted = [' ']),
      (q: Content) => (q.questions[0].blanks![0].accepted = []),
    ]) {
      const q = quiz();
      mutate(q);
      expect(() => content(q, true)).toThrow();
    }
  });
  it('rejects forged keys, wrong arity, non-text and overlong values; absent question is unanswered', () => {
    const q = quiz();
    for (const a of [
      { f: 'PG' },
      { f: ['PG'] },
      { f: ['PG', '16', 'extra'] },
      { f: [{}, '16'] },
      { f: ['x'.repeat(201), '16'] },
      { other: ['PG', '16'] },
    ])
      expect(() => answers(a, q.questions)).toThrow();
    expect(answers({}, q.questions)).toEqual({ f: ['', ''] });
  });
});
