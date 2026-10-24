import type { AdviceInput, AdviceResult } from './advice';
import type { AcademicContext, AcademicStore } from '../academic/service';
import { academicId, requireAcademic, type AcademicActor } from '../../domain/academic/model';
import { quizCommand, type QuizCommand, type QuizGradeCommand } from '../../domain/quiz/model';
export type GeneratedQuizSource = { runId: string; sourceHash: string; adapter: string };
export interface QuizTransaction {
  adviceSnapshot(actor: AcademicActor, offering: string, submission: string): Promise<AdviceInput>;
  findAdvice(
    actor: AcademicActor,
    offering: string,
    submission: string,
    id: string,
  ): Promise<Record<string, unknown> | null>;
  saveAdvice(
    actor: AcademicActor,
    offering: string,
    input: AdviceInput,
    id: string,
    result: AdviceResult,
  ): Promise<Record<string, unknown>>;
  decideAdvice(
    actor: AcademicActor,
    offering: string,
    submission: string,
    id: string,
    accept: boolean,
  ): Promise<Record<string, unknown>>;

  generatedReplay(
    actor: AcademicActor,
    offering: string,
    key: string,
    source: GeneratedQuizSource,
  ): Promise<Record<string, unknown> | null>;
  authorizeGenerated(actor: AcademicActor, offering: string): Promise<void>;
  read(
    actor: AcademicActor,
    offering: string,
    selector: { activity?: string; attempt?: string; submission?: string },
  ): Promise<Record<string, unknown>>;
  execute(
    actor: AcademicActor,
    offering: string,
    command: QuizCommand,
    key: string,
    source?: GeneratedQuizSource,
  ): Promise<Record<string, unknown>>;
  grade(
    actor: AcademicActor,
    offering: string,
    command: QuizGradeCommand,
    key: string,
  ): Promise<Record<string, unknown>>;
}
export class QuizService {
  constructor(private readonly store: AcademicStore) {}
  read(
    context: AcademicContext,
    offering: string,
    selector: { activity?: string; attempt?: string; submission?: string },
  ) {
    academicId(offering);
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.quiz, 'UNAVAILABLE');
      return tx.quiz!.read(actor, offering, selector);
    });
  }
  adoptGenerated(
    context: AcademicContext,
    offering: string,
    key: string,
    source: GeneratedQuizSource,
    load: () => Promise<{
      title: string;
      content: import('../../domain/quiz/model').Content;
      source: GeneratedQuizSource;
    }>,
  ) {
    academicId(offering);
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(!!tx.quiz, 'UNAVAILABLE');
      await tx.quiz!.authorizeGenerated(actor, offering);
      const previous = await tx.quiz!.generatedReplay(actor, offering, key, source);
      if (previous) return previous;
      const snapshot = await load();
      const command = quizCommand({
        type: 'CREATE_QUIZ',
        title: snapshot.title,
        mode: 'ASSESSED',
        content: snapshot.content,
        deadlineAt: null,
        allowResubmit: false,
        maxAttempts: 1,
      });
      return tx.quiz!.execute(actor, offering, command, key, snapshot.source);
    });
  }
  command(context: AcademicContext, offering: string, input: unknown, key: string) {
    academicId(offering);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const command = quizCommand(input);
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.quiz, 'UNAVAILABLE');
      return tx.quiz!.execute(actor, offering, command, key);
    });
  }
}
