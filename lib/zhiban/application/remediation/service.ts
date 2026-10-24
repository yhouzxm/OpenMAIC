import { createHmac, randomBytes } from 'node:crypto';
import type { AcademicActor } from '../../domain/academic/model';
import { academicId, requireAcademic } from '../../domain/academic/model';
import { remediationCommand, type RemediationCommand } from '../../domain/remediation/model';
import type { AcademicContext, AcademicStore } from '../academic/service';
export interface RemediationQuery {
  mode: 'TEACHER' | 'STUDENT';
  caseId: string | null;
  id: string | null;
  options: boolean;
  q: string;
  after: string | null;
}
export interface RemediationTransaction {
  read(
    actor: AcademicActor,
    offering: string,
    query: RemediationQuery,
  ): Promise<{
    rows: Record<string, unknown>[];
    next: string | null;
    record?: Record<string, unknown>;
    tasks?: Record<string, unknown>[];
  }>;
  execute(
    actor: AcademicActor,
    offering: string,
    command: RemediationCommand,
    key: string,
  ): Promise<unknown>;
}
export class RemediationService {
  private readonly cursorKey = randomBytes(32);
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled = false,
  ) {}
  async read(context: AcademicContext, offering: string, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(offering);
    requireAcademic(
      Object.keys(input).every((k) => ['mode', 'case', 'id', 'options', 'q', 'cursor'].includes(k)),
    );
    const mode = input.mode;
    requireAcademic(mode === 'TEACHER' || mode === 'STUDENT');
    const query: RemediationQuery = {
      mode,
      caseId: input.case === undefined ? null : academicId(input.case),
      id: input.id === undefined ? null : academicId(input.id),
      options: input.options === '1',
      q: (input.q ?? '').trim(),
      after: null,
    };
    requireAcademic(
      (input.options === undefined || input.options === '1') &&
        query.q.length <= 120 &&
        query.q.isWellFormed() &&
        !/[\u0000-\u001f\u007f]/.test(query.q),
    );
    requireAcademic(
      (!query.options || (mode === 'TEACHER' && !query.id && !query.caseId)) &&
        (!query.caseId || mode === 'TEACHER') &&
        (!query.q || query.options),
    );
    const bind = JSON.stringify([context.tenantId, context.actorMembershipId, offering, query]);
    const mac = (id: string) =>
      createHmac('sha256', this.cursorKey).update(bind).update(id).digest('hex');
    if (input.cursor !== undefined) {
      requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString('utf8'),
        [id, sig, ...rest] = raw.split(':');
      requireAcademic(
        !rest.length && sig === mac(id) && Buffer.from(raw).toString('base64url') === input.cursor,
      );
      query.after = academicId(id);
    }
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(tx.remediation, 'UNAVAILABLE');
      const p = await tx.remediation.read(actor, offering, query);
      return {
        ...p,
        next: p.next ? Buffer.from(p.next + ':' + mac(p.next)).toString('base64url') : null,
      };
    });
  }
  execute(context: AcademicContext, offering: string, input: unknown, key: string) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(offering);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = remediationCommand(input);
    const work = (actor: AcademicActor, tx: import('../academic/service').AcademicTransaction) => {
      requireAcademic(tx.remediation, 'UNAVAILABLE');
      return tx.remediation.execute(actor, offering, c, key);
    };
    if (c.type === 'ASSIGN_PLAN') {
      requireAcademic(this.store.runForFollowupRecipient, 'UNAVAILABLE');
      return this.store.runForFollowupRecipient(context, offering, c.caseId, work);
    }
    return this.store.run(context, null, work);
  }
}
