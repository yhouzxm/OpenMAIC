import { describe, it, expect } from 'vitest';
import {
  resultCommand,
  digest,
  quizEvidence,
  completedPblEvidence,
  reportText,
} from '@/lib/zhiban/infrastructure/course-results/model';
import type { QuizQuestion } from '@openmaic/dsl';
const id = '01a16958-5776-7381-a21c-e66fe3c2684b';
describe('trusted classroom provenance', () => {
  it('rejects client completion, score and foreign owner fields', () => {
    for (const extra of [{ score: 100 }, { completed: true }, { owner: 'other' }])
      expect(
        resultCommand.safeParse({ type: 'CAPTURE', attemptId: id, reflection: '反思', ...extra })
          .success,
      ).toBe(false);
  });
  it('hashes survive JSONB key reordering', () => {
    expect(digest({ b: 1, a: { y: 2, x: 3 } })).toBe(digest({ a: { x: 3, y: 2 }, b: 1 }));
  });
  it('recomputes objective scores from frozen questions and ignores claimed grades', () => {
    const q = [
      {
        id: 'q',
        type: 'single',
        question: '单位',
        options: [
          { value: 'A', label: '安培' },
          { value: 'B', label: '伏特' },
        ],
        answer: ['A'],
        points: 2,
      },
    ] satisfies QuizQuestion[];
    expect(quizEvidence(q, { q: 'B', score: 100 }).practiceScore).toBe(0);
    expect(quizEvidence(q, { q: 'A' }).practiceScore).toBe(2);
    expect(() => quizEvidence(q, { q: ['A', 'A'] })).toThrow();
    expect(() => quizEvidence(q, { q: '安培' })).toThrow();
  });
  it('preserves unusual native question ids as data keys', () => {
    const q = [
      {
        id: '__proto__',
        type: 'single',
        question: '单位',
        options: [
          { value: 'A', label: '安培' },
          { value: 'B', label: '伏特' },
        ],
        answer: ['A'],
        points: 2,
      },
    ] satisfies QuizQuestion[];
    const result = quizEvidence(q, JSON.parse('{"__proto__":"A"}'));
    expect(result.practiceScore).toBe(2);
    expect(JSON.parse(JSON.stringify(result.answers)).__proto__).toEqual(['A']);
  });
  it('does not treat short answers as an AI formal grade', () => {
    const result = quizEvidence(
      [{ id: 's', type: 'short_answer', question: '解释', points: 3 }] satisfies QuizQuestion[],
      { s: '电流与电压有关' },
    );
    expect(result.shortAnswerReviewRequired).toBe(true);
    expect(result.formalGrade).toBeNull();
  });
  it('requires a new server-owned PBL terminal event, not a learner-completed flag', () => {
    const e = {
      id: 'new',
      kind: 'status_changed',
      entityType: 'project',
      to: 'completed',
      actorType: 'system',
    };
    expect(() =>
      completedPblEvidence(
        { status: 'completed', runtimeEvents: [{ ...e, actorType: 'user' }] },
        { revision: '1', eventIds: [] },
        '2',
      ),
    ).toThrow();
    expect(() =>
      completedPblEvidence(
        { status: 'completed', runtimeEvents: [e] },
        { revision: '1', eventIds: ['new'] },
        '2',
      ),
    ).toThrow();
    expect(
      completedPblEvidence(
        { status: 'completed', runtimeEvents: [e], submissions: [], evaluations: [] },
        { revision: '1', eventIds: [] },
        '2',
      ).formalGrade,
    ).toBeNull();
  });
  it('keeps full artifacts out of the original bounded text answer', () => {
    const text = reportText(
      {
        proofId: id,
        execution: {
          source: 'NATIVE_PBL_SERVER_TERMINAL',
          submissions: [{ content: 'x'.repeat(100000) }],
        },
      },
      '我的反思',
    );
    expect(text.length).toBeLessThan(19000);
    expect(text).toContain(id);
    expect(text).toContain('不是正式成绩');
  });
});
