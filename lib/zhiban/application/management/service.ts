import { createHash } from 'node:crypto';
import type { AcademicContext, AcademicStore } from '../academic/service';
import {
  academicAdmin,
  academicId,
  academicText,
  AcademicError,
  requireAcademic,
  type AcademicActor,
} from '../../domain/academic/model';
/** Committed Academic command types only; other domain/security logs are outside this view. */
export const managementAuditEvents = [
  'CREATE_TERM',
  'CREATE_COURSE',
  'EDIT_COURSE',
  'PUBLISH_COURSE',
  'ARCHIVE_COURSE',
  'CREATE_CLASS',
  'CLASS_MEMBER',
  'CLASS_HEAD_TEACHER',
  'CREATE_OFFERING',
  'UPDATE_OFFERING',
  'PREPARE_TEACHER',
  'ASSIGN_TEACHER',
  'END_TEACHER',
  'ENROLL',
  'WITHDRAW',
  'TRANSFER',
] as const;
function auditDate(value: string | undefined): number | null {
  if (value === undefined) return null;
  requireAcademic(/^\d{4}-\d{2}-\d{2}$/.test(value));
  const n = Date.parse(value + 'T00:00:00.000Z');
  requireAcademic(Number.isFinite(n) && n >= 0 && new Date(n).toISOString().slice(0, 10) === value);
  return n;
}
export interface ManagementQuery {
  kind:
    | 'offerings'
    | 'enrollments'
    | 'courses'
    | 'terms'
    | 'classes'
    | 'assignments'
    | 'class-members'
    | 'teachers'
    | 'owner-candidates'
    | 'history';
  q: string;
  state: string;
  limit: number;
  offering: string | null;
  source: string | null;
  member: string | null;
  classId: string | null;
  after: string | null;
  event?: string;
  from?: number | null;
  through?: number | null;
  courseId?: string | null;
  purpose?: 'CREATE_COURSE' | 'EDIT_COURSE';
}
export interface ManagementPage {
  rows: Record<string, unknown>[];
  offering: Record<string, unknown> | null;
  next: string | null;
  classInfo?: Record<string, unknown> | null;
}
export interface ManagementTransaction {
  read(actor: AcademicActor, query: ManagementQuery): Promise<ManagementPage>;
}
function binding(context: AcademicContext, query: ManagementQuery) {
  const { classId, ...position } = query;
  return createHash('sha256')
    .update(
      JSON.stringify([
        context.tenantId,
        context.actorMembershipId,
        { ...position, after: null, ...(classId === null ? {} : { classId }) },
      ]),
    )
    .digest('hex');
}
/** A filter-bound continuation position; never an authorization capability or snapshot. */
export function managementQuery(
  context: AcademicContext,
  kind: ManagementQuery['kind'],
  input: Record<string, string>,
): ManagementQuery {
  requireAcademic(
    Object.keys(input).every((k) =>
      [
        'q',
        'state',
        'limit',
        'cursor',
        ...(kind === 'offerings'
          ? ['source']
          : kind === 'enrollments' || kind === 'assignments'
            ? ['offering', 'member']
            : kind === 'class-members'
              ? ['classId', 'member']
              : kind === 'teachers'
                ? ['offering', 'classId']
                : kind === 'owner-candidates'
                  ? ['purpose', 'courseId']
                  : kind === 'history'
                    ? ['event', 'from', 'through']
                    : []),
      ].includes(k),
    ),
  );
  let q = academicText((input.q ?? '').trim(), 120, true);
  requireAcademic(q.isWellFormed());
  if (['teachers', 'owner-candidates', 'history'].includes(kind) && /^[0-9a-f-]{36}$/i.test(q))
    q = academicId(q.toLowerCase());
  const limit = input.limit ?? '20',
    state =
      input.state ??
      (['enrollments', 'assignments', 'class-members'].includes(kind)
        ? 'ACTIVE'
        : ['teachers', 'owner-candidates'].includes(kind)
          ? 'CURRENT'
          : 'ALL');
  requireAcademic(['10', '20', '50'].includes(limit));
  requireAcademic(
    (kind === 'offerings'
      ? ['ALL', 'OPEN', 'CLOSED']
      : kind === 'enrollments'
        ? ['ALL', 'ACTIVE', 'WITHDRAWN']
        : kind === 'assignments'
          ? ['ALL', 'ACTIVE', 'ENDED']
          : kind === 'class-members'
            ? ['ALL', 'ACTIVE', 'INACTIVE']
            : ['teachers', 'owner-candidates'].includes(kind)
              ? ['CURRENT']
              : kind === 'courses'
                ? ['ALL', 'DRAFT', 'PUBLISHED', 'ARCHIVED']
                : ['ALL']
    ).includes(state),
  );
  const query: ManagementQuery = {
    kind,
    q,
    state,
    limit: Number(limit),
    offering: ['enrollments', 'assignments'].includes(kind)
      ? academicId(input.offering)
      : kind === 'teachers' && input.offering !== undefined
        ? academicId(input.offering)
        : null,
    source: input.source ? academicId(input.source) : null,
    member: input.member ? academicId(input.member) : null,
    classId:
      kind === 'class-members'
        ? academicId(input.classId)
        : kind === 'teachers' && input.classId !== undefined
          ? academicId(input.classId)
          : null,
    after: null,
  };
  if (kind === 'history') {
    const event = input.event ?? 'ALL',
      from = auditDate(input.from),
      through = auditDate(input.through);
    requireAcademic(event === 'ALL' || managementAuditEvents.some((e) => e === event));
    requireAcademic(from === null || through === null || from <= through);
    query.event = event;
    query.from = from;
    query.through = through === null ? null : through + 86400000;
  }
  if (kind === 'owner-candidates') {
    requireAcademic(input.purpose === 'CREATE_COURSE' || input.purpose === 'EDIT_COURSE');
    requireAcademic(
      input.purpose === 'EDIT_COURSE' ? input.courseId !== undefined : input.courseId === undefined,
    );
    query.purpose = input.purpose;
    query.courseId = input.purpose === 'EDIT_COURSE' ? academicId(input.courseId) : null;
  }
  if (kind === 'teachers') requireAcademic((query.offering === null) !== (query.classId === null));
  if (input.cursor !== undefined) {
    requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(input.cursor));
    const raw = Buffer.from(input.cursor, 'base64url').toString('utf8');
    requireAcademic(Buffer.from(raw).toString('base64url') === input.cursor);
    const [version, id, hash, ...rest] = raw.split(':');
    requireAcademic(version === '1' && rest.length === 0 && hash === binding(context, query));
    query.after = academicId(id);
  }
  return query;
}
export function managementCursor(context: AcademicContext, query: ManagementQuery, id: string) {
  return Buffer.from(`1:${academicId(id)}:${binding(context, query)}`).toString('base64url');
}
export class ManagementService {
  constructor(private readonly store: AcademicStore) {}
  read(context: AcademicContext, kind: ManagementQuery['kind'], input: Record<string, string>) {
    const query = managementQuery(context, kind, input);
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(academicAdmin(actor), 'FORBIDDEN');
      if (!tx.management) throw new AcademicError('UNAVAILABLE');
      const page = await tx.management.read(actor, query);
      return {
        mode: 'ADMIN',
        rows: page.rows,
        offering: page.offering,
        nextCursor: page.next ? managementCursor(context, query, page.next) : null,
        asOf: actor.now,
        ...(page.classInfo === undefined ? {} : { classInfo: page.classInfo }),
      };
    });
  }
}
