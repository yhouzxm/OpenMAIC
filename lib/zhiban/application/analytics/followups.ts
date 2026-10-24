import { createHash } from 'node:crypto';
import type { AcademicContext } from '../academic/service';
import { academicId, academicText, requireAcademic } from '../../domain/academic/model';
export const followupStates = [
  'ALL_PENDING',
  'OVERDUE',
  'NOT_STARTED',
  'IN_PROGRESS',
  'AWAITING_GRADE',
] as const;
export interface FollowupQuery {
  state: (typeof followupStates)[number];
  q: string;
  limit: number;
  after: [string, string] | null;
}
export interface FollowupRow {
  activityId: string;
  version: number;
  title: string;
  deadlineAt: number | null;
  membershipId: string;
  displayName: string | null;
  attemptId: string | null;
  attemptNo: number | null;
  submissionId: string | null;
  submissionVersion: number | null;
  submittedAt: number | null;
  reason: 'OVERDUE' | 'NOT_STARTED' | 'IN_PROGRESS' | 'AWAITING_GRADE';
}
export interface FollowupPage {
  mode: 'TEACHER';
  asOf: number;
  rows: FollowupRow[];
  summary: {
    pending: number;
    overdue: number;
    notStarted: number;
    inProgress: number;
    awaitingGrade: number;
  };
  totalMatches: number;
  next: string | null;
}
function binding(context: AcademicContext, offering: string, query: FollowupQuery) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        context.tenantId,
        context.actorMembershipId,
        offering,
        query.state,
        query.q,
        query.limit,
      ]),
    )
    .digest('hex');
}
export function followupQuery(
  context: AcademicContext,
  offering: string,
  input: Record<string, string>,
): FollowupQuery {
  requireAcademic(Object.keys(input).every((k) => ['q', 'state', 'limit', 'cursor'].includes(k)));
  const q = academicText((input.q ?? '').trim(), 120, true);
  requireAcademic(q.isWellFormed() && ['20', '50'].includes(input.limit ?? '20'));
  const state = input.state ?? 'ALL_PENDING';
  requireAcademic((followupStates as readonly string[]).includes(state));
  const result: FollowupQuery = {
    state: state as FollowupQuery['state'],
    q,
    limit: Number(input.limit ?? 20),
    after: null,
  };
  if (input.cursor !== undefined) {
    const cursor = input.cursor;
    requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(cursor));
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    requireAcademic(Buffer.from(raw).toString('base64url') === cursor);
    const [version, activity, member, hash, ...extra] = raw.split(':');
    requireAcademic(
      version === '1' && !extra.length && hash === binding(context, offering, result),
    );
    result.after = [academicId(activity), academicId(member)];
  }
  return result;
}
export function followupCursor(
  context: AcademicContext,
  offering: string,
  query: FollowupQuery,
  row: FollowupRow,
) {
  return Buffer.from(
    `1:${row.activityId}:${row.membershipId}:${binding(context, offering, query)}`,
  ).toString('base64url');
}
