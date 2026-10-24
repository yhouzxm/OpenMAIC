import { DiscussionService } from '../discussion/service';
import { QuizService } from '../quiz/service';
import type { FileClearanceEvidence, SubmissionFileClearance } from './attachment-assets';
import { ClassroomService } from '../classroom/service';
import { curriculumCommand } from '@/lib/zhiban/domain/curriculum/model';
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
import { learningCommand, type LearningCommand } from '@/lib/zhiban/domain/learning/model';
export interface LearningSnapshot {
  mode: 'TEACHER' | 'STUDENT';
  offeringId: string;
  activities: Record<string, unknown>[];
  attempts: Record<string, unknown>[];
  submissions: Record<string, unknown>[];
}
export interface LearningTransaction {
  authorizeAttachment?(actor: AcademicActor, offeringId: string, attemptId: string): Promise<void>;
  page?(actor: AcademicActor, offeringId: string, query: RecordQuery): Promise<RecordPage>;
  files?(
    actor: AcademicActor,
    offeringId: string,
    submission: string,
    file?: string,
  ): Promise<Record<string, unknown>[]>;
  read(actor: AcademicActor, offeringId: string): Promise<LearningSnapshot>;
  execute(
    actor: AcademicActor,
    offeringId: string,
    command: LearningCommand,
    key: string,
    clearance?: FileClearanceEvidence,
  ): Promise<Record<string, unknown>>;
}
export class LearningService {
  readonly classrooms: ClassroomService;
  readonly discussions: DiscussionService;
  readonly quizzes: QuizService;
  get attachmentMode() {
    return this.clearance?.mode ?? null;
  }
  constructor(
    private readonly store: AcademicStore,
    private readonly clearance: SubmissionFileClearance | null = null,
    readonly jointEnabled = false,
  ) {
    this.discussions = new DiscussionService(store);
    this.quizzes = new QuizService(store);
    this.classrooms = new ClassroomService(store, jointEnabled);
  }
  materials(context: AcademicContext, offeringId: string) {
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.material, 'UNAVAILABLE');
      return tx.material!.list(actor, offeringId);
    });
  }
  outline(context: AcademicContext, offeringId: string) {
    academicId(offeringId);
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.curriculum, 'UNAVAILABLE');
      return tx.curriculum!.read(actor, offeringId);
    });
  }
  arrange(
    context: AcademicContext,
    offeringId: string,
    input: unknown,
    key: string,
    lectureIds: Set<string>,
  ) {
    academicId(offeringId);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const command = curriculumCommand(input);
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.curriculum, 'UNAVAILABLE');
      return tx.curriculum!.execute(actor, offeringId, command, key, lectureIds);
    });
  }
  read(context: AcademicContext, offeringId: string) {
    academicId(offeringId);
    return this.store.run(context, null, (actor, tx) => tx.learning.read(actor, offeringId));
  }
  page(
    context: AcademicContext,
    offeringId: string,
    kind: RecordKind,
    input: Record<string, string>,
  ) {
    academicId(offeringId);
    requireAcademic(['activities', 'attempts', 'submissions'].includes(kind));
    const query = readRecordCursor(context, offeringId, recordQuery(kind, input), input.cursor);
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(!!tx.learning.page, 'UNAVAILABLE');
      const page = await tx.learning.page!(actor, offeringId, query);
      return {
        ...page,
        next: undefined,
        nextCursor: page.next ? recordCursor(context, offeringId, query, page.next) : null,
      };
    });
  }
  files(context: AcademicContext, offeringId: string, submission: string, file?: string) {
    academicId(offeringId);
    academicId(submission);
    if (file) academicId(file);
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.learning.files, 'UNAVAILABLE');
      return tx.learning.files!(actor, offeringId, submission, file);
    });
  }
  command(
    context: AcademicContext,
    offeringId: string,
    input: unknown,
    key: string,
    attachmentsEnabled = false,
  ) {
    academicId(offeringId);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const command = learningCommand(input);
    requireAcademic(!('attachment' in command) || attachmentsEnabled, 'UNAVAILABLE');
    return this.store.run(context, null, async (actor, tx) => {
      let evidence: FileClearanceEvidence | undefined;
      if ('attachment' in command && command.attachment) {
        requireAcademic(!!tx.learning.authorizeAttachment, 'UNAVAILABLE');
        await tx.learning.authorizeAttachment!(actor, offeringId, command.id);
        const result = await this.clearance?.check(command.attachment);
        requireAcademic(!!result && result.mode === this.clearance?.mode, 'ATTACHMENT_NOT_CLEARED');
        evidence = result!;
      }
      return tx.learning.execute(actor, offeringId, command, key, evidence);
    });
  }
}
