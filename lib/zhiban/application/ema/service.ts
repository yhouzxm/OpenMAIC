import { createHmac, randomBytes } from 'node:crypto';
import { academicId, requireAcademic } from '../../domain/academic/model';
import { dimension, emaCommand } from '../../domain/ema/model';
import type { AcademicContext, AcademicStore } from '../academic/service';
import type { EmaEngine } from '../../infrastructure/ema/native';
import type { EmaPgTransaction, EmaQuery } from '../../infrastructure/ema/postgres/transaction';
export class EmaService {
  private readonly cursorKey = randomBytes(32);
  private readonly jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private reservations = 0;
  constructor(
    private readonly store: AcademicStore,
    private readonly engine: EmaEngine,
    private readonly enabled = false,
  ) {}
  private tx<T>(
    x: AcademicContext,
    work: (a: Parameters<EmaPgTransaction['read']>[0], tx: EmaPgTransaction) => Promise<T>,
  ) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    return this.store.run(x, null, (a, t) => {
      requireAcademic(t.ema, 'UNAVAILABLE');
      return work(a, t.ema);
    });
  }
  async read(x: AcademicContext, o: string, input: Record<string, string>) {
    academicId(o);
    requireAcademic(
      Object.keys(input).every((k) =>
        ['mode', 'view', 'enrollment', 'id', 'dimension', 'cursor'].includes(k),
      ),
    );
    requireAcademic(input.mode === 'TEACHER' || input.mode === 'STUDENT');
    const view = input.view ?? 'DIMENSIONS';
    requireAcademic(['DIMENSIONS', 'NOTES', 'JOBS', 'JOB'].includes(view));
    requireAcademic((view === 'JOB') === (input.id !== undefined));
    requireAcademic(
      input.mode !== 'STUDENT' || (!input.enrollment && !['JOBS', 'JOB'].includes(view)),
    );
    requireAcademic(input.mode !== 'TEACHER' || view === 'JOB' || !!input.enrollment);
    requireAcademic((view === 'NOTES') === (input.dimension !== undefined));
    const query: EmaQuery = {
      mode: input.mode,
      view: view as EmaQuery['view'],
      enrollment: input.enrollment ? academicId(input.enrollment) : null,
      id: input.id ? academicId(input.id) : null,
      dimension: input.dimension ? dimension(input.dimension) : null,
      after: null,
    };
    const bind = JSON.stringify([x.tenantId, x.actorMembershipId, o, query]);
    const mac = (s: string) =>
      createHmac('sha256', this.cursorKey).update(bind).update(s).digest('hex');
    if (input.cursor !== undefined) {
      requireAcademic(/^[A-Za-z0-9_-]{1,256}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString(),
        [id, sig, ...rest] = raw.split(':');
      requireAcademic(
        !rest.length && sig === mac(id) && Buffer.from(raw).toString('base64url') === input.cursor,
      );
      query.after = academicId(id);
    }
    const p = await this.tx(x, (a, t) => t.read(a, o, query));
    return {
      ...p,
      next: p.next ? Buffer.from(p.next + ':' + mac(p.next)).toString('base64url') : null,
      ...(input.mode === 'TEACHER' ? { capability: await this.engine.capability() } : {}),
    };
  }
  async execute(x: AcademicContext, o: string, value: unknown, key: string) {
    academicId(o);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = emaCommand(value);
    // Model configuration is consulted only after current course authorization.
    if (c.type === 'RUN') {
      await this.tx(x, (a, t) =>
        t.read(a, o, {
          mode: 'TEACHER',
          view: 'JOB',
          enrollment: null,
          id: c.id,
          dimension: null,
          after: null,
        }),
      );
      requireAcademic((await this.engine.capability()).ready, 'UNAVAILABLE');
      requireAcademic(this.jobs.size + this.reservations < 2, 'UNAVAILABLE');
    }
    this.reservations++;
    let accepted;
    try {
      accepted = await this.tx(x, (a, t) => t.execute(a, o, c, key));
    } finally {
      this.reservations--;
    }
    if (c.type === 'CANCEL') this.jobs.get(c.id)?.controller.abort();
    if (accepted.dispatch) {
      const run = accepted.dispatch,
        controller = new AbortController(),
        job = { controller, done: Promise.resolve() };
      this.jobs.set(run.id, job);
      job.done = (async () => {
        let result: Awaited<ReturnType<EmaEngine['generate']>> | null = null;
        try {
          result = await this.engine.generate(
            run,
            AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
          );
        } catch {
          /* Failure is persisted, never replaced by synthetic findings. */
        }
        try {
          await this.tx(x, (a, t) => t.finish(a, o, run, result));
        } catch {
          /* Revocation/cancellation/restart leaves no accepted output. Explicit expiry closes abandoned leases. */
        }
      })().finally(() => this.jobs.delete(run.id));
    }
    return accepted.result;
  }
  async stop() {
    for (const j of this.jobs.values()) j.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
  }
}
