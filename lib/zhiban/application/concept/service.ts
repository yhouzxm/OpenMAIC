import { createHmac, randomBytes } from 'node:crypto';
import type { AcademicActor } from '../../domain/academic/model';
import { academicId, requireAcademic } from '../../domain/academic/model';
import { conceptCommand, type ConceptCommand } from '../../domain/concept/model';
import type { AcademicContext, AcademicStore } from '../academic/service';
export interface ConceptQuery {
  mode: 'TEACHER' | 'STUDENT';
  view: 'SOURCES' | 'LIST' | 'DETAIL';
  id: string | null;
  q: string;
  state: string;
  after: string | null;
}
export interface ConceptTransaction {
  read(
    a: AcademicActor,
    o: string,
    q: ConceptQuery,
  ): Promise<{ rows: Record<string, unknown>[]; next: string | null; [key: string]: unknown }>;
  execute(a: AcademicActor, o: string, c: ConceptCommand, key: string): Promise<unknown>;
}
export class ConceptService {
  private readonly cursorKey = randomBytes(32);
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled = false,
  ) {}
  async read(context: AcademicContext, o: string, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(
      Object.keys(input).every((k) => ['mode', 'view', 'id', 'q', 'state', 'cursor'].includes(k)),
    );
    const mode = input.mode,
      view = input.view ?? 'LIST',
      state = input.state ?? 'ALL',
      q = (input.q ?? '').trim();
    requireAcademic(
      (mode === 'TEACHER' || mode === 'STUDENT') &&
        ['SOURCES', 'LIST', 'DETAIL'].includes(view) &&
        ['ALL', 'DRAFT', 'OPEN', 'RESOLVED', 'RETRACTED'].includes(state),
    );
    requireAcademic(q.length <= 120 && q.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(q));
    requireAcademic(view !== 'SOURCES' || mode === 'TEACHER');
    requireAcademic((view === 'DETAIL') === (input.id !== undefined));
    requireAcademic(mode !== 'STUDENT' || state !== 'DRAFT');
    const query: ConceptQuery = {
      mode,
      view: view as ConceptQuery['view'],
      id: input.id ? academicId(input.id) : null,
      q,
      state,
      after: null,
    };
    const bind = JSON.stringify([context.tenantId, context.actorMembershipId, o, query]);
    const mac = (id: string) =>
      createHmac('sha256', this.cursorKey).update(bind).update(id).digest('hex');
    if (input.cursor !== undefined) {
      requireAcademic(/^[A-Za-z0-9_-]{1,1024}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString('utf8'),
        [id, sig, ...rest] = raw.split(':');
      requireAcademic(
        !rest.length && sig === mac(id) && Buffer.from(raw).toString('base64url') === input.cursor,
      );
      query.after = id;
    }
    return this.store.run(context, null, async (a, tx) => {
      requireAcademic(tx.concept, 'UNAVAILABLE');
      const p = await tx.concept.read(a, o, query);
      return {
        ...p,
        next: p.next ? Buffer.from(p.next + ':' + mac(p.next)).toString('base64url') : null,
      };
    });
  }
  execute(context: AcademicContext, o: string, input: unknown, key: string) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = conceptCommand(input);
    const work = (a: AcademicActor, tx: import('../academic/service').AcademicTransaction) => {
      requireAcademic(tx.concept, 'UNAVAILABLE');
      return tx.concept.execute(a, o, c, key);
    };
    if (c.type === 'PUBLISH_CORRECTION' || c.type === 'REVISE_FEEDBACK') {
      requireAcademic(this.store.runForConceptRecipient, 'UNAVAILABLE');
      return this.store.runForConceptRecipient(context, o, c.id, work);
    }
    return this.store.run(context, null, work);
  }
}
