import { createHash } from 'node:crypto';
import type { AcademicContext, AcademicStore } from '../academic/service';
import { academicId, requireAcademic, AcademicError } from '../../domain/academic/model';
import { exact, canonical } from '../../domain/quiz/model';
export type AdviceInput = {
  submissionId: string;
  gradeRevision: string | null;
  version: string;
  content: unknown;
  answers: unknown;
};
export type AdviceResult = { marks: Record<string, string>; feedback: string; model: string };
export type Advisor = (input: AdviceInput) => Promise<AdviceResult>;
export const adviceHash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export class QuizAdviceService {
  private running = new Map<string, { submission: string; task: Promise<unknown> }>();
  constructor(
    private readonly store: AcademicStore,
    private readonly advisor: Advisor,
  ) {}
  async command(context: AcademicContext, offering: string, input: unknown, key: string) {
    academicId(offering);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = input as { type: string; submissionId: string; suggestionId?: string };
    requireAcademic(
      c && ['SUGGEST_QUIZ_GRADE', 'ACCEPT_QUIZ_ADVICE', 'REJECT_QUIZ_ADVICE'].includes(c.type),
    );
    exact(
      c,
      c.type === 'SUGGEST_QUIZ_GRADE'
        ? ['type', 'submissionId']
        : ['type', 'submissionId', 'suggestionId'],
    );
    academicId(c.submissionId);
    const run = <T>(
      fn: (
        tx: import('./service').QuizTransaction,
        actor: import('../../domain/academic/model').AcademicActor,
      ) => Promise<T>,
    ) =>
      this.store.run(context, null, (actor, tx) => {
        requireAcademic(!!tx.quiz, 'UNAVAILABLE');
        return fn(tx.quiz!, actor);
      });
    if (c.type !== 'SUGGEST_QUIZ_GRADE') {
      requireAcademic(typeof c.suggestionId === 'string' && /^[a-f0-9]{64}$/.test(c.suggestionId));
      return run((tx, actor) =>
        tx.decideAdvice(
          actor,
          offering,
          c.submissionId,
          c.suggestionId!,
          c.type === 'ACCEPT_QUIZ_ADVICE',
        ),
      );
    }
    const id = adviceHash({
      tenant: context.tenantId,
      offering,
      actor: context.actorMembershipId,
      key,
    });
    const snapshot = await run((tx, actor) => tx.adviceSnapshot(actor, offering, c.submissionId));
    const previous = await run((tx, actor) => tx.findAdvice(actor, offering, c.submissionId, id));
    if (previous) return previous;
    requireAcademic(this.running.size < 4 || this.running.has(id), 'UNAVAILABLE');
    const existing = this.running.get(id);
    if (existing) {
      requireAcademic(existing.submission === c.submissionId, 'CONFLICT');
      await existing.task;
      // A joined request has its own session: re-authorize it after model completion.
      return run((tx, actor) => tx.findAdvice(actor, offering, c.submissionId, id));
    }
    const task = (async () => {
      let result: AdviceResult;
      try {
        result = await this.advisor(snapshot);
      } catch {
        throw new AcademicError('UNAVAILABLE');
      }
      return run((tx, actor) => tx.saveAdvice(actor, offering, snapshot, id, result));
    })();
    this.running.set(id, { submission: c.submissionId, task });
    try {
      return await task;
    } finally {
      this.running.delete(id);
    }
  }
}
