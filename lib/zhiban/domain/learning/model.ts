import { submissionAttachment, type SubmissionAttachment } from './attachment';
import { academicId, academicRevision, AcademicError, requireAcademic } from '../academic/model';

export const learningPolicy = Object.freeze({
  version: 'learning-v1',
  activityType: 'TEXT_RESPONSE',
  teacherRequiresAssignment: true,
  studentRequiresEnrollment: true,
  deadline: 'EXCLUSIVE_SERVER_TIME',
  attemptLimit: 'PER_ACTIVITY_ACROSS_VERSIONS',
  resumeConsumesAttempt: false,
  resubmitConsumesAttempt: false,
  onlyLatestAttemptWritable: true,
  withdrawalBlocksWrites: true,
  publishedVersionsImmutable: true,
  submissionDoesNotMeanCompletion: true,
});
export type LearningCommand =
  | {
      type: 'CREATE_ACTIVITY';
      title: string;
      prompt: string;
      deadlineAt: number | null;
      allowResubmit: boolean;
      maxAttempts: number | null;
    }
  | {
      type: 'EDIT_ACTIVITY';
      id: string;
      revision: string;
      title: string;
      prompt: string;
      deadlineAt: number | null;
      allowResubmit: boolean;
      maxAttempts: number | null;
    }
  | { type: 'PUBLISH_ACTIVITY' | 'WITHDRAW_ACTIVITY'; id: string; revision: string }
  | { type: 'START_ATTEMPT'; id: string; expectedVersion?: string }
  | {
      type: 'SAVE_DRAFT' | 'SUBMIT';
      id: string;
      revision: string;
      answer: string;
      attachment?: SubmissionAttachment;
    };
export function learningText(input: unknown, maximum: number, empty = false): string {
  requireAcademic(
    typeof input === 'string' &&
      input.length <= maximum &&
      (empty || input.trim().length > 0) &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input),
  );
  // Reject malformed UTF-16 instead of letting JSON/PG silently replace it.
  requireAcademic(input.isWellFormed());
  return input;
}
const fields: Record<LearningCommand['type'], string[]> = {
  CREATE_ACTIVITY: ['title', 'prompt', 'deadlineAt', 'allowResubmit', 'maxAttempts'],
  EDIT_ACTIVITY: [
    'id',
    'revision',
    'title',
    'prompt',
    'deadlineAt',
    'allowResubmit',
    'maxAttempts',
  ],
  PUBLISH_ACTIVITY: ['id', 'revision'],
  WITHDRAW_ACTIVITY: ['id', 'revision'],
  START_ATTEMPT: ['id'],
  SAVE_DRAFT: ['id', 'revision', 'answer'],
  SUBMIT: ['id', 'revision', 'answer'],
};
export function learningCommand(input: unknown): LearningCommand {
  requireAcademic(input !== null && typeof input === 'object' && !Array.isArray(input));
  const value = { ...(input as Record<string, unknown>) };
  requireAcademic(typeof value.type === 'string' && Object.hasOwn(fields, value.type));
  const type = value.type as LearningCommand['type'];
  if (value.expectedVersion !== undefined) academicRevision(value.expectedVersion);
  requireAcademic(
    Object.keys(value).sort().join(',') ===
      [
        'type',
        ...fields[type],
        ...(type === 'START_ATTEMPT' && value.expectedVersion !== undefined
          ? ['expectedVersion']
          : []),
        ...(type === 'SUBMIT' && value.attachment !== undefined ? ['attachment'] : []),
      ]
        .sort()
        .join(','),
  );
  if (value.attachment !== undefined) value.attachment = submissionAttachment(value.attachment);
  if ('id' in value) academicId(value.id);
  if ('revision' in value) academicRevision(value.revision);
  if ('title' in value) learningText(value.title, 120);
  if ('prompt' in value) learningText(value.prompt, 2000);
  if ('answer' in value) learningText(value.answer, 4000, type === 'SAVE_DRAFT');
  if ('allowResubmit' in value) requireAcademic(typeof value.allowResubmit === 'boolean');
  if ('deadlineAt' in value)
    requireAcademic(
      value.deadlineAt === null ||
        (Number.isSafeInteger(value.deadlineAt) &&
          Number(value.deadlineAt) > 0 &&
          Number(value.deadlineAt) <= 4102444800000),
    );
  if ('maxAttempts' in value)
    requireAcademic(
      value.maxAttempts === null ||
        (Number.isInteger(value.maxAttempts) &&
          Number(value.maxAttempts) >= 1 &&
          Number(value.maxAttempts) <= 1000),
    );
  return Object.freeze(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
  ) as LearningCommand;
}
export function writableAttempt(
  status: string,
  allowResubmit: boolean,
  deadline: number | null,
  now: number,
) {
  if (deadline !== null && now >= deadline) throw new AcademicError('DEADLINE_PASSED');
  requireAcademic(
    status === 'IN_PROGRESS' || (status === 'SUBMITTED' && allowResubmit),
    'INVALID_STATE',
  );
}
