/** Only the dedicated SQL service connection publishes. No teacher session is retained or impersonated. */
import { randomBytes, createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { Pool } from 'pg';
import type { AutoEngine } from './native';
import type { AutoInput } from '../../domain/autograde/model';
export class AutoGradeWorker {
  private jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private stopped = false;
  private tenants = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  constructor(
    private readonly pool: Pool,
    private readonly engine: AutoEngine,
    private readonly observe: (code: string) => void = () => {},
  ) {}
  capability() {
    return this.engine.capability();
  }
  register(tenant: string) {
    this.tenants.add(tenant);
  }
  start(tenants: string[]) {
    for (const t of tenants) this.register(t);
    this.timer = setInterval(() => void this.poll(), 1000);
  }
  private async poll() {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      for (const tenant of this.tenants) {
        if (this.jobs.size >= 2) break;
        const rows = (await this.pool.query('SELECT * FROM zhiban_autograde.pending($1)', [tenant]))
          .rows;
        for (const r of rows) {
          if (this.jobs.size >= 2) break;
          await this.enqueue(tenant, r.submission_id);
        }
      }
    } catch {
      this.observe('QUEUE_UNAVAILABLE');
    } finally {
      this.polling = false;
    }
  }
  async enqueue(tenant: string, submission: string) {
    if (this.stopped) return;
    const key = tenant + ':' + submission;
    if (this.jobs.has(key) || this.jobs.size >= 2) return;
    const controller = new AbortController(),
      job = { controller, done: Promise.resolve() };
    this.jobs.set(key, job);
    job.done = this.run(tenant, submission, controller).finally(() => this.jobs.delete(key));
  }
  private async run(tenant: string, submission: string, controller: AbortController) {
    const secret = randomBytes(32).toString('base64url'),
      hash = createHash('sha256').update(secret).digest('hex');
    let id: string | null = null,
      phase = 'MODEL_FAILED';
    try {
      const p = (
        await this.pool.query('SELECT zhiban_autograde.prepare($1,$2,$3,$4,$5) AS value', [
          tenant,
          submission,
          v7(),
          hash,
          v7(),
        ])
      ).rows[0].value;
      if (!p.dispatch) return;
      id = p.id;
      const result = await this.engine.generate(
        p.input as AutoInput,
        AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
      );
      phase = 'AUTHORITY_OR_SOURCE_CHANGED';
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT zhiban_autograde.apply($1,$2,$3,$4,$5,$6,$7)', [
          tenant,
          id,
          secret,
          JSON.stringify(result),
          v7(),
          v7(),
          v7(),
        ]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch {
      this.observe(id ? phase : 'PREPARE_REFUSED');
      if (!id)
        await this.pool
          .query('SELECT zhiban_autograde.reject_request($1,$2)', [tenant, submission])
          .catch(() => this.observe('FAILURE_AUDIT_UNAVAILABLE'));
      if (id)
        await this.pool
          .query('SELECT zhiban_autograde.fail($1,$2,$3,$4,$5)', [
            tenant,
            id,
            secret,
            controller.signal.aborted && this.stopped ? 'HOST_STOPPED' : phase,
            v7(),
          ])
          .catch(() => this.observe('FAILURE_AUDIT_UNAVAILABLE'));
    }
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const j of this.jobs.values()) j.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
  }
}
