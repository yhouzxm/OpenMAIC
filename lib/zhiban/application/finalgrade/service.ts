import { academicId, requireAcademic, type AcademicActor } from '../../domain/academic/model';
import { finalGradeCommand, type FinalGradeCommand } from '../../domain/finalgrade/model';
import type { AcademicStore, AcademicContext, AcademicTransaction } from '../academic/service';
export type FinalQuery = {
  member: string | null;
  after: string | null;
  view: 'TOTALS' | 'APPEALS';
};
export interface FinalGradeTransaction {
  read(a: AcademicActor, o: string, q: FinalQuery): Promise<Record<string, unknown>>;
  execute(
    a: AcademicActor,
    o: string,
    c: FinalGradeCommand,
    key: string,
  ): Promise<Record<string, unknown>>;
}
export class FinalGradeService {
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled: boolean,
  ) {}
  read(context: AcademicContext, o: string, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(Object.keys(input).every((k) => ['member', 'after', 'view'].includes(k)));
    const q: FinalQuery = {
      member: input.member ? academicId(input.member) : null,
      after: input.after ? academicId(input.after) : null,
      view: (input.view ?? 'TOTALS') as FinalQuery['view'],
    };
    requireAcademic(['TOTALS', 'APPEALS'].includes(q.view));
    return this.store.run(context, null, (a, tx) => {
      requireAcademic(tx.finalgrade, 'UNAVAILABLE');
      return tx.finalgrade.read(a, o, q);
    });
  }
  execute(context: AcademicContext, o: string, input: unknown, key: string) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = finalGradeCommand(input);
    const work = (a: AcademicActor, tx: AcademicTransaction) => {
      requireAcademic(tx.finalgrade, 'UNAVAILABLE');
      return tx.finalgrade.execute(a, o, c, key);
    };
    if ('memberId' in c) {
      requireAcademic(this.store.runForRelated, 'UNAVAILABLE');
      return this.store.runForRelated(context, c.memberId, work);
    }
    return this.store.run(context, null, work);
  }
}
