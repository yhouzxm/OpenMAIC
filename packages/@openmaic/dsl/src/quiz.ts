import type { QuizQuestion, QuizContent } from './stage.js';

export interface QuestionResult {
  questionId: string;
  correct: boolean | null;
  status: 'correct' | 'incorrect';
  earned: number;
  aiComment?: string;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Whether a question is graded as open text (AI) rather than by exact
 * answer-key match. Classification is by the explicit `type` only: an
 * unanswered choice question (empty `answer`) is still a choice question and
 * must not be re-routed to AI grading. `hasAnswer` does not override the type.
 */
export function isShortAnswer(q: QuizQuestion): boolean {
  return q.type === 'short_answer';
}

/**
 * Resolve a PERSISTED answer-key entry to an option value. Exact, unique
 * alignment only (per review): an entry that exactly equals one option VALUE
 * resolves to it; one that exactly equals exactly one option LABEL resolves
 * to that option's value. Unknown or ambiguous entries stay unresolved —
 * no case folding, whitespace/Unicode normalization, or wrapper/prefix
 * interpretation is applied.
 *
 * This compatibility resolution exists for the stored key, whose form is
 * whatever the generator wrote. A learner submission is produced by the UI
 * from the option values themselves, so it is compared as-is — see
 * `gradeChoiceQuestions`.
 */
export function resolveAnswerKeyToValue(q: QuizQuestion, answer: string): string {
  const opts = q.options ?? [];
  if (opts.length === 0) return answer;
  const valueMatches = opts.filter((o) => o.value === answer);
  if (valueMatches.length === 1) return valueMatches[0].value;
  const labelMatches = opts.filter((o) => o.label === answer);
  if (labelMatches.length === 1) return labelMatches[0].value;
  return answer;
}

/**
 * Review-UI projection of the same exact resolver used for grading: whether
 * an option's value is among the question's resolved correct-answer values.
 * Receives the question so label-stored keys resolve through the identical
 * exact/unique alignment instead of a separate fuzzy matcher.
 */
export function answerIncludesOption(q: QuizQuestion, optionValue: string): boolean {
  return toArray(q.answer).some((a) => resolveAnswerKeyToValue(q, a) === optionValue);
}

/** Grade choice questions locally. Returns results only for non-short-answer questions. */
export function gradeChoiceQuestions(
  questions: QuizQuestion[],
  answers: Record<string, string | string[]>,
): QuestionResult[] {
  return questions
    .filter((q) => !isShortAnswer(q))
    .map((q) => {
      const pts = q.points ?? 1;
      // Compatibility resolution applies to the persisted key only. The
      // submission is a value the UI produced from the options, so resolving
      // it too would let a label (or any alias the key accepts) be submitted
      // and accepted as a different option.
      const userAnswer = toArray(answers[q.id]);
      const correctAnswer = toArray(q.answer).map((a) => resolveAnswerKeyToValue(q, a));
      const correct = arraysEqual(userAnswer, correctAnswer);
      return {
        questionId: q.id,
        correct,
        status: correct ? ('correct' as const) : ('incorrect' as const),
        earned: correct ? pts : 0,
      };
    });
}

export type { QuizQuestion, QuizContent } from './stage.js';
export type PublicQuestion = Pick<QuizQuestion, 'id' | 'type' | 'question' | 'options' | 'points'>;
export type QuizAnswers = Record<string, string | string[]>;
export const QUIZ_CONTRACT_VERSION = 'zhiban-quiz-1';
export function publicQuestions(questions: QuizQuestion[]): PublicQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    type: q.type,
    question: q.question,
    points: q.points,
    ...(q.options ? { options: q.options.map((o) => ({ value: o.value, label: o.label })) } : {}),
  }));
}

/** Structural authoring hints. Host policy adds publication/size/grade constraints. */
export function validateQuizContent(value: QuizContent): string[] {
  const errors: string[] = [];
  if (value.type !== 'quiz' || !Array.isArray(value.questions)) return ['测验格式不合法'];
  if (!value.questions.length) errors.push('请至少添加一道题');
  const ids = new Set<string>();
  value.questions.forEach((q, i) => {
    const label = `第${i + 1}题`;
    if (ids.has(q.id)) errors.push(label + '编号重复');
    ids.add(q.id);
    if (!q.question.trim()) errors.push(label + '缺少题干');
    if (!Number.isFinite(q.points ?? 1) || (q.points ?? 1) <= 0)
      errors.push(label + '分值必须大于0');
    if (q.type !== 'short_answer') {
      if (!q.options || q.options.length < 2) errors.push(label + '至少需要两个选项');
      if (q.options?.some((o) => !o.label.trim())) errors.push(label + '有空选项');
      if (!q.answer?.length || (q.type === 'single' && q.answer.length !== 1))
        errors.push(label + '请设置正确答案');
    }
  });
  return errors;
}
export function normalizeQuizContent(value: QuizContent): QuizContent {
  return {
    ...value,
    questions: value.questions.map((q) => ({
      ...q,
      points: q.points ?? 1,
      ...(q.options ? { options: q.options.map((o) => ({ ...o })) } : {}),
      ...(q.answer ? { answer: q.answer.map((a) => resolveAnswerKeyToValue(q, a)) } : {}),
    })),
  };
}
