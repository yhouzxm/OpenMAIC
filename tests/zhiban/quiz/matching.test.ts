import { describe, it, expect } from 'vitest';
import { content, answers, type Content } from '../../../lib/zhiban/domain/quiz/model';
import { gradeQuiz, publicQuiz, algorithm } from '../../../lib/zhiban/domain/quiz/fill';
import { copyQuestion } from '../../../lib/zhiban/domain/quiz/reuse';
const quiz = (): Content => ({
  type: 'quiz',
  questions: [
    {
      id: 'm',
      type: 'matching',
      question: '配对',
      points: 3.25,
      match: {
        left: [
          { label: '左一', points: 1.25, correct: 'r1' },
          { label: '左二', points: 2, correct: 'r1' },
        ],
        right: [
          { id: 'r1', label: '右一' },
          { id: 'r2', label: '右二' },
        ],
      },
      analysis: 'private explanation',
    },
  ],
});
describe('trusted matching contract', () => {
  it('uses positional IDs, permits repeated targets and sums exact per-item cents', () => {
    const q = content(quiz(), true);
    for (const [a, score] of [
      [['r1', 'r1'], 3.25],
      [['r1', 'r2'], 1.25],
      [['', 'r1'], 2],
      [['r2', 'r2'], 0],
    ] as const)
      expect(gradeQuiz(q.questions, answers({ m: [...a] }, q.questions))[0].earned).toBe(score);
    expect(algorithm(q.questions)).toBe('zhiban-quiz-match-1');
    expect(answers({}, q.questions)).toEqual({ m: ['', ''] });
  });
  it('strips correct mappings and private analysis, retains public item points and IDs', () => {
    const p = JSON.stringify(publicQuiz(quiz().questions));
    expect(p).not.toContain('correct');
    expect(p).not.toContain('private explanation');
    expect(p).toContain('r1');
    expect(p).toContain('1.25');
  });
  it('rejects labels as IDs, wrong arity, unknown targets and non-string answers', () => {
    const q = quiz();
    for (const a of [
      { m: ['右一', 'r1'] },
      { m: ['r1'] },
      { m: ['r1', 'unknown'] },
      { m: [null, 'r1'] },
      { m: 'r1' },
      { foreign: ['r1', 'r1'] },
    ])
      expect(() => answers(a, q.questions)).toThrow();
  });
  it('rejects malformed or ambiguous authored mappings and mismatched totals', () => {
    const mutations = [
      (q: Content) => {
        q.questions[0].points = 4;
      },
      (q: Content) => {
        q.questions[0].match!.left[0].correct = 'absent';
      },
      (q: Content) => {
        q.questions[0].match!.right[1].id = 'r1';
      },
      (q: Content) => {
        q.questions[0].match!.right[1].label = ' 右一 ';
      },
      (q: Content) => {
        q.questions[0].match!.left = [];
      },
      (q: Content) => {
        q.questions[0].match!.right = Array.from({ length: 11 }, (_, i) => ({
          id: String(i),
          label: String(i),
        }));
      },
    ];
    for (const mutate of mutations) {
      const q = quiz();
      mutate(q);
      expect(() => content(q, true)).toThrow();
    }
    const draft = quiz();
    draft.questions[0].match!.left[0].correct = '';
    expect(() => content(draft)).not.toThrow();
    expect(() => content(draft, true)).toThrow();
  });
  it('keeps copied nested mappings independent and scores mixed fill/native content', () => {
    const q = quiz();
    const copied = copyQuestion(q, 'm', 'copy');
    copied.questions[1].match!.left[0].correct = 'r2';
    expect(q.questions[0].match!.left[0].correct).toBe('r1');
    q.questions.push(
      {
        id: 'f',
        type: 'fill_blank',
        question: '版本',
        points: 1,
        blanks: [{ label: '版本', points: 1, accepted: ['16'] }],
      },
      {
        id: 's',
        type: 'single',
        question: '判断',
        points: 1,
        options: [
          { value: 'A', label: '对' },
          { value: 'B', label: '错' },
        ],
        answer: ['A'],
      },
    );
    const normalized = content(q, true);
    expect(
      gradeQuiz(
        normalized.questions,
        answers({ m: ['r1', 'r2'], f: ['16'], s: 'A' }, normalized.questions),
      ).reduce((sum, r) => sum + r.earned, 0),
    ).toBe(3.25);
  });
});
