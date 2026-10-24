import { describe, it, expect } from 'vitest';
import { content, answers, type Content } from '../../../lib/zhiban/domain/quiz/model';
import { gradeQuiz, publicQuiz, algorithm } from '../../../lib/zhiban/domain/quiz/fill';
import { displayItems, isUnanswered, moveItem } from '../../../lib/zhiban/domain/quiz/ordering';
import { copyQuestion } from '../../../lib/zhiban/domain/quiz/reuse';
const quiz = (): Content => ({
  type: 'quiz',
  questions: [
    {
      id: 'o',
      type: 'ordering',
      question: '排序',
      points: 3.25,
      ordering: {
        items: [
          { id: 'b', label: '通电' },
          { id: 'a', label: '断电' },
        ],
        correctOrder: ['a', 'b'],
      },
      analysis: 'private',
    },
  ],
});
describe('trusted ordering contract', () => {
  it('requires confirmation and exact full order, all-or-zero cent score', () => {
    const q = content(quiz(), true);
    for (const [order, confirmed, earned] of [
      [[], false, 0],
      [['a', 'b'], false, 0],
      [['b', 'a'], true, 0],
      [['a', 'b'], true, 3.25],
    ] as const) {
      const a = answers({ o: { order: [...order], confirmed } }, q.questions);
      expect(gradeQuiz(q.questions, a)[0].earned).toBe(earned);
      expect(isUnanswered(q.questions[0], a.o)).toBe(!confirmed);
    }
    expect(answers({}, q.questions)).toEqual({ o: { order: [], confirmed: false } });
    expect(algorithm(q.questions)).toBe('zhiban-quiz-order-1');
  });
  it('public order is independent of key and author item order; no key or analysis leaks', () => {
    const q = quiz();
    const first = publicQuiz(q.questions);
    q.questions[0].ordering!.items.reverse();
    q.questions[0].ordering!.correctOrder.reverse();
    expect(publicQuiz(q.questions)).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/correctOrder|analysis|private/);
    expect(displayItems(q.questions[0]).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('rejects partial, duplicate, unknown, label or malformed answer permutations', () => {
    const q = quiz();
    for (const a of [
      { order: [], confirmed: true },
      { order: ['a'], confirmed: false },
      { order: ['a', 'a'], confirmed: true },
      { order: ['a', 'bad'], confirmed: true },
      { order: ['断电', '通电'], confirmed: true },
      { order: ['a', 'b'], confirmed: 'true' },
      { order: ['a', 'b'], confirmed: true, score: 100 },
      ['a', 'b'],
    ])
      expect(() => answers({ o: a }, q.questions)).toThrow();
  });
  it('validates explicit key, item limits, unique labels/IDs and no ties', () => {
    for (const mutate of [
      (q: Content) => {
        q.questions[0].ordering!.correctOrder = [];
      },
      (q: Content) => {
        q.questions[0].ordering!.correctOrder = ['a', 'a'];
      },
      (q: Content) => {
        q.questions[0].ordering!.items[0].id = 'a';
      },
      (q: Content) => {
        q.questions[0].ordering!.items[0].label = ' 断电 ';
      },
      (q: Content) => {
        q.questions[0].ordering!.items = [];
      },
    ]) {
      const q = quiz();
      mutate(q);
      expect(() => content(q, true)).toThrow();
    }
    const draft = quiz();
    draft.questions[0].ordering!.correctOrder = [];
    expect(() => content(draft)).not.toThrow();
  });
  it('moves immutably, bounds moves and copies nested keys independently', () => {
    const a = ['a', 'b'];
    expect(moveItem(a, 0, 1)).toEqual(['b', 'a']);
    expect(a).toEqual(['a', 'b']);
    expect(moveItem(a, 0, -1)).toBe(a);
    const q = quiz();
    const copied = copyQuestion(q, 'o', 'copy');
    copied.questions[1].ordering!.correctOrder.reverse();
    expect(q.questions[0].ordering!.correctOrder).toEqual(['a', 'b']);
  });
  it('keeps mixed native, matching and fill scoring under the ordering composition', () => {
    const q = quiz();
    q.questions.push(
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
      {
        id: 'f',
        type: 'fill_blank',
        question: '填空',
        points: 1,
        blanks: [{ label: '空', points: 1, accepted: ['16'] }],
      },
      {
        id: 'm',
        type: 'matching',
        question: '匹配',
        points: 2,
        match: {
          left: [
            { label: '左1', points: 1, correct: 'r1' },
            { label: '左2', points: 1, correct: 'r2' },
          ],
          right: [
            { id: 'r1', label: '右1' },
            { id: 'r2', label: '右2' },
          ],
        },
      },
    );
    const normalized = content(q, true);
    const a = answers(
      { o: { order: ['a', 'b'], confirmed: true }, s: 'A', f: ['16'], m: ['r1', 'r2'] },
      normalized.questions,
    );
    expect(gradeQuiz(normalized.questions, a).reduce((n, r) => n + r.earned, 0)).toBe(7.25);
    expect(algorithm(normalized.questions)).toBe('zhiban-quiz-order-1');
  });
});
