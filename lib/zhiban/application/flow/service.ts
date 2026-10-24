import { academicId, requireAcademic } from '../../domain/academic/model';
import { flowCommand, type FlowCommand } from '../../domain/flow/model';
import { simulationModels } from '../../domain/flow/simulation';
import type { ClassroomLecture } from '../../domain/classroom/model';
import type { AcademicContext, AcademicStore } from '../academic/service';
export class FlowService {
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled = false,
    private readonly executorSourceSha256?: string,
  ) {}
  read(x: AcademicContext, o: string, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(
      Object.keys(input).every((k) => ['classroom', 'notebook', 'after'].includes(k)),
    );
    requireAcademic(
      Object.keys(input).length <= 1 ||
        (Object.keys(input).length === 2 && !!input.notebook && !!input.after),
    );
    for (const [k, v] of Object.entries(input))
      if (k === 'after' && input.notebook) requireAcademic(/^[1-9][0-9]{0,14}$/.test(v));
      else academicId(v);
    return this.store.run(x, null, async (a, t) => {
      requireAcademic(t.flow, 'UNAVAILABLE');
      const result = await t.flow.read(a, o, {
        classroomId: input.classroom ?? null,
        notebookId: input.notebook ?? null,
        after: input.after ?? null,
      });
      return { ...result, simulationModels: this.executorSourceSha256 ? simulationModels : [] };
    });
  }
  parse(input: unknown) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    return flowCommand(input);
  }
  publication(x: AcademicContext, o: string, c: FlowCommand, key: string) {
    academicId(o);
    return this.store.run(x, null, (a, t) => {
      requireAcademic(this.enabled && t.flow, 'UNAVAILABLE');
      return t.flow.publication(a, o, c, key);
    });
  }
  command(
    x: AcademicContext,
    o: string,
    c: FlowCommand,
    key: string,
    lectures: ClassroomLecture[],
  ) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    return this.store.run(x, null, (a, t) => {
      requireAcademic(t.flow, 'UNAVAILABLE');
      if (
        c.type === 'RUN_SIMULATION' ||
        (c.type === 'SAVE_PLAN' && c.steps.some((s) => s.lab?.execution))
      )
        requireAcademic(this.executorSourceSha256, 'UNAVAILABLE');
      return t.flow.execute(a, o, c, key, lectures, this.executorSourceSha256);
    });
  }
}
