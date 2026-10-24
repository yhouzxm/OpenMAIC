import { createHash } from 'node:crypto';
import type { AcademicContext } from '../academic/service';
import { academicId, academicText, requireAcademic } from '../../domain/academic/model';
export interface GradebookQuery {
  /** Internal bounded snapshot mode; never accepted as a client query key. */
  exportAll?: true;
  q: string;
  limit: number;
  activityLimit: number;
  after: string | null;
  activityAfter: string | null;
}
export const GRADEBOOK_EXPORT_LIMITS = Object.freeze({
  students: 500,
  activities: 100,
  records: 10000,
  bytes: 8 * 1024 * 1024,
});
export function gradebookExportQuery(input: Record<string, string>): GradebookQuery {
  requireAcademic(Object.keys(input).every((key) => key === 'q'));
  const q = academicText((input.q ?? '').trim(), 120, true);
  requireAcademic(q.isWellFormed());
  return {
    q,
    limit: GRADEBOOK_EXPORT_LIMITS.students,
    activityLimit: GRADEBOOK_EXPORT_LIMITS.activities,
    after: null,
    activityAfter: null,
    exportAll: true,
  };
}
export interface GradebookPage {
  mode: 'TEACHER';
  offeringId: string;
  asOf: number;
  activities: Record<string, unknown>[];
  rows: Record<string, unknown>[];
  next: string | null;
  activityNext: string | null;
}
function binding(context: AcademicContext, offering: string, q: GradebookQuery, axis: string) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        context.tenantId,
        context.actorMembershipId,
        offering,
        axis,
        q.q,
        q.limit,
        q.activityLimit,
      ]),
    )
    .digest('hex');
}
export function gradebookCursor(
  context: AcademicContext,
  offering: string,
  q: GradebookQuery,
  axis: 'student' | 'activity',
  id: string,
) {
  return Buffer.from(`1:${academicId(id)}:${binding(context, offering, q, axis)}`).toString(
    'base64url',
  );
}
export function gradebookQuery(
  context: AcademicContext,
  offering: string,
  input: Record<string, string>,
): GradebookQuery {
  requireAcademic(
    Object.keys(input).every((k) =>
      ['q', 'limit', 'activityLimit', 'cursor', 'activityCursor'].includes(k),
    ),
  );
  const q: GradebookQuery = {
    q: academicText((input.q ?? '').trim(), 120, true),
    limit: Number(input.limit ?? '20'),
    activityLimit: Number(input.activityLimit ?? '5'),
    after: null,
    activityAfter: null,
  };
  requireAcademic(
    q.q.isWellFormed() &&
      ['10', '20', '50'].includes(input.limit ?? '20') &&
      ['5', '10'].includes(input.activityLimit ?? '5'),
  );
  for (const [key, axis, field] of [
    ['cursor', 'student', 'after'],
    ['activityCursor', 'activity', 'activityAfter'],
  ] as const) {
    const cursor = input[key];
    if (cursor === undefined) continue;
    requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(cursor));
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    requireAcademic(Buffer.from(raw).toString('base64url') === cursor);
    const [v, id, hash, ...rest] = raw.split(':');
    requireAcademic(v === '1' && !rest.length && hash === binding(context, offering, q, axis));
    q[field] = academicId(id);
  }
  return q;
}
