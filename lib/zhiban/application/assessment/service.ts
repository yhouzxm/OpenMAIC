import { quizGradeCommand } from '../../domain/quiz/model';
import {
  gradebookQuery,
  gradebookCursor,
  gradebookExportQuery,
  GRADEBOOK_EXPORT_LIMITS,
  type GradebookPage,
  type GradebookQuery,
} from './gradebook';
import {
  recordQuery,
  readRecordCursor,
  recordCursor,
  type RecordQuery,
  type RecordPage,
  type RecordKind,
} from '../learning/pages';
import type { AcademicContext, AcademicStore } from '../academic/service';
import type { AcademicActor } from '@/lib/zhiban/domain/academic/model';
import { academicId, requireAcademic } from '@/lib/zhiban/domain/academic/model';
import { assessmentCommand, type AssessmentCommand } from '@/lib/zhiban/domain/assessment/model';
export interface AssessmentSnapshot {
  mode: 'TEACHER' | 'STUDENT';
  offeringId: string;
  grades: Record<string, unknown>[];
  publications: Record<string, unknown>[];
}
export interface AssessmentTransaction {
  gradebook?(
    actor: AcademicActor,
    offeringId: string,
    query: GradebookQuery,
  ): Promise<GradebookPage>;
  page?(actor: AcademicActor, offeringId: string, query: RecordQuery): Promise<RecordPage>;
  read(actor: AcademicActor, offeringId: string): Promise<AssessmentSnapshot>;
  execute(
    actor: AcademicActor,
    offeringId: string,
    command: AssessmentCommand,
    key: string,
  ): Promise<Record<string, unknown>>;
}
export class AssessmentService {
  constructor(private readonly store: AcademicStore) {}
  read(context: AcademicContext, offeringId: string) {
    academicId(offeringId);
    return this.store.run(context, null, (actor, tx) => tx.assessment.read(actor, offeringId));
  }
  page(
    context: AcademicContext,
    offeringId: string,
    kind: RecordKind,
    input: Record<string, string>,
  ) {
    academicId(offeringId);
    requireAcademic(['publications', 'queue'].includes(kind));
    const query = readRecordCursor(context, offeringId, recordQuery(kind, input), input.cursor);
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(!!tx.assessment.page, 'UNAVAILABLE');
      const page = await tx.assessment.page!(actor, offeringId, query);
      return {
        ...page,
        next: undefined,
        nextCursor: page.next ? recordCursor(context, offeringId, query, page.next) : null,
      };
    });
  }
  gradebook(context: AcademicContext, offeringId: string, input: Record<string, string>) {
    academicId(offeringId);
    const query = gradebookQuery(context, offeringId, input);
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(!!tx.assessment.gradebook, 'UNAVAILABLE');
      const page = await tx.assessment.gradebook!(actor, offeringId, query);
      return {
        ...page,
        csvPageExport: true,
        csvFilterExport: GRADEBOOK_EXPORT_LIMITS,
        next: undefined,
        activityNext: undefined,
        nextCursor: page.next
          ? gradebookCursor(context, offeringId, query, 'student', page.next)
          : null,
        activityNextCursor: page.activityNext
          ? gradebookCursor(context, offeringId, query, 'activity', page.activityNext)
          : null,
      };
    });
  }
  exportGradebook(context: AcademicContext, offeringId: string, input: Record<string, string>) {
    academicId(offeringId);
    const query = gradebookExportQuery(input);
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(!!tx.assessment.gradebook, 'UNAVAILABLE');
      const page = await tx.assessment.gradebook!(actor, offeringId, query);
      requireAcademic(
        !page.next &&
          !page.activityNext &&
          page.rows.length <= query.limit &&
          page.activities.length <= query.activityLimit &&
          page.rows.length * page.activities.length <= GRADEBOOK_EXPORT_LIMITS.records,
        'EXPORT_LIMIT',
      );
      return page;
    });
  }
  command(context: AcademicContext, offeringId: string, input: unknown, key: string) {
    academicId(offeringId);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    if (
      (input as { type?: string })?.type === 'SAVE_QUIZ_GRADE' ||
      (input as { type?: string })?.type === 'CORRECT_QUIZ_GRADE'
    ) {
      const command = quizGradeCommand(input);
      return this.store.run(context, null, (actor, tx) => {
        requireAcademic(!!tx.quiz, 'UNAVAILABLE');
        return tx.quiz!.grade(actor, offeringId, command, key);
      });
    }
    const command = assessmentCommand(input);
    return this.store.run(context, null, (actor, tx) =>
      tx.assessment.execute(actor, offeringId, command, key),
    );
  }
}
