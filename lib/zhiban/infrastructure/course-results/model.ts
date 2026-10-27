import { z } from 'zod';
import { createHash } from 'node:crypto';
import { gradeChoiceQuestions } from '@openmaic/dsl/quiz';
import type { QuizQuestion } from '@openmaic/dsl';
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const revision = z.string().regex(/^(0|[1-9][0-9]{0,14})$/);
export const taskSpec = z
  .object({
    resourceId: uuid,
    publicationId: uuid,
    sceneId: z.string().min(1).max(160),
    kind: z.enum(['QUIZ', 'PBL', 'REFLECTION']),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type TaskSpec = z.infer<typeof taskSpec>;
export const resultCommand = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('SET_TASK'),
      activityId: uuid,
      activityVersion: z.number().int().positive(),
      revision,
      enabled: z.boolean(),
      spec: taskSpec,
    })
    .strict(),
  z
    .object({
      type: z.literal('START'),
      activityId: uuid,
      activityVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('CAPTURE'),
      attemptId: uuid,
      reflection: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z.object({ type: z.literal('SUBMIT'), attemptId: uuid, revision, proofId: uuid }).strict(),
  z.object({ type: z.literal('RETRACT_SHARED'), sharedId: uuid }).strict(),
  z
    .object({
      type: z.literal('SHARE'),
      resourceId: uuid,
      publicationId: uuid,
      title: z.string().trim().min(1).max(120),
      summary: z.string().trim().min(1).max(4000),
      includeWhiteboard: z.boolean(),
    })
    .strict(),
]);
export type ResultCommand = z.infer<typeof resultCommand>;
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([, value]) => value !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, value]) => [k, canonical(value)]),
        )
      : v;
export const digest = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
export function quizEvidence(questions: QuizQuestion[], answers: Record<string, unknown>) {
  if (questions.length < 1 || questions.length > 100) throw Error('QUIZ_SIZE');
  const clean: Record<string, string | string[]> = Object.create(null);
  for (const q of questions) {
    const v = answers[q.id];
    if (q.type === 'short_answer') {
      if (typeof v !== 'string' || !v.trim() || v.length > 8000) throw Error('QUIZ_UNANSWERED');
      clean[q.id] = v;
    } else {
      const a = typeof v === 'string' ? [v] : v;
      if (
        !Array.isArray(a) ||
        !a.length ||
        a.length > 20 ||
        a.some((x) => typeof x !== 'string' || !q.options?.some((o) => o.value === x)) ||
        new Set(a).size !== a.length
      )
        throw Error('QUIZ_ANSWER_INVALID');
      clean[q.id] = a;
    }
  }
  const objective = gradeChoiceQuestions(questions, clean);
  return {
    source: 'NATIVE_QUIZ_SERVER_RECOMPUTED',
    answers: clean,
    objective,
    shortAnswerReviewRequired: questions.some((q) => q.type === 'short_answer'),
    practiceScore: objective.reduce((n, r) => n + r.earned, 0),
    formalGrade: null,
  };
}
export function completedPblEvidence(
  project: Record<string, unknown>,
  baseline: { revision: string; eventIds: string[] },
  revision: string,
) {
  const events = Array.isArray(project.runtimeEvents)
    ? (project.runtimeEvents as Record<string, unknown>[])
    : [];
  const finished = events.some(
    (e) =>
      e.kind === 'status_changed' &&
      e.entityType === 'project' &&
      e.to === 'completed' &&
      e.actorType !== 'user' &&
      !baseline.eventIds.includes(String(e.id)),
  );
  if (project.status !== 'completed' || BigInt(revision) <= BigInt(baseline.revision) || !finished)
    throw Error('PBL_NOT_COMPLETED_THIS_ATTEMPT');
  const submissions = Array.isArray(project.submissions)
    ? project.submissions.map((raw) => {
        const s = raw as Record<string, unknown>;
        return { id: s.id, microtaskId: s.microtaskId, kind: s.kind, content: s.content };
      })
    : [];
  const final = Array.isArray(project.evaluations)
    ? (project.evaluations
        .filter((raw) => (raw as Record<string, unknown>).kind === 'final')
        .at(-1) as Record<string, unknown> | undefined)
    : undefined;
  return {
    source: 'NATIVE_PBL_SERVER_TERMINAL',
    projectStatus: 'completed',
    nativeRevision: revision,
    projectDigest: digest(project),
    submissions,
    aiPracticeEvaluation: final
      ? {
          feedback: final.feedback,
          whatYouBuilt: final.whatYouBuilt,
          whatYouLearned: final.whatYouLearned,
          whatsNext: final.whatsNext,
        }
      : null,
    formalGrade: null,
  };
}
export function reportText(payload: Record<string, unknown>, reflection: string) {
  const e = payload.execution as Record<string, unknown>;
  const summary = {
    attemptId: payload.attemptId,
    activityId: payload.activityId,
    activityVersion: payload.activityVersion,
    publication: payload.publication,
    proofId: payload.proofId,
    proofDigest: payload.proofDigest,
    execution: {
      source: e.source,
      projectStatus: e.projectStatus,
      nativeRevision: e.nativeRevision,
      practiceScore: e.practiceScore,
      shortAnswerReviewRequired: e.shortAnswerReviewRequired,
      formalGrade: null,
    },
  };
  const text = [
    '课堂成果提交',
    '来源为服务端核验的固定版本；练习分及AI评价不是正式成绩。',
    '完整答卷／PBL成果及来源在课程“课堂成果与共享结果”页按证据ID查证。',
    JSON.stringify(summary, null, 2),
    '本人反思：',
    reflection,
  ].join('\n');
  if (text.length > 19000) throw Error('REPORT_TOO_LARGE');
  return text;
}
