import type { TenantContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { requireTenantContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { BridgeError, check } from './validation';
import type { QueryResult } from 'pg';

/** Bounded string-query interface: streaming/callback overloads are not admitted. */
export interface BridgePgClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<QueryResult<R>>;
  release(discard?: boolean): void;
}
export interface BridgePgPool {
  connect(): Promise<BridgePgClient>;
}
let admitted = 0;
/** Shared process bound, no queued promises. Permit precedes every pool acquisition. */
export async function admittedOperation<T>(work: (deadline: Deadline) => Promise<T>): Promise<T> {
  check(admitted < 2);
  admitted++;
  try {
    const deadline = new Deadline();
    return await deadline.wait(work(deadline));
  } catch {
    throw new BridgeError();
  } finally {
    admitted--;
  }
}
export class Deadline {
  readonly #start = performance.now();
  #expired = false;
  remaining() {
    const left = Math.floor(10_000 - (performance.now() - this.#start));
    check(!this.#expired && left > 0);
    return left;
  }
  assert() {
    this.remaining();
  }
  async wait<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.#expired = true;
            reject(new BridgeError());
          }, this.remaining());
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
/** Pins a fresh client; uncertain COMMIT is discarded; neither SQLSTATE nor cause escapes. */
export async function bridgeTransaction<T>(
  pool: BridgePgPool,
  context: TenantContext | null,
  deadline: Deadline,
  work: (client: BridgePgClient) => Promise<T>,
  finalCheck: () => Promise<void> = async () => {},
) {
  deadline.assert();
  const tenant = context === null ? null : requireTenantContext(context);
  let client: BridgePgClient | undefined;
  let committed = false;
  let uncertain = true;
  let active = true;
  try {
    const connecting = pool.connect();
    try {
      client = await deadline.wait(connecting);
    } catch {
      void connecting.then(
        (late) => {
          try {
            late.release(true);
          } catch {
            /* No unsafe reuse after a late connect. */
          }
        },
        () => {},
      );
      throw new BridgeError();
    }
    deadline.assert();
    await deadline.wait(client.query('BEGIN ISOLATION LEVEL READ COMMITTED'));
    uncertain = false;
    await deadline.wait(client.query("SET LOCAL lock_timeout='1000ms'"));
    await deadline.wait(client.query("SET LOCAL statement_timeout='5000ms'"));
    await deadline.wait(client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'"));
    if (tenant !== null)
      await deadline.wait(client.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]));
    const raw = client;
    const guarded = {
      query: async <R extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
        check(active);
        const remaining = deadline.remaining();
        await deadline.wait(
          raw.query(
            "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",
            [`${Math.min(5000, remaining)}ms`, `${Math.min(1000, remaining)}ms`],
          ),
        );
        check(active);
        return deadline.wait(raw.query<R>(sql, parameters));
      },
      release: () => {
        throw new BridgeError();
      },
    } as BridgePgClient;
    const result = await deadline.wait(work(guarded));
    await deadline.wait(finalCheck());
    deadline.assert();
    uncertain = true;
    const tag = await deadline.wait(guarded.query('COMMIT'));
    check(tag.command === 'COMMIT');
    committed = true;
    uncertain = false;
    return result;
  } catch {
    if (client && !committed) {
      try {
        deadline.assert();
        await deadline.wait(client.query('ROLLBACK'));
      } catch {
        uncertain = true;
      }
    }
    throw new BridgeError();
  } finally {
    active = false;
    if (client) {
      try {
        client.release(uncertain);
      } catch {
        throw new BridgeError();
      }
    }
  }
}
