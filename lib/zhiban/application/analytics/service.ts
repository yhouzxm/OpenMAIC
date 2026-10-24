import { createHmac, randomBytes } from 'node:crypto';
import { caseCommand, type CaseCommand } from '../../domain/followup/model';
import { followupQuery, followupCursor, type FollowupQuery, type FollowupPage } from './followups';
import type { AcademicContext, AcademicStore } from '../academic/service';
import {
  AcademicError,
  academicId,
  requireAcademic,
  type AcademicActor,
} from '../../domain/academic/model';

export interface ActivitySelection {
  activityId: string;
  version: number;
}
export interface AnalyticsActivity {
  id: string;
  version: number;
  title: string;
  publishedAt: number;
}
export interface AnalyticsStudent {
  membershipId: string;
  displayName: string | null;
  attemptNo: number | null;
  submissionVersion: number | null;
  submittedAt: number | null;
  gradeVersion: number | null;
  scorePoints: number | null;
  maxPoints: number | null;
}
export interface AnalyticsSnapshot {
  mode: 'TEACHER';
  offering: { id: string; title: string };
  asOf: number;
  activities: AnalyticsActivity[];
  selected: AnalyticsActivity | null;
  students: AnalyticsStudent[];
  summary: {
    enrolled: number;
    publishedActivities: number;
    started: number | null;
    submitted: number | null;
    notSubmitted: number | null;
    graded: number | null;
    awaitingGrade: number | null;
    averagePercent: number | null;
  };
}
export interface AnalyticsTransaction {
  caseRead(
    actor: AcademicActor,
    offering: string,
    id: string | null,
    state: string,
    q: string,
    after: string | null,
  ): Promise<{
    record?: Record<string, unknown>;
    rows: Record<string, unknown>[];
    next: string | null;
  }>;
  caseCommand(
    actor: AcademicActor,
    offering: string,
    command: CaseCommand,
    key: string,
  ): Promise<unknown>;
  followups(
    actor: AcademicActor,
    offering: string,
    query: FollowupQuery,
    casesEnabled?: boolean,
  ): Promise<Omit<FollowupPage, 'next'>>;
  read(
    actor: AcademicActor,
    offeringId: string,
    selection: ActivitySelection | null,
  ): Promise<AnalyticsSnapshot>;
}
export function activitySelection(input: Record<string, string>): ActivitySelection | null {
  if (Object.keys(input).length === 0) return null;
  requireAcademic(Object.keys(input).sort().join(',') === 'activityId,version');
  const activityId = academicId(input.activityId);
  requireAcademic(/^[1-9][0-9]{0,9}$/.test(input.version));
  const version = Number(input.version);
  requireAcademic(Number.isSafeInteger(version) && version <= 2147483647);
  return { activityId, version };
}
/** Each student contributes at most one latest attempt/submission/published correction. */
export function summarize(
  students: AnalyticsStudent[],
  activityCount: number,
  selected: boolean,
): AnalyticsSnapshot['summary'] {
  if (!selected)
    return {
      enrolled: students.length,
      publishedActivities: activityCount,
      started: null,
      submitted: null,
      notSubmitted: null,
      graded: null,
      awaitingGrade: null,
      averagePercent: null,
    };
  const submitted = students.filter((s) => s.submissionVersion !== null).length;
  const grades = students.filter((s) => s.gradeVersion !== null);
  return {
    enrolled: students.length,
    publishedActivities: activityCount,
    started: students.filter((s) => s.attemptNo !== null).length,
    submitted,
    notSubmitted: students.length - submitted,
    graded: grades.length,
    awaitingGrade: submitted - grades.length,
    averagePercent:
      grades.length === 0
        ? null
        : Math.round(
            (grades.reduce((sum, s) => sum + (100 * s.scorePoints!) / s.maxPoints!, 0) /
              grades.length) *
              10,
          ) / 10,
  };
}
export class AnalyticsService {
  private readonly cursorKey = randomBytes(32);
  constructor(
    private readonly store: AcademicStore,
    private readonly casesEnabled = false,
  ) {}
  async cases(
    context: AcademicContext,
    offering: string,
    id: string | null,
    input: Record<string, string>,
  ) {
    requireAcademic(this.casesEnabled, 'UNAVAILABLE');
    academicId(offering);
    if (id) academicId(id);
    requireAcademic(
      Object.keys(input).every((k) => (id ? ['cursor'] : ['q', 'state', 'cursor']).includes(k)),
    );
    const q = (input.q ?? '').trim(),
      state = input.state ?? 'ALL';
    requireAcademic(
      q.isWellFormed() &&
        q.length <= 120 &&
        !/[\u0000-\u001f\u007f]/.test(q) &&
        ['ALL', 'OPEN', 'CLOSED'].includes(state),
    );
    const bind = JSON.stringify([
      context.tenantId,
      context.actorMembershipId,
      offering,
      id,
      state,
      q,
    ]);
    const mac = (value: string) =>
      createHmac('sha256', this.cursorKey).update(bind).update(value).digest('hex');
    let after: string | null = null;
    if (input.cursor !== undefined) {
      requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString('utf8');
      const [value, signature, ...rest] = raw.split(':');
      requireAcademic(
        !rest.length &&
          Buffer.from(raw).toString('base64url') === input.cursor &&
          signature === mac(value),
      );
      after = academicId(value);
    }
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(tx.analytics, 'UNAVAILABLE');
      const page = await tx.analytics.caseRead(actor, offering, id, state, q, after);
      return {
        ...page,
        next: page.next
          ? Buffer.from(page.next + ':' + mac(page.next)).toString('base64url')
          : null,
      };
    });
  }
  caseCommand(context: AcademicContext, offering: string, input: unknown, key: string) {
    requireAcademic(this.casesEnabled, 'UNAVAILABLE');
    academicId(offering);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const command = caseCommand(input);
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(tx.analytics, 'UNAVAILABLE');
      return tx.analytics.caseCommand(actor, offering, command, key);
    });
  }
  async followups(context: AcademicContext, offeringId: string, input: Record<string, string>) {
    academicId(offeringId);
    const query = followupQuery(context, offeringId, input);
    const result = await this.store.run(context, null, (actor, tx) => {
      if (!tx.analytics) throw new AcademicError('UNAVAILABLE');
      return tx.analytics.followups(actor, offeringId, query, this.casesEnabled);
    });
    const rows = result.rows.slice(0, query.limit);
    return {
      ...result,
      caseManagementEnabled: this.casesEnabled,
      rows,
      next:
        result.rows.length > query.limit
          ? followupCursor(context, offeringId, query, rows.at(-1)!)
          : null,
    };
  }
  read(context: AcademicContext, offeringId: string, input: Record<string, string>) {
    academicId(offeringId);
    const selection = activitySelection(input);
    return this.store.run(context, null, (actor, tx) => {
      if (!tx.analytics) throw new AcademicError('UNAVAILABLE');
      return tx.analytics.read(actor, offeringId, selection);
    });
  }
}
