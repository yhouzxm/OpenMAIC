import { describe, it, expect } from 'vitest';
import { addJudgment, copyQuestion } from '../../../lib/zhiban/domain/quiz/reuse';
import { content, quizCommand } from '../../../lib/zhiban/domain/quiz/model';
import { gradeQuiz as gradeChoiceQuestions } from '../../../lib/zhiban/domain/quiz/fill';
describe('quiz reuse contract', () => {
  it('requires an explicit key and uses normal single-choice grading', () => {
    const draft = addJudgment({ type: 'quiz', questions: [] }, 'q');
    draft.questions[0].question = '先断电';
    expect(() => content(draft, true)).toThrow();
    draft.questions[0].answer = ['A'];
    const published = content(draft, true);
    expect(gradeChoiceQuestions(published.questions, { q: 'A' })[0].earned).toBe(1);
    expect(gradeChoiceQuestions(published.questions, { q: 'B' })[0].earned).toBe(0);
  });
  it('copies nested content independently and supports undo by immutable input', () => {
    const draft = addJudgment({ type: 'quiz', questions: [] }, 'q');
    draft.questions[0].answer = ['B'];
    const copied = copyQuestion(draft, 'q', 'new');
    expect(copied.questions.map((q) => q.id)).toEqual(['q', 'new']);
    copied.questions[1].options![0].label = 'edited';
    expect(draft.questions[0].options![0].label).toBe('正确');
    expect(copied.questions[1].answer).toEqual(['B']);
    expect(copyQuestion(draft, 'missing', 'new')).toBe(draft);
    expect(copyQuestion(draft, 'q', 'q')).toBe(draft);
    const full = {
      ...draft,
      questions: Array.from({ length: 100 }, (_, i) => ({ ...draft.questions[0], id: String(i) })),
    };
    expect(copyQuestion(full, '0', 'new')).toBe(full);
    expect(addJudgment(full, 'new')).toBe(full);
  });
  it('requires source pin and disallows caller-supplied authority or content', () => {
    const c = {
      type: 'COPY_QUIZ',
      sourceId: '01a168e2-a3c1-75cb-ac6b-cf2e996795fd',
      sourceRevision: '1',
      sourceVersion: null,
    };
    expect(quizCommand(c)).toEqual(c);
    for (const extra of [{ content: {} }, { offering: c.sourceId }, { mode: 'PRACTICE' }])
      expect(() => quizCommand({ ...c, ...extra })).toThrow();
    expect(() => quizCommand({ ...c, sourceVersion: '0' })).toThrow();
  });
});
