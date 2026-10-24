import type { Pool, PoolClient } from 'pg';

/** Local inspection lifecycle only; never a mutation or authorization capability. */
export class InspectionBudget {
  private expiresAt: number;
  private failed = false;
  private active = new Set<() => void>();
  constructor(milliseconds = 30_000) {
    this.expiresAt = performance.now() + milliseconds;
  }
  assert() {
    if (this.failed || performance.now() >= this.expiresAt) {
      this.abort();
      throw new Error('LOCAL inspection budget exceeded');
    }
  }
  abort() {
    this.failed = true;
    for (const destroy of [...this.active]) destroy();
  }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.assert();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              this.abort();
              reject(new Error('LOCAL inspection budget exceeded'));
            },
            Math.max(1, this.expiresAt - performance.now()),
          );
        }),
      ]);
      this.assert();
      return result;
    } catch (error) {
      this.abort();
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  pool(raw: Pool): Pool {
    return {
      connect: async () => {
        this.assert();
        const connecting = raw.connect();
        let client: PoolClient;
        try {
          client = await this.wait(() => connecting);
        } catch (error) {
          void connecting.then(
            (late) => late.release(true),
            () => {},
          );
          throw error;
        }
        let released = false;
        const release = (discard = false) => {
          if (released) return;
          released = true;
          this.active.delete(destroy);
          client.release(discard || this.failed);
        };
        const destroy = () => release(true);
        this.active.add(destroy);
        return {
          query: (sql: string, params?: unknown[]) =>
            this.wait(() => {
              if (released) throw new Error('LOCAL inspection connection closed');
              return client.query(sql, params);
            }),
          release,
        } as PoolClient;
      },
    } as Pool;
  }
}
