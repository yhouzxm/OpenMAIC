import { createHmac, randomBytes } from 'node:crypto';
import { academicId, requireAcademic } from '../../domain/academic/model';
import { autoCommand } from '../../domain/autograde/model';
import type { AcademicContext, AcademicStore } from '../academic/service';
import type { AutoGradeWorker } from '../../infrastructure/autograde/worker';
export class AutoGradeService {
  private key = randomBytes(32);
  constructor(
    private readonly store: AcademicStore,
    private readonly worker: AutoGradeWorker,
    private readonly enabled = false,
  ) {}
  async read(x: AcademicContext, o: string, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(
      Object.keys(input).every((k) => ['mode', 'view', 'cursor', 'activity'].includes(k)) &&
        (input.mode === 'TEACHER' || input.mode === 'STUDENT'),
    );
    const mode = input.mode,
      view = input.view ?? 'POLICIES';
    requireAcademic(['POLICIES', 'JOBS', 'APPEALS'].includes(view));
    const activity = input.activity ? academicId(input.activity) : null;
    requireAcademic(!activity || view === 'POLICIES');
    const bind = JSON.stringify([x.tenantId, x.actorMembershipId, o, mode, view, activity]),
      mac = (s: string) => createHmac('sha256', this.key).update(bind).update(s).digest('hex');
    let after: string | null = null;
    if (input.cursor) {
      requireAcademic(/^[A-Za-z0-9_-]{1,256}$/.test(input.cursor));
      const [id, sig, ...rest] = Buffer.from(input.cursor, 'base64url').toString().split(':');
      requireAcademic(!rest.length && sig === mac(id));
      after = academicId(id);
    }
    const p = await this.store.run(x, null, (a, t) => {
      requireAcademic(t.autograde, 'UNAVAILABLE');
      return t.autograde.read(a, o, mode, view, after, activity);
    });
    this.worker.register(x.tenantId);
    return {
      ...p,
      next: p.next ? Buffer.from(p.next + ':' + mac(p.next)).toString('base64url') : null,
      ...(mode === 'TEACHER' ? { capability: await this.worker.capability() } : {}),
    };
  }
  async execute(x: AcademicContext, o: string, value: unknown, key: string) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = autoCommand(value);
    let model: { provider: string; model: string } | null = null;
    if (c.type === 'ENABLE') {
      await this.store.run(x, null, async (a, t) => {
        requireAcademic(t.autograde, 'UNAVAILABLE');
        await t.autograde.read(a, o, 'TEACHER', 'POLICIES', null);
      });
      const p = await this.worker.capability();
      requireAcademic(p.ready && p.provider && p.model, 'UNAVAILABLE');
      model = { provider: p.provider, model: p.model };
    }
    const result = await this.store.run(x, null, (a, t) => {
      requireAcademic(t.autograde, 'UNAVAILABLE');
      return t.autograde.execute(a, o, c, key, model);
    });
    this.worker.register(x.tenantId);
    return result;
  }
}
