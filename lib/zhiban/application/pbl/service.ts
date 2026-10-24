import { academicId, requireAcademic, type AcademicActor } from '../../domain/academic/model';
import { pblCommand } from '../../domain/pbl/model';
import type { AcademicContext, AcademicStore, AcademicTransaction } from '../academic/service';
export type PblQuery = {
  project: string | null;
  group: string | null;
  submission: string | null;
  kind: 'DETAIL' | 'REVISIONS' | 'EVALUATIONS';
  after: string | null;
};
export class PblService {
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled = false,
  ) {}
  read(x: AcademicContext, o: string, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(
      Object.keys(input).every((k) =>
        ['project', 'group', 'submission', 'kind', 'after'].includes(k),
      ),
    );
    const q: PblQuery = {
      project: input.project ? academicId(input.project) : null,
      group: input.group ? academicId(input.group) : null,
      submission: input.submission ? academicId(input.submission) : null,
      kind: (input.kind ?? 'DETAIL') as PblQuery['kind'],
      after: input.after ?? null,
    };
    requireAcademic(['DETAIL', 'REVISIONS', 'EVALUATIONS'].includes(q.kind));
    requireAcademic(!(q.project && q.group) && (!q.submission || !!q.group));
    requireAcademic(q.kind === 'DETAIL' || !!q.group);
    requireAcademic(q.kind !== 'EVALUATIONS' || !!q.submission);
    requireAcademic(q.kind !== 'REVISIONS' || !q.submission);
    if (q.after) {
      if (q.kind === 'DETAIL') academicId(q.after);
      else requireAcademic(/^[1-9][0-9]{0,14}$/.test(q.after));
    }
    return this.store.run(x, null, (a, t) => {
      requireAcademic(t.pbl, 'UNAVAILABLE');
      return t.pbl.read(a, o, q);
    });
  }
  execute(x: AcademicContext, o: string, input: unknown, key: string) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = pblCommand(input);
    const work = (a: AcademicActor, t: AcademicTransaction) => {
      requireAcademic(t.pbl, 'UNAVAILABLE');
      return t.pbl.execute(a, o, c, key);
    };
    requireAcademic(this.store.runForPbl, 'UNAVAILABLE');
    const groupId =
      ['SET_MEMBERS', 'SAVE_WORK', 'CONFIRM_WORK', 'RETRACT_CONFIRMATION', 'SUBMIT_GROUP'].includes(
        c.type,
      ) && 'id' in c
        ? c.id
        : null;
    return this.store.runForPbl(x, o, groupId, 'members' in c ? c.members : [], work);
  }
}
