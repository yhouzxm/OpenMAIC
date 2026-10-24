import { createHmac, randomBytes } from 'node:crypto';
import { academicId, requireAcademic } from '../../domain/academic/model';
import { attainmentCommand } from '../../domain/attainment/model';
import type { AcademicContext, AcademicStore } from '../academic/service';
import type { AttainmentQuery } from '../../infrastructure/attainment/postgres/transaction';
export class AttainmentService {
  private key = randomBytes(32);
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled = false,
  ) {}
  async read(x: AcademicContext, _offering: string, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    requireAcademic(
      Object.keys(input).every((k) =>
        ['mode', 'view', 'offering', 'member', 'id', 'q', 'cursor'].includes(k),
      ),
    );
    requireAcademic(['ADMIN', 'TEACHER', 'STUDENT'].includes(input.mode));
    const view = input.view ?? 'RECORDS';
    requireAcademic(['RECORDS', 'RULES', 'TOTAL', 'DETAIL', 'COURSES', 'OFFERINGS'].includes(view));
    requireAcademic(
      input.mode !== 'STUDENT' ||
        (!input.member && !input.offering && ['RECORDS', 'DETAIL'].includes(view)),
    );
    requireAcademic((view === 'DETAIL') === (input.id !== undefined));
    const q: AttainmentQuery = {
      mode: input.mode as AttainmentQuery['mode'],
      view: view as AttainmentQuery['view'],
      offering: input.offering ? academicId(input.offering) : null,
      member: input.member ? academicId(input.member) : null,
      id: input.id ? academicId(input.id) : null,
      q: (input.q ?? '').trim(),
      after: null,
    };
    requireAcademic(q.q.length <= 120 && !/[\u0000-\u001f\u007f]/.test(q.q));
    const bind = JSON.stringify([x.tenantId, x.actorMembershipId, q]),
      mac = (s: string) => createHmac('sha256', this.key).update(bind).update(s).digest('hex');
    if (input.cursor) {
      requireAcademic(/^[A-Za-z0-9_-]{1,256}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString(),
        [id, sig, ...rest] = raw.split(':');
      requireAcademic(!rest.length && sig === mac(id));
      q.after = academicId(id);
    }
    return this.store.run(x, null, async (a, t) => {
      requireAcademic(t.attainment, 'UNAVAILABLE');
      const p = await t.attainment.read(a, q);
      return {
        ...p,
        next: p.next ? Buffer.from(p.next + ':' + mac(p.next)).toString('base64url') : null,
      };
    });
  }
  execute(x: AcademicContext, _offering: string, value: unknown, key: string) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = attainmentCommand(value);
    const work = (
      a: import('../../domain/academic/model').AcademicActor,
      t: import('../academic/service').AcademicTransaction,
    ) => {
      requireAcademic(t.attainment, 'UNAVAILABLE');
      return t.attainment.execute(a, c, key);
    };
    if ('memberId' in c) {
      requireAcademic(this.store.runForRelated, 'UNAVAILABLE');
      return this.store.runForRelated(x, c.memberId, work);
    }
    return this.store.run(x, null, work);
  }
}
