export class QuizLimitError extends Error {}
import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { learningText, learningCommand } from '../learning/model';
export type Question = {
  id: string;
  type: 'single' | 'multiple' | 'short_answer' | 'fill_blank' | 'matching' | 'ordering';
  ordering?: { items: { id: string; label: string }[]; correctOrder: string[] };
  match?: {
    left: { label: string; points: number; correct: string }[];
    right: { id: string; label: string }[];
  };
  blanks?: { label: string; points: number; accepted: string[] }[];
  question: string;
  options?: { value: string; label: string }[];
  answer?: string[];
  analysis?: string;
  commentPrompt?: string;
  hasAnswer?: boolean;
  points?: number;
};
export type Content = { type: 'quiz'; questions: Question[] };
export type OrderingAnswer = { order: string[]; confirmed: boolean };
export type Answers = Record<string, string | string[] | OrderingAnswer>;
export type QuizCommand =
  | { type: 'COPY_QUIZ'; sourceId: string; sourceRevision: string; sourceVersion: string | null }
  | {
      type: 'CREATE_QUIZ';
      title: string;
      mode: 'PRACTICE' | 'ASSESSED';
      content: Content;
      deadlineAt: number | null;
      allowResubmit: boolean;
      maxAttempts: number | null;
    }
  | {
      type: 'EDIT_QUIZ';
      id: string;
      revision: string;
      title: string;
      content: Content;
      deadlineAt: number | null;
      allowResubmit: boolean;
      maxAttempts: number | null;
    }
  | { type: 'PUBLISH_QUIZ' | 'WITHDRAW_QUIZ' | 'CLOSE_QUIZ_REVIEW'; id: string; revision: string }
  | { type: 'START_QUIZ_ATTEMPT'; activityId: string; expectedVersion: string }
  | {
      type: 'SAVE_QUIZ_DRAFT' | 'SUBMIT_QUIZ';
      attemptId: string;
      revision: string;
      answers: Answers;
    };
export type QuizGradeCommand =
  | {
      type: 'SAVE_QUIZ_GRADE';
      submissionId: string;
      gradeRevision: string | null;
      manualMarks: Record<string, string>;
      feedback: string;
    }
  | {
      type: 'CORRECT_QUIZ_GRADE';
      submissionId: string;
      revision: string;
      marks: Record<string, string>;
      overrides: Record<string, string>;
      feedback: string;
      reason: string;
    };
export function exact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  requireAcademic(!!v && typeof v === 'object' && !Array.isArray(v));
  requireAcademic(
    Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key)),
  );
}
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}
export function points(n: unknown) {
  requireAcademic(
    typeof n === 'number' &&
      Number.isFinite(n) &&
      n > 0 &&
      n <= 1000 &&
      /^\d+(?:\.\d{1,2})?$/.test(String(n)),
  );
  return Math.round(n * 100);
}
export function content(input: unknown, publish = false): Content {
  exact(input, ['type', 'questions']);
  requireAcademic(
    input.type === 'quiz' &&
      Array.isArray(input.questions) &&
      input.questions.length <= 100 &&
      (!publish || input.questions.length > 0),
  );
  const ids = new Set<string>();
  for (const q of input.questions as Question[]) {
    requireAcademic(!!q && typeof q === 'object' && !Array.isArray(q));
    requireAcademic(
      Object.keys(q).every((k) =>
        [
          'id',
          'type',
          'question',
          'options',
          'answer',
          'analysis',
          'commentPrompt',
          'hasAnswer',
          'points',
          'blanks',
          'match',
          'ordering',
        ].includes(k),
      ),
    );
    learningText(q.id, 100);
    requireAcademic(!['__proto__', 'constructor', 'prototype'].includes(q.id) && !ids.has(q.id));
    ids.add(q.id);
    requireAcademic(
      ['single', 'multiple', 'short_answer', 'fill_blank', 'matching', 'ordering'].includes(q.type),
    );
    learningText(q.question, 2000, !publish);
    if (q.analysis !== undefined) learningText(q.analysis, 2000, true);
    if (q.commentPrompt !== undefined) learningText(q.commentPrompt, 2000, true);
    if (q.hasAnswer !== undefined) requireAcademic(typeof q.hasAnswer === 'boolean');
    if (q.points !== undefined) points(q.points);
    if (q.type === 'ordering') {
      requireAcademic(
        q.options === undefined &&
          q.answer === undefined &&
          q.blanks === undefined &&
          q.match === undefined &&
          q.commentPrompt === undefined &&
          q.hasAnswer === undefined,
      );
      exact(q.ordering, ['items', 'correctOrder']);
      const o = q.ordering!;
      requireAcademic(Array.isArray(o.items) && o.items.length >= 2 && o.items.length <= 10);
      const itemIds = new Set<string>();
      for (const item of o.items) {
        exact(item, ['id', 'label']);
        learningText(item.id, 100);
        learningText(item.label, 200, !publish);
        requireAcademic(
          !itemIds.has(item.id) && !['__proto__', 'constructor', 'prototype'].includes(item.id),
        );
        itemIds.add(item.id);
      }
      if (publish)
        requireAcademic(new Set(o.items.map((item) => item.label.trim())).size === o.items.length);
      requireAcademic(
        Array.isArray(o.correctOrder) &&
          (o.correctOrder.length === o.items.length || (!publish && o.correctOrder.length === 0)) &&
          new Set(o.correctOrder).size === o.correctOrder.length &&
          o.correctOrder.every((id) => itemIds.has(id)),
      );
      points(q.points);
    } else requireAcademic(q.ordering === undefined);
    if (q.type === 'matching') {
      requireAcademic(
        q.options === undefined &&
          q.answer === undefined &&
          q.blanks === undefined &&
          q.commentPrompt === undefined &&
          q.hasAnswer === undefined,
      );
      exact(q.match, ['left', 'right']);
      const m = q.match!;
      requireAcademic(
        Array.isArray(m.left) &&
          m.left.length >= 2 &&
          m.left.length <= 10 &&
          Array.isArray(m.right) &&
          m.right.length >= 2 &&
          m.right.length <= 10,
      );
      const targets = new Set<string>();
      for (const r of m.right) {
        exact(r, ['id', 'label']);
        learningText(r.id, 100);
        learningText(r.label, 200, !publish);
        requireAcademic(
          !targets.has(r.id) && !['__proto__', 'constructor', 'prototype'].includes(r.id),
        );
        targets.add(r.id);
      }
      if (publish)
        requireAcademic(new Set(m.right.map((r) => r.label.trim())).size === m.right.length);
      for (const l of m.left) {
        exact(l, ['label', 'points', 'correct']);
        learningText(l.label, 200, !publish);
        points(l.points);
        requireAcademic(
          typeof l.correct === 'string' &&
            (targets.has(l.correct) || (!publish && l.correct === '')),
        );
      }
      requireAcademic(points(q.points) === m.left.reduce((n, l) => n + points(l.points), 0));
    } else requireAcademic(q.match === undefined);
    if (q.type === 'fill_blank') {
      requireAcademic(
        q.options === undefined &&
          q.answer === undefined &&
          q.commentPrompt === undefined &&
          q.hasAnswer === undefined,
      );
      requireAcademic(Array.isArray(q.blanks) && q.blanks.length >= 1 && q.blanks.length <= 10);
      for (const b of q.blanks!) {
        exact(b, ['label', 'points', 'accepted']);
        learningText(b.label, 120);
        points(b.points);
        requireAcademic(
          Array.isArray(b.accepted) &&
            b.accepted.length <= 20 &&
            (!publish || b.accepted.length > 0),
        );
        b.accepted.forEach((a) => learningText(a, 200, !publish));
        requireAcademic(new Set(b.accepted.map((a) => a.trim())).size === b.accepted.length);
      }
      const total = q.blanks!.reduce((n, b) => n + points(b.points), 0);
      requireAcademic(total <= 100000 && points(q.points) === total);
    } else {
      requireAcademic(q.blanks === undefined);
    }
    if (q.type === 'single' || q.type === 'multiple') {
      requireAcademic(
        Array.isArray(q.options) && q.options.length <= 26 && (!publish || q.options.length >= 2),
      );
      const opts = new Set<string>();
      for (const o of q.options) {
        exact(o, ['value', 'label']);
        learningText(o.value, 100);
        learningText(o.label, 2000, !publish);
        requireAcademic(!opts.has(o.value));
        opts.add(o.value);
      }
      requireAcademic(
        Array.isArray(q.answer) &&
          q.answer.every((a) => typeof a === 'string' && opts.has(a)) &&
          new Set(q.answer).size === q.answer.length,
      );
      if (publish)
        requireAcademic(q.type === 'single' ? q.answer.length === 1 : q.answer.length >= 1);
    } else {
      requireAcademic(q.options === undefined && q.answer === undefined);
    }
  }
  requireAcademic(
    (input.questions as Question[]).reduce((sum, q) => sum + points(q.points ?? 1), 0) <= 100000,
  );
  const result = JSON.parse(canonical(input)) as Content;
  result.questions.forEach((q) => (q.points ??= 1));
  if (new TextEncoder().encode(canonical(result)).length > 1048576)
    throw new QuizLimitError('Quiz snapshot too large');
  return result;
}
export function answers(input: unknown, questions: Question[]): Answers {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const src = input as Record<string, unknown>;
  requireAcademic(Object.keys(src).every((k) => questions.some((q) => q.id === k)));
  const result: Answers = {};
  for (const q of questions) {
    const a = src[q.id];
    if (q.type === 'ordering') {
      if (a === undefined) result[q.id] = { order: [], confirmed: false };
      else {
        exact(a, ['order', 'confirmed']);
        const value = a as OrderingAnswer;
        requireAcademic(typeof value.confirmed === 'boolean' && Array.isArray(value.order));
        requireAcademic(
          (value.order.length === q.ordering!.items.length ||
            (!value.confirmed && value.order.length === 0)) &&
            new Set(value.order).size === value.order.length &&
            value.order.every((id) => q.ordering!.items.some((item) => item.id === id)),
        );
        result[q.id] = { order: [...value.order], confirmed: value.confirmed };
      }
    } else if (q.type === 'matching') {
      requireAcademic(a === undefined || (Array.isArray(a) && a.length === q.match!.left.length));
      const entries = a === undefined ? q.match!.left.map(() => '') : (a as unknown[]);
      requireAcademic(
        entries.every(
          (v) => typeof v === 'string' && (v === '' || q.match!.right.some((r) => r.id === v)),
        ),
      );
      result[q.id] = entries as string[];
    } else if (q.type === 'fill_blank') {
      requireAcademic(a === undefined || (Array.isArray(a) && a.length === q.blanks!.length));
      const entries = a === undefined ? q.blanks!.map(() => '') : (a as unknown[]);
      entries.forEach((v) => learningText(v, 200, true));
      result[q.id] = entries as string[];
    } else if (q.type === 'short_answer') {
      requireAcademic(a === undefined || typeof a === 'string');
      learningText(a ?? '', 4000, true);
      result[q.id] = (a ?? '') as string;
    } else if (q.type === 'single') {
      requireAcademic(
        a === undefined ||
          a === '' ||
          (typeof a === 'string' && q.options!.some((o) => o.value === a)),
      );
      result[q.id] = (a ?? '') as string;
    } else {
      requireAcademic(a === undefined || Array.isArray(a));
      const values = (a ?? []) as unknown[];
      requireAcademic(
        values.every((v) => typeof v === 'string' && q.options!.some((o) => o.value === v)) &&
          new Set(values).size === values.length,
      );
      result[q.id] = [...(values as string[])].sort();
    }
  }
  if (new TextEncoder().encode(canonical(result)).length > 65536)
    throw new QuizLimitError('Quiz answers too large');
  return result;
}
export function quizCommand(v: unknown): QuizCommand {
  requireAcademic(!!v && typeof v === 'object');
  const c = v as QuizCommand;
  const fields: Record<string, string[]> = {
    COPY_QUIZ: ['sourceId', 'sourceRevision', 'sourceVersion'],
    CREATE_QUIZ: ['title', 'mode', 'content', 'deadlineAt', 'allowResubmit', 'maxAttempts'],
    EDIT_QUIZ: ['id', 'revision', 'title', 'content', 'deadlineAt', 'allowResubmit', 'maxAttempts'],
    PUBLISH_QUIZ: ['id', 'revision'],
    WITHDRAW_QUIZ: ['id', 'revision'],
    CLOSE_QUIZ_REVIEW: ['id', 'revision'],
    START_QUIZ_ATTEMPT: ['activityId', 'expectedVersion'],
    SAVE_QUIZ_DRAFT: ['attemptId', 'revision', 'answers'],
    SUBMIT_QUIZ: ['attemptId', 'revision', 'answers'],
  };
  requireAcademic(Object.hasOwn(fields, c.type));
  exact(c, ['type', ...fields[c.type]]);
  if (c.type === 'COPY_QUIZ') {
    academicId(c.sourceId);
    academicRevision(c.sourceRevision);
    if (c.sourceVersion !== null) academicRevision(c.sourceVersion);
  }
  if ('id' in c) academicId(c.id);
  if ('attemptId' in c) academicId(c.attemptId);
  if ('activityId' in c) academicId(c.activityId);
  if ('revision' in c) academicRevision(c.revision);
  if ('expectedVersion' in c) academicRevision(c.expectedVersion);
  if ('content' in c) {
    c.content = content(c.content);
    learningCommand({
      type: 'CREATE_ACTIVITY',
      title: c.title,
      prompt: '测验',
      deadlineAt: c.deadlineAt,
      allowResubmit: c.allowResubmit,
      maxAttempts: c.maxAttempts,
    });
  }
  if ('mode' in c) requireAcademic(['PRACTICE', 'ASSESSED'].includes(c.mode));
  return c;
}
export function quizGradeCommand(v: unknown): QuizGradeCommand {
  requireAcademic(!!v && typeof v === 'object');
  const c = v as QuizGradeCommand;
  requireAcademic(c.type === 'SAVE_QUIZ_GRADE' || c.type === 'CORRECT_QUIZ_GRADE');
  exact(
    c,
    c.type === 'SAVE_QUIZ_GRADE'
      ? ['type', 'submissionId', 'gradeRevision', 'manualMarks', 'feedback']
      : ['type', 'submissionId', 'revision', 'marks', 'overrides', 'feedback', 'reason'],
  );
  academicId(c.submissionId);
  if (c.type === 'SAVE_QUIZ_GRADE') {
    if (c.gradeRevision !== null) academicRevision(c.gradeRevision);
  } else {
    academicRevision(c.revision);
    learningText(c.reason, 1000);
  }
  learningText(c.feedback, 2000, true);
  return c;
}
