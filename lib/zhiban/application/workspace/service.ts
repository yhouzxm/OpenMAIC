import { createHash } from 'node:crypto';
import type { AcademicContext, AcademicStore } from '../academic/service';
import {
  academicAdmin,
  academicStudent,
  academicId,
  academicText,
  AcademicError,
  requireAcademic,
  type AcademicActor,
} from '../../domain/academic/model';
export interface WorkspaceQuery {
  kind: 'courses' | 'roster' | 'teachers';
  q: string;
  state: 'ALL' | 'OPEN' | 'CLOSED';
  limit: number;
  offering: string | null;
  after: string | null;
}
export interface WorkspacePage {
  rows: Record<string, unknown>[];
  next: string | null;
}
export interface WorkspaceTransaction {
  read(actor: AcademicActor, query: WorkspaceQuery): Promise<WorkspacePage>;
}
function binding(context: AcademicContext, q: WorkspaceQuery) {
  return createHash('sha256')
    .update(JSON.stringify([context.tenantId, context.actorMembershipId, { ...q, after: null }]))
    .digest('hex');
}
export function workspaceQuery(
  context: AcademicContext,
  kind: WorkspaceQuery['kind'],
  input: Record<string, string>,
): WorkspaceQuery {
  requireAcademic(
    Object.keys(input).every((k) =>
      ['q', 'limit', 'cursor', ...(kind === 'courses' ? ['state'] : ['offering'])].includes(k),
    ),
  );
  const q = academicText((input.q ?? '').trim(), 120, true),
    limit = input.limit ?? '20',
    state = input.state ?? 'ALL';
  requireAcademic(
    q.isWellFormed() &&
      ['10', '20', '50'].includes(limit) &&
      ['ALL', 'OPEN', 'CLOSED'].includes(state),
  );
  const query: WorkspaceQuery = {
    kind,
    q,
    state: state as WorkspaceQuery['state'],
    limit: Number(limit),
    offering: kind !== 'courses' ? academicId(input.offering) : null,
    after: null,
  };
  if (input.cursor !== undefined) {
    requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(input.cursor));
    const raw = Buffer.from(input.cursor, 'base64url').toString('utf8');
    requireAcademic(Buffer.from(raw).toString('base64url') === input.cursor);
    const [v, id, hash, ...extra] = raw.split(':');
    requireAcademic(v === '1' && extra.length === 0 && hash === binding(context, query));
    query.after = academicId(id);
  }
  return query;
}
export function workspaceCursor(context: AcademicContext, q: WorkspaceQuery, id: string) {
  return Buffer.from(`1:${academicId(id)}:${binding(context, q)}`).toString('base64url');
}
/** Presentation only: resource access continues to use the existing scoped checks. */
export function workspaceRoles(actor: AcademicActor): string[] {
  const roles: string[] = [];
  if (academicAdmin(actor)) roles.push('ADMIN');
  if (
    actor.grants.some(
      (g) =>
        g.roleCode === 'TEACHER' &&
        g.validFrom <= actor.now &&
        (g.validUntil === null || g.validUntil > actor.now) &&
        ((g.scopeKind === 'TENANT' && g.scopeId === null) ||
          (['COURSE', 'CLASS'].includes(g.scopeKind) && g.scopeId !== null)),
    )
  )
    roles.push('TEACHER');
  if (academicStudent(actor)) roles.push('STUDENT');
  return roles;
}
export class WorkspaceService {
  constructor(private readonly store: AcademicStore) {}
  read(context: AcademicContext, kind: WorkspaceQuery['kind'], input: Record<string, string>) {
    const query = workspaceQuery(context, kind, input);
    return this.store.run(context, null, async (actor, tx) => {
      if (kind === 'courses' && academicAdmin(actor))
        return {
          mode: 'ADMIN' as const,
          roles: workspaceRoles(actor),
          rows: [],
          nextCursor: null,
          asOf: actor.now,
        };
      if (!tx.workspace) throw new AcademicError('UNAVAILABLE');
      const page = await tx.workspace.read(actor, query);
      return {
        mode: 'MEMBER' as const,
        roles: workspaceRoles(actor),
        rows: page.rows,
        nextCursor: page.next ? workspaceCursor(context, query, page.next) : null,
        asOf: actor.now,
      };
    });
  }
}
