import { createHmac, randomBytes } from 'node:crypto';
import { academicId, requireAcademic, type AcademicActor } from '../../domain/academic/model';
import { learnerCommand, type LearnerCommand } from '../../domain/learner/model';
import type { AcademicContext, AcademicStore } from '../academic/service';
export interface LearnerQuery {
  mode: 'TEACHER' | 'STUDENT';
  view: 'ROSTER' | 'OVERVIEW' | 'EVIDENCE' | 'NOTES' | 'NOTE' | 'DISPUTES' | 'DISPUTE';
  enrollmentId: string | null;
  id: string | null;
  q: string;
  state: string;
  kind: string;
  after: string | null;
}
export interface LearnerTransaction {
  read(
    a: AcademicActor,
    o: string,
    q: LearnerQuery,
  ): Promise<{ rows: Record<string, unknown>[]; next: string | null; [key: string]: unknown }>;
  execute(a: AcademicActor, o: string, c: LearnerCommand, key: string): Promise<unknown>;
}
export class LearnerService {
  private readonly cursorKey = randomBytes(32);
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled = false,
  ) {}
  async read(context: AcademicContext, o: string, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(
      Object.keys(input).every((k) =>
        ['mode', 'view', 'enrollment', 'id', 'q', 'state', 'kind', 'cursor'].includes(k),
      ),
    );
    const mode = input.mode,
      view = input.view ?? 'OVERVIEW',
      q = (input.q ?? '').trim(),
      state = input.state ?? 'ALL',
      kind = input.kind ?? 'ALL';
    requireAcademic(
      (mode === 'TEACHER' || mode === 'STUDENT') &&
        ['ROSTER', 'OVERVIEW', 'EVIDENCE', 'NOTES', 'NOTE', 'DISPUTES', 'DISPUTE'].includes(view),
    );
    requireAcademic(
      ['ALL', 'DRAFT', 'PUBLISHED', 'WITHDRAWN', 'OPEN', 'RESOLVED'].includes(state) &&
        ['ALL', 'GRADE', 'CONCEPT', 'REMEDIATION'].includes(kind),
    );
    requireAcademic(q.length <= 120 && q.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(q));
    requireAcademic((view === 'NOTE' || view === 'DISPUTE') === (input.id !== undefined));
    requireAcademic(
      mode !== 'STUDENT' || (!input.enrollment && view !== 'ROSTER' && state !== 'DRAFT'),
    );
    requireAcademic(view !== 'ROSTER' || (!input.id && !input.enrollment));
    requireAcademic(
      mode !== 'TEACHER' || ['ROSTER', 'NOTE', 'DISPUTE'].includes(view) || !!input.enrollment,
    );
    const query: LearnerQuery = {
      mode,
      view: view as LearnerQuery['view'],
      id: input.id ? academicId(input.id) : null,
      enrollmentId: input.enrollment ? academicId(input.enrollment) : null,
      q,
      state,
      kind,
      after: null,
    };
    const bind = JSON.stringify([context.tenantId, context.actorMembershipId, o, query]),
      mac = (s: string) =>
        createHmac('sha256', this.cursorKey).update(bind).update(s).digest('hex');
    if (input.cursor !== undefined) {
      requireAcademic(/^[A-Za-z0-9_-]{1,1024}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString('utf8'),
        [after, sig, ...rest] = raw.split(':');
      requireAcademic(
        !rest.length &&
          sig === mac(after) &&
          Buffer.from(raw).toString('base64url') === input.cursor,
      );
      query.after = after;
    }
    return this.store.run(context, null, async (a, tx) => {
      requireAcademic(tx.learner, 'UNAVAILABLE');
      const p = await tx.learner.read(a, o, query);
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
    const c = learnerCommand(input);
    const work = (a: AcademicActor, tx: import('../academic/service').AcademicTransaction) => {
      requireAcademic(tx.learner, 'UNAVAILABLE');
      return tx.learner.execute(a, o, c, key);
    };
    if (
      c.type === 'PUBLISH_OBSERVATION' ||
      c.type === 'REVISE_PUBLIC' ||
      (c.type === 'RESOLVE_DISPUTE' && c.outcome !== 'WITHDRAW')
    ) {
      requireAcademic(this.store.runForLearnerRecipient, 'UNAVAILABLE');
      return this.store.runForLearnerRecipient(
        context,
        o,
        c.id,
        c.type === 'RESOLVE_DISPUTE',
        work,
      );
    }
    return this.store.run(context, null, work);
  }
}
