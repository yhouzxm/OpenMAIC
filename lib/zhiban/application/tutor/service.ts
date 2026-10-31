import type { AgentTool } from '@earendil-works/pi-agent-core';
import { withServiceTenant } from '@/lib/server/service-scope';
import { registerServiceOwner } from '@/lib/zhiban/infrastructure/service-center/config';
import { createHmac, randomBytes } from 'node:crypto';
import { academicId, requireAcademic } from '../../domain/academic/model';
import { tutorCommand, digest, type TutorMode, type TutorSource } from '../../domain/tutor/model';
import type { AcademicContext, AcademicStore, AcademicTransaction } from '../academic/service';
import type { TutorEngine } from '../../infrastructure/tutor/native';
import type { TutorPgTransaction } from '../../infrastructure/tutor/postgres/transaction';
export interface TutorContent {
  tools?(
    x: AcademicContext,
    o: string,
    source: TutorSource | null,
    signal: AbortSignal,
    vision: boolean,
  ): Promise<AgentTool[]>;
  list(
    x: AcademicContext,
    o: string,
  ): Promise<{ id: string; title: string; publicationId: string; publicationNo: number }[]>;
  load(x: AcademicContext, o: string, resource: string): Promise<TutorSource>;
  guard<T>(
    x: AcademicContext,
    o: string,
    source: TutorSource | null,
    work: () => Promise<T>,
  ): Promise<T>;
}
export class TutorService {
  private readonly key = randomBytes(32);
  private readonly jobs = new Map<
    string,
    {
      controller: AbortController;
      offering: string;
      member: string;
      session: string;
      done: Promise<void>;
    }
  >();
  private reservations = 0;
  constructor(
    private readonly store: AcademicStore,
    private readonly content: TutorContent,
    private readonly engine: TutorEngine,
    private readonly enabled = false,
  ) {}
  private owner(x: AcademicContext, o: string) {
    return 'tutor:' + digest([x.tenantId, o, x.actorMembershipId]);
  }
  private tx<T>(
    x: AcademicContext,
    work: (a: Parameters<TutorPgTransaction['access']>[0], tx: TutorPgTransaction) => Promise<T>,
  ) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    return this.store.run(x, null, (a, tx: AcademicTransaction) => {
      requireAcademic(tx.tutor, 'UNAVAILABLE');
      return work(a, tx.tutor);
    });
  }
  async read(x: AcademicContext, o: string, input: Record<string, string>) {
    academicId(o);
    requireAcademic(
      Object.keys(input).every((k) => ['mode', 'id', 'cursor'].includes(k)) &&
        (input.mode === 'TEACHER' || input.mode === 'STUDENT'),
    );
    const mode = input.mode,
      id = input.id ? academicId(input.id) : null;
    requireAcademic(!(id && input.cursor));
    const bind = JSON.stringify([x.tenantId, x.actorMembershipId, o, mode]);
    const mac = (s: string) => createHmac('sha256', this.key).update(bind).update(s).digest('hex');
    let after: string | null = null;
    if (input.cursor !== undefined) {
      requireAcademic(/^[A-Za-z0-9_-]{1,256}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString(),
        parts = raw.split(':');
      requireAcademic(
        parts.length === 2 &&
          parts[1] === mac(parts[0]) &&
          Buffer.from(raw).toString('base64url') === input.cursor,
      );
      after = academicId(parts[0]);
    }
    const page = await this.tx(x, (a, t) => t.read(a, o, mode, id, after));
    const capability = await withServiceTenant(x.tenantId, () =>
      this.engine.capability(this.owner(x, o)),
    );
    return {
      ...page,
      next: page.next ? Buffer.from(page.next + ':' + mac(page.next)).toString('base64url') : null,
      capability,
      resources: id ? [] : await this.content.list(x, o),
    };
  }
  async execute(x: AcademicContext, o: string, value: unknown, key: string) {
    academicId(o);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = tutorCommand(value);
    // Authorize before reading model configuration or content. Never trust client owner/history/model.
    await this.tx(x, (a, t) => t.access(a, o, c.mode));
    let source: TutorSource | null = null;
    if (c.type === 'CREATE_SESSION' && c.resourceId)
      source = await this.content.load(x, o, c.resourceId);
    if (c.type === 'ASK') {
      const page = await this.tx(x, (a, t) => t.read(a, o, c.mode, c.id, null));
      source = (page as { session: { source: TutorSource | null } }).session.source;
      requireAcademic(
        (await withServiceTenant(x.tenantId, () => this.engine.capability(this.owner(x, o)))).ready,
        'UNAVAILABLE',
      );
    }
    this.reservations++;
    let accepted;
    try {
      accepted = await this.content.guard(x, o, source, () =>
        this.tx(x, (a, t) =>
          t.execute(a, o, c, key, source, this.jobs.size + this.reservations <= 4),
        ),
      );
    } finally {
      this.reservations--;
    }
    if (c.type === 'SET_POLICY' || c.type === 'CANCEL' || c.type === 'CLOSE_SESSION')
      for (const [id, job] of this.jobs) {
        if (
          job.offering === x.tenantId + ':' + o &&
          (c.type === 'SET_POLICY' ||
            (job.member === x.actorMembershipId &&
              job.session === c.id &&
              (c.type === 'CLOSE_SESSION' || id === c.turnId)))
        )
          job.controller.abort();
      }
    if (c.type === 'ASK' && accepted.dispatch) {
      const turnId = String(accepted.result.turnId),
        controller = new AbortController();
      const job = {
        controller,
        offering: x.tenantId + ':' + o,
        member: x.actorMembershipId,
        session: c.id,
        done: Promise.resolve(),
      };
      this.jobs.set(turnId, job);
      job.done = this.generate(x, o, c.mode, c.id, turnId, controller).finally(() =>
        this.jobs.delete(turnId),
      );
    }
    return accepted.result;
  }
  private async generate(
    x: AcademicContext,
    o: string,
    mode: TutorMode,
    id: string,
    turnId: string,
    controller: AbortController,
  ) {
    let answer: string | null = null,
      error: string | null = null,
      model: unknown = null,
      state: 'COMPLETED' | 'FAILED' | 'BLOCKED' = 'FAILED';
    let source: TutorSource | null = null;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        await this.tx(x, (a, t) => t.run(a, o, mode, id, turnId));
      } catch {
        controller.abort();
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => void check(), 3000);
    try {
      const run = await this.tx(x, (a, t) => t.run(a, o, mode, id, turnId));
      source = run.source;
      await this.content.guard(x, o, source, async () => {});
      if (controller.signal.aborted) throw Error('CANCELLED');
      const output = await withServiceTenant(x.tenantId, async () => {
        await registerServiceOwner(this.owner(x, o), x.tenantId);
        const capability = await this.engine.capability(this.owner(x, o));
        const tools =
          capability.tools && this.content.tools
            ? await this.content.tools(x, o, source, controller.signal, !!capability.vision)
            : [];
        return this.engine.generate(this.owner(x, o), run, controller.signal, tools);
      });
      requireAcademic(
        typeof output.text === 'string' &&
          output.text.trim().length > 0 &&
          output.text.length <= 16000 &&
          output.text.isWellFormed(),
        'UNAVAILABLE',
      );
      answer = output.text;
      model = output.model;
      state = 'COMPLETED';
    } catch {
      error = controller.signal.aborted
        ? 'CANCELLED_OR_AUTHORIZATION_CHANGED'
        : 'TUTOR_GENERATION_FAILED';
    } finally {
      clearInterval(timer);
    }
    try {
      await this.content.guard(x, o, source, () =>
        this.tx(x, (a, t) => t.finish(a, o, mode, id, turnId, { answer, state, error, model })),
      );
    } catch {
      // Provider completion is private and discarded if source/Identity is no longer authorized.
      // If Identity itself was revoked this transaction must also refuse: lease then expires, no resume.
      try {
        await this.tx(x, (a, t) =>
          t.finish(a, o, mode, id, turnId, {
            answer: null,
            state: 'BLOCKED',
            error: 'SOURCE_OR_AUTHORIZATION_CHANGED',
            model: null,
          }),
        );
      } catch {
        /* fail closed; expires without output */
      }
    }
  }
  async close() {
    for (const j of this.jobs.values()) j.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
  }
}
