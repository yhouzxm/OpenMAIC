import { createHash } from 'node:crypto';
import type { AcademicContext } from '../academic/service';
import { academicId, academicText, requireAcademic } from '../../domain/academic/model';
export type RecordKind = 'activities' | 'attempts' | 'submissions' | 'publications' | 'queue';
export interface RecordQuery {
  kind: RecordKind;
  exactId?: string;
  activityType?: string;
  target: string | null;
  q: string;
  state: string;
  member: string | null;
  limit: number;
  after: string | null;
}
export interface RecordPage {
  mode: 'TEACHER' | 'STUDENT';
  offeringId: string;
  rows: Record<string, unknown>[];
  next: string | null;
  grades?: Record<string, unknown>[];
  review?: Record<string, unknown>;
}
const targetKey = {
  activities: null,
  attempts: 'activity',
  submissions: 'attempt',
  publications: 'submission',
  queue: 'activity',
};
export function recordQuery(kind: RecordKind, input: Record<string, string>): RecordQuery {
  const target = targetKey[kind];
  requireAcademic(
    Object.keys(input).every((k) =>
      [
        'limit',
        'cursor',
        ...(target ? [target] : []),
        ...(kind === 'queue'
          ? ['q', 'state', 'member', 'activityType']
          : kind === 'activities'
            ? ['q', 'state']
            : kind === 'attempts'
              ? ['state', 'member', 'id']
              : []),
      ].includes(k),
    ),
  );
  const q = academicText((input.q ?? '').trim(), 120, true),
    state = input.state ?? (kind === 'queue' ? 'TODO' : 'ALL');
  requireAcademic(q.isWellFormed() && ['10', '20', '50'].includes(input.limit ?? '20'));
  requireAcademic(
    (kind === 'queue'
      ? ['TODO', 'UNSCORED', 'DRAFT', 'PUBLISHED', 'ALL', 'MANUAL']
      : kind === 'activities'
        ? ['ALL', 'DRAFT', 'PUBLISHED', 'WITHDRAWN']
        : kind === 'attempts'
          ? ['ALL', 'IN_PROGRESS', 'SUBMITTED']
          : ['ALL']
    ).includes(state),
  );
  if (kind === 'queue')
    requireAcademic(['ALL', 'TEXT_RESPONSE', 'QUIZ'].includes(input.activityType ?? 'ALL'));
  return {
    kind,
    ...(kind === 'queue' && input.activityType !== undefined
      ? { activityType: input.activityType }
      : {}),
    ...(input.id === undefined ? {} : { exactId: academicId(input.id) }),
    target:
      target && (kind !== 'queue' || input[target] !== undefined)
        ? academicId(input[target])
        : null,
    q,
    state,
    member: input.member === undefined ? null : academicId(input.member),
    limit: Number(input.limit ?? '20'),
    after: null,
  };
}
function binding(context: AcademicContext, offering: string, query: RecordQuery) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        context.tenantId,
        context.actorMembershipId,
        offering,
        { ...query, after: null },
      ]),
    )
    .digest('hex');
}
export function recordCursor(
  context: AcademicContext,
  offering: string,
  query: RecordQuery,
  id: string,
) {
  return Buffer.from(`1:${academicId(id)}:${binding(context, offering, query)}`).toString(
    'base64url',
  );
}
export function readRecordCursor(
  context: AcademicContext,
  offering: string,
  query: RecordQuery,
  cursor?: string,
) {
  if (cursor === undefined) return query;
  requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(cursor));
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  requireAcademic(Buffer.from(raw).toString('base64url') === cursor);
  const [v, id, hash, ...extra] = raw.split(':');
  requireAcademic(v === '1' && !extra.length && hash === binding(context, offering, query));
  return { ...query, after: academicId(id) };
}
