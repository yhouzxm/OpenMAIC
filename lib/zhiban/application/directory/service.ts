import { createHash } from 'node:crypto';
import type { AcademicContext, AcademicStore } from '../academic/service';
import {
  AcademicError,
  academicAdmin,
  academicId,
  academicText,
  requireAcademic,
  type AcademicActor,
} from '../../domain/academic/model';
export interface DirectoryQuery {
  q: string;
  state: 'CURRENT' | 'ALL';
  limit: number;
  after: string | null;
}
export interface DirectoryStudent {
  membershipId: string;
  name: string | null;
  membershipStatus: string;
  studentGrantActive: boolean;
}
export interface DirectoryPage {
  students: DirectoryStudent[];
  next: string | null;
}
export interface DirectoryTransaction {
  read(actor: AcademicActor, query: DirectoryQuery): Promise<DirectoryPage>;
}
function fingerprint(context: AcademicContext, q: string, state: string, limit: number) {
  return createHash('sha256')
    .update(JSON.stringify([context.tenantId, context.actorMembershipId, q, state, limit]))
    .digest('hex');
}
/** Continuation position only, never an authorization token or immutable list snapshot. */
export function directoryQuery(
  context: AcademicContext,
  input: Record<string, string>,
): DirectoryQuery {
  requireAcademic(Object.keys(input).every((k) => ['q', 'state', 'limit', 'cursor'].includes(k)));
  let q = academicText((input.q ?? '').trim(), 120, true);
  requireAcademic(q.isWellFormed());
  if (/^[0-9a-f-]{36}$/i.test(q)) q = academicId(q.toLowerCase());
  const state = input.state ?? 'CURRENT',
    limit = input.limit ?? '20';
  requireAcademic(state === 'CURRENT' || state === 'ALL');
  requireAcademic(['10', '20', '50'].includes(limit));
  let after: string | null = null;
  if (input.cursor !== undefined) {
    requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(input.cursor));
    const decoded = Buffer.from(input.cursor, 'base64url').toString('utf8');
    requireAcademic(Buffer.from(decoded, 'utf8').toString('base64url') === input.cursor);
    const [version, id, binding, ...extra] = decoded.split(':');
    requireAcademic(
      version === '1' &&
        extra.length === 0 &&
        binding === fingerprint(context, q, state, Number(limit)),
    );
    after = academicId(id);
  }
  return { q, state, limit: Number(limit), after };
}
export function directoryCursor(context: AcademicContext, q: DirectoryQuery, id: string): string {
  return Buffer.from(`1:${academicId(id)}:${fingerprint(context, q.q, q.state, q.limit)}`).toString(
    'base64url',
  );
}
export class DirectoryService {
  constructor(private readonly store: AcademicStore) {}
  read(context: AcademicContext, input: Record<string, string>) {
    const query = directoryQuery(context, input);
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(academicAdmin(actor), 'FORBIDDEN');
      if (!tx.directory) throw new AcademicError('UNAVAILABLE');
      const page = await tx.directory.read(actor, query);
      return {
        mode: 'ADMIN' as const,
        students: page.students,
        nextCursor: page.next ? directoryCursor(context, query, page.next) : null,
        asOf: actor.now,
      };
    });
  }
}
