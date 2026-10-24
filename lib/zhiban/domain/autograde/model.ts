import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { discussionText } from '../discussion/model';
import { exact } from '../quiz/model';
export type AutoCommand =
  | {
      type: 'ENABLE';
      activityId: string;
      revision: string;
      activityVersion: number;
      rubric: string;
      maxPoints: number;
    }
  | { type: 'DISABLE'; activityId: string; revision: string }
  | { type: 'RETRY'; submissionId: string }
  | { type: 'CANCEL' | 'EXPIRE'; id: string; revision: string }
  | { type: 'OPEN_APPEAL'; publicationId: string; body: string }
  | {
      type: 'RESOLVE_APPEAL';
      id: string;
      revision: string;
      response: string;
      replacementId: string | null;
    };
export function autoCommand(input: unknown): AutoCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>,
    shapes: Record<string, string[]> = {
      ENABLE: ['activityId', 'revision', 'activityVersion', 'rubric', 'maxPoints'],
      DISABLE: ['activityId', 'revision'],
      RETRY: ['submissionId'],
      CANCEL: ['id', 'revision'],
      EXPIRE: ['id', 'revision'],
      OPEN_APPEAL: ['publicationId', 'body'],
      RESOLVE_APPEAL: ['id', 'revision', 'response', 'replacementId'],
    };
  requireAcademic(Object.hasOwn(shapes, String(v.type)));
  exact(v, ['type', ...shapes[String(v.type)]]);
  for (const k of ['activityId', 'submissionId', 'id', 'publicationId'])
    if (k in v) academicId(v[k]);
  if ('revision' in v) academicRevision(v.revision);
  if ('rubric' in v) v.rubric = discussionText(v.rubric, 4000);
  if ('body' in v) v.body = discussionText(v.body, 2000);
  if ('response' in v) v.response = discussionText(v.response, 2000);
  if ('replacementId' in v && v.replacementId !== null) academicId(v.replacementId);
  if (v.type === 'ENABLE')
    requireAcademic(
      Number.isSafeInteger(v.activityVersion) &&
        Number(v.activityVersion) > 0 &&
        Number.isInteger(v.maxPoints) &&
        Number(v.maxPoints) > 0 &&
        Number(v.maxPoints) <= 100000,
    );
  return v as unknown as AutoCommand;
}
export type AutoInput = {
  kind: 'TEXT_RESPONSE' | 'QUIZ';
  title: string;
  answer?: string;
  answers?: Record<string, unknown>;
  rubric: string;
  provider: string;
  model: string;
  maxPoints: number;
  activityId: string;
  submissionId: string;
  limits: {
    id: string;
    type: string;
    maxPoints: number;
    question: string;
    reference?: unknown;
    guidance?: string;
  }[];
  objective: Record<string, number>;
};
export type AutoResult = {
  marks: Record<string, number>;
  feedback: string;
  model: { provider: string; model: string; promptSha256: string; [k: string]: unknown };
};
export function parseAutoResult(
  raw: string,
  input: AutoInput,
  model: AutoResult['model'],
): AutoResult {
  requireAcademic(raw.length <= 20000, 'UNAVAILABLE');
  const s = raw
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  let v: unknown;
  try {
    v = JSON.parse(s);
  } catch {
    requireAcademic(false, 'UNAVAILABLE');
  }
  exact(v, ['marks', 'feedback']);
  exact(
    v.marks,
    input.limits.filter((q) => q.type === 'short_answer').map((q) => q.id),
  );
  const marks = { ...input.objective };
  for (const q of input.limits.filter((q) => q.type === 'short_answer')) {
    const n = v.marks[q.id];
    requireAcademic(
      typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= q.maxPoints,
      'UNAVAILABLE',
    );
    marks[q.id] = n;
  }
  requireAcademic(Object.keys(marks).length === input.limits.length, 'UNAVAILABLE');
  return { marks, feedback: discussionText(v.feedback, 2000), model };
}
