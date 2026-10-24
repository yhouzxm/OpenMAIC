import type { AcademicContext, AcademicStore } from '../academic/service';
import { AcademicError, academicId, type AcademicActor } from '../../domain/academic/model';
export interface PersonalAttempt {
  id: string;
  activityId: string;
  activityVersion: number;
  title: string;
  attemptNo: number;
  submissionVersion: number | null;
  submittedAt: number | null;
  gradeVersion: number | null;
  scorePoints: number | null;
  maxPoints: number | null;
  feedback: string | null;
  correctionReason: string | null;
  publishedAt: number | null;
}
export interface PersonalActivity {
  id: string;
  version: number;
  title: string;
  deadlineAt: number | null;
  latest: PersonalAttempt | null;
}
export interface PersonalSnapshot {
  mode: 'STUDENT';
  offering: { id: string; title: string };
  asOf: number;
  activities: PersonalActivity[];
  history: PersonalAttempt[];
  summary: {
    activities: number;
    started: number;
    submitted: number;
    notSubmitted: number;
    graded: number;
    awaitingGrade: number;
    averagePercent: number | null;
  };
}
export interface ProgressTransaction {
  read(actor: AcademicActor, offeringId: string): Promise<PersonalSnapshot>;
}
export function personalSummary(activities: PersonalActivity[]): PersonalSnapshot['summary'] {
  const latest = activities.flatMap((a) => (a.latest ? [a.latest] : []));
  const submitted = latest.filter((a) => a.submissionVersion !== null).length;
  const grades = latest.filter((a) => a.gradeVersion !== null);
  return {
    activities: activities.length,
    started: latest.length,
    submitted,
    notSubmitted: activities.length - submitted,
    graded: grades.length,
    awaitingGrade: submitted - grades.length,
    averagePercent: grades.length
      ? Math.round(
          (grades.reduce((sum, a) => sum + (100 * a.scorePoints!) / a.maxPoints!, 0) /
            grades.length) *
            10,
        ) / 10
      : null,
  };
}
export class ProgressService {
  constructor(private readonly store: AcademicStore) {}
  read(context: AcademicContext, offeringId: string) {
    academicId(offeringId);
    return this.store.run(context, null, (actor, tx) => {
      if (!tx.progress) throw new AcademicError('UNAVAILABLE');
      return tx.progress.read(actor, offeringId);
    });
  }
}
