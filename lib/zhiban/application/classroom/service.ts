import type { AcademicContext, AcademicStore } from '../academic/service';
import { academicId, requireAcademic } from '../../domain/academic/model';
import { classroomCommand, type ClassroomLecture } from '../../domain/classroom/model';
export class ClassroomService {
  constructor(
    private readonly store: AcademicStore,
    private readonly jointEnabled = false,
  ) {}
  results(context: AcademicContext, offering: string, page: string | undefined) {
    academicId(offering);
    requireAcademic(page === undefined || /^(0|[1-9][0-9]{0,3})$/.test(page));
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.classroom, 'UNAVAILABLE');
      return tx.classroom!.results(actor, offering, Number(page ?? 0));
    });
  }
  jointTarget(context: AcademicContext, offering: string, session: string, dispatch: string) {
    requireAcademic(this.jointEnabled, 'UNAVAILABLE');
    [offering, session, dispatch].forEach(academicId);
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.classroom, 'UNAVAILABLE');
      return tx.classroom!.jointTarget(actor, offering, session, dispatch);
    });
  }
  read(context: AcademicContext, offering: string, lectures: ClassroomLecture[]) {
    academicId(offering);
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.classroom, 'UNAVAILABLE');
      return tx.classroom!.read(actor, offering, lectures, this.jointEnabled);
    });
  }
  command(
    context: AcademicContext,
    offering: string,
    input: unknown,
    key: string,
    lectures: ClassroomLecture[],
  ) {
    academicId(offering);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const command = classroomCommand(input);
    requireAcademic(command.type !== 'DISPATCH_JOINT_TASK' || this.jointEnabled, 'UNAVAILABLE');
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.classroom, 'UNAVAILABLE');
      return tx.classroom!.execute(actor, offering, command, key, lectures, this.jointEnabled);
    });
  }
}
