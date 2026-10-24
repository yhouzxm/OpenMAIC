import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { learningText } from '../learning/model';
export const assessmentPolicy = Object.freeze({
  version: 'assessment-v1',
  scorePrecision: 2,
  maxScoreExplicit: true,
  teacherRequiresAssignment: true,
  studentPublishedOwnOnly: true,
  publishRequiresLatestSubmission: true,
  correctionRequiresPublicReason: true,
  resubmissionDoesNotInheritGrade: true,
  courseAggregation: false,
  completionAuthority: false,
});
export function scorePoints(value: unknown, maximum = false): number {
  requireAcademic(typeof value === 'string' && /^(0|[1-9][0-9]{0,3})(\.[0-9]{1,2})?$/.test(value));
  const [whole, fraction = ''] = value.split('.');
  const points = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  requireAcademic(points <= 100000 && (!maximum || points > 0));
  return points;
}
export type AssessmentCommand =
  | {
      type: 'SAVE_GRADE';
      submissionId: string;
      revision: string | null;
      score: string;
      maxScore: string;
      feedback: string;
    }
  | { type: 'PUBLISH_GRADE'; submissionId: string; revision: string }
  | {
      type: 'CORRECT_GRADE';
      submissionId: string;
      revision: string;
      score: string;
      maxScore: string;
      feedback: string;
      reason: string;
    };
const fields: Record<AssessmentCommand['type'], string[]> = {
  SAVE_GRADE: ['submissionId', 'revision', 'score', 'maxScore', 'feedback'],
  PUBLISH_GRADE: ['submissionId', 'revision'],
  CORRECT_GRADE: ['submissionId', 'revision', 'score', 'maxScore', 'feedback', 'reason'],
};
export function assessmentCommand(input: unknown): AssessmentCommand {
  requireAcademic(input !== null && typeof input === 'object' && !Array.isArray(input));
  const value = input as Record<string, unknown>;
  requireAcademic(typeof value.type === 'string' && Object.hasOwn(fields, value.type));
  const type = value.type as AssessmentCommand['type'];
  requireAcademic(
    Object.keys(value).sort().join(',') === ['type', ...fields[type]].sort().join(','),
  );
  academicId(value.submissionId);
  if (type !== 'SAVE_GRADE' || value.revision !== null) academicRevision(value.revision);
  if (type !== 'PUBLISH_GRADE') {
    const score = scorePoints(value.score),
      maximum = scorePoints(value.maxScore, true);
    requireAcademic(score <= maximum);
    learningText(value.feedback, 2000, true);
    if (type === 'CORRECT_GRADE') learningText(value.reason, 1000);
  }
  return Object.freeze(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
  ) as AssessmentCommand;
}
