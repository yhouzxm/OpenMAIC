import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { tenantId } from '@/lib/zhiban/domain/identity';
import {
  tenantScopeContext,
  type TenantContext,
} from '@/lib/zhiban/application/identity/ports/tenant-context';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import {
  controlTransaction,
  tenantTransaction,
  type TransactionPool,
} from '@/lib/zhiban/infrastructure/identity/postgres/transactions';

const context = tenantScopeContext(tenantId('018f0000-0000-7000-8000-000000000001'));
const begin = 'BEGIN ISOLATION LEVEL READ COMMITTED';
function harness(
  failures = new Map<string, unknown>(),
  releaseError?: unknown,
  commitCommand = 'COMMIT',
) {
  const calls: string[] = [];
  const parameters: unknown[][] = [];
  let localTenant: unknown = null;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push(sql);
    parameters.push(values ?? []);
    if (failures.has(sql)) throw failures.get(sql);
    if (sql.startsWith('SELECT set_config')) localTenant = values?.[0];
    if (sql === 'COMMIT' || sql === 'ROLLBACK') localTenant = null;
    const command =
      sql === 'COMMIT'
        ? commitCommand
        : sql === 'ROLLBACK'
          ? 'ROLLBACK'
          : sql.startsWith('BEGIN')
            ? 'BEGIN'
            : 'SELECT';
    return { rows: [{ tenant: localTenant }], rowCount: 1, command, oid: 0, fields: [] };
  });
  const release = vi.fn((destroy?: boolean) => {
    calls.push(destroy ? 'release:destroy' : 'release');
    if (releaseError) throw releaseError;
  });
  // The fake implements just the Promise overload actually used by these primitives.
  const client = { query: query as unknown as PoolClient['query'], release };
  const connect = vi.fn(async () => client);
  const pool: TransactionPool = { connect };
  return { calls, parameters, query, release, client, connect, pool };
}

describe('exclusive PostgreSQL transaction lifecycle', () => {
  it('TX01 control BEGIN/work/COMMIT/release uses one exclusive client', async () => {
    const h = harness();
    const result = await controlTransaction(h.pool, async (client) => {
      expect(client).toBe(h.client);
      await client.query('work');
      return 42;
    });
    expect(result).toBe(42);
    expect(h.calls).toEqual([begin, 'work', 'COMMIT', 'release']);
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
  });
  it('TX02/TX03 tenant context follows BEGIN and precedes all work, parameterized/local', async () => {
    const h = harness();
    await tenantTransaction(h.pool, context, async (client) => {
      expect(client).toBe(h.client);
      const state = await client.query('work');
      expect(state.rows[0].tenant).toBe(context.tenantId);
    });
    expect(h.calls).toEqual([
      begin,
      "SELECT set_config('app.tenant_id', $1, true)",
      'work',
      'COMMIT',
      'release',
    ]);
    expect(h.parameters[1]).toEqual([context.tenantId]);
  });
  for (const [id, failureSql] of [
    ['TX04', begin],
    ['TX05', "SELECT set_config('app.tenant_id', $1, true)"],
    ['TX06', 'work'],
    ['TX07', 'COMMIT'],
  ]) {
    it(`${id} ${failureSql} failure rolls back, preserves primary, releases exactly once`, async () => {
      const primary = new Error('primary');
      const h = harness(new Map([[failureSql, primary]]));
      const work = vi.fn(async (client: Pick<PoolClient, 'query' | 'release'>) => {
        await client.query('work');
      });
      await expect(tenantTransaction(h.pool, context, work)).rejects.toBe(primary);
      expect(h.calls).toContain('ROLLBACK');
      const sequence = [begin, "SELECT set_config('app.tenant_id', $1, true)", 'work', 'COMMIT'];
      expect(h.calls).toEqual([
        ...sequence.slice(0, sequence.indexOf(failureSql) + 1),
        'ROLLBACK',
        failureSql === begin || failureSql === 'COMMIT' ? 'release:destroy' : 'release',
      ]);
      expect(h.release).toHaveBeenCalledTimes(1);
      if (failureSql === begin || failureSql.startsWith('SELECT'))
        expect(work).not.toHaveBeenCalled();
      if (failureSql !== 'COMMIT') expect(h.calls).not.toContain('COMMIT');
      if (failureSql === begin || failureSql === 'COMMIT')
        expect(h.release).toHaveBeenCalledWith(true);
    });
  }
  it('TX08 rollback failure preserves primary and destroys uncertain client', async () => {
    const primary = new Error('primary');
    const h = harness(
      new Map([
        ['work', primary],
        ['ROLLBACK', new Error('secondary')],
      ]),
    );
    await expect(
      controlTransaction(h.pool, async (client) => {
        await client.query('work');
      }),
    ).rejects.toBe(primary);
    expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it.each(['control', 'tenant'] as const)(
    '%s COMMIT returning ROLLBACK cannot report success after a swallowed SQL failure',
    async (kind) => {
      const h = harness(new Map([['work', { code: '23514' }]]), undefined, 'ROLLBACK');
      const work = vi.fn(async (client: Pick<PoolClient, 'query' | 'release'>) => {
        // PostgreSQL leaves the transaction aborted even if the callback catches the error.
        await client.query('work').catch(() => undefined);
        return 'must not succeed';
      });
      const result =
        kind === 'control'
          ? controlTransaction(h.pool, work)
          : tenantTransaction(h.pool, context, work);
      await expect(result).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
      expect(h.calls.slice(-3)).toEqual(['COMMIT', 'ROLLBACK', 'release:destroy']);
      expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
    },
  );
  it('unsuccessful COMMIT keeps its primary over rollback and release failures', async () => {
    const h = harness(
      new Map([['ROLLBACK', new Error('rollback')]]),
      new Error('release'),
      'ROLLBACK',
    );
    await expect(controlTransaction(h.pool, async () => 42)).rejects.toMatchObject({
      code: 'INTEGRITY_FAILURE',
    });
    expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('TX09 release failure does not erase a body primary', async () => {
    const primary = new IdentityPortError('INTEGRITY_FAILURE');
    const h = harness(new Map([['work', primary]]), new Error('secondary release'));
    await expect(
      controlTransaction(h.pool, async (client) => {
        await client.query('work');
      }),
    ).rejects.toBe(primary);
    expect(h.release).toHaveBeenCalledTimes(1);
  });
  it('TX10 release failure after commit is not reported as successful', async () => {
    const failure = new Error('release');
    const h = harness(new Map(), failure);
    await expect(controlTransaction(h.pool, async () => 42)).rejects.toBe(failure);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.calls).not.toContain('ROLLBACK');
  });
  it.each(['40001', '40P01'])(
    'TX11/TX12 SQLSTATE %s is retryable, never automatically retried',
    async (code) => {
      const h = harness(new Map([['work', { code, message: 'database detail' }]]));
      await expect(
        controlTransaction(h.pool, async (client) => {
          await client.query('work');
        }),
      ).rejects.toMatchObject({ code: 'RETRYABLE_PERSISTENCE_FAILURE' });
      expect(h.connect).toHaveBeenCalledTimes(1);
      expect(h.query.mock.calls.filter(([sql]) => sql === 'work')).toHaveLength(1);
    },
  );
  it.each(['40001', '40P01'])(
    'COMMIT SQLSTATE %s stays retryable despite rollback/release errors',
    async (code) => {
      const h = harness(
        new Map<string, unknown>([
          ['COMMIT', { code }],
          ['ROLLBACK', new Error('rollback')],
        ]),
        new Error('release'),
      );
      await expect(controlTransaction(h.pool, async () => 42)).rejects.toMatchObject({
        code: 'RETRYABLE_PERSISTENCE_FAILURE',
      });
      expect(h.calls).toEqual([begin, 'COMMIT', 'ROLLBACK', 'release:destroy']);
      expect(h.connect).toHaveBeenCalledTimes(1);
      expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
    },
  );
  it.each(['23505', '23503', '23514', '42501', '08006', 'UNKNOWN'])(
    'TX13 SQLSTATE %s remains non-retryable and preserves primary',
    async (code) => {
      const primary = { code };
      const h = harness();
      await expect(
        controlTransaction(h.pool, async () => {
          throw primary;
        }),
      ).rejects.toBe(primary);
    },
  );
  it('unknown throw values, including undefined, remain primary', async () => {
    for (const primary of [undefined, null, 0, 'failure']) {
      const h = harness(new Map([['ROLLBACK', new Error('secondary')]]));
      await expect(
        controlTransaction(h.pool, async () => {
          throw primary;
        }),
      ).rejects.toBe(primary);
    }
  });
  it('SQLSTATE getter is never invoked or trusted', async () => {
    let reads = 0;
    const primary = Object.defineProperty({}, 'code', {
      get() {
        reads++;
        return '40001';
      },
    });
    await expect(
      controlTransaction(harness().pool, async () => {
        throw primary;
      }),
    ).rejects.toBe(primary);
    expect(reads).toBe(0);
  });
  it('connect failure performs no queries/release, maps only retryable codes', async () => {
    const h = harness();
    const failure = new Error('connect');
    h.connect.mockRejectedValueOnce(failure);
    await expect(controlTransaction(h.pool, async () => 1)).rejects.toBe(failure);
    expect(h.query).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
    h.connect.mockRejectedValueOnce({ code: '40001' });
    await expect(controlTransaction(h.pool, async () => 1)).rejects.toMatchObject({
      code: 'RETRYABLE_PERSISTENCE_FAILURE',
    });
  });
  it('invalid TenantContext is rejected before acquire/work', () => {
    const h = harness();
    expect(() =>
      tenantTransaction(h.pool, null as unknown as TenantContext, async () => 1),
    ).toThrow(IdentityPortError);
    expect(h.connect).not.toHaveBeenCalled();
  });
  it('TX14 same physical client reuse loses tenant after commit and rollback (model; real PG16 separate)', async () => {
    const h = harness();
    await tenantTransaction(h.pool, context, async (client) => {
      expect((await client.query('work')).rows[0].tenant).toBe(context.tenantId);
    });
    await controlTransaction(h.pool, async (client) => {
      expect((await client.query('work')).rows[0].tenant).toBeNull();
    });
    await expect(
      tenantTransaction(h.pool, context, async () => {
        throw new Error('body');
      }),
    ).rejects.toThrow('body');
    await controlTransaction(h.pool, async (client) => {
      expect((await client.query('work')).rows[0].tenant).toBeNull();
    });
    expect(h.release).toHaveBeenCalledTimes(4);
  });
  it('TX15 no pool-query path or session-global SET exists', async () => {
    const h = harness();
    const poolQuery = vi.fn(() => {
      throw new Error('pool query leakage');
    });
    await tenantTransaction(
      { ...h.pool, query: poolQuery } as TransactionPool,
      context,
      async (client) => {
        await client.query('work');
      },
    );
    expect(poolQuery).not.toHaveBeenCalled();
    expect(h.calls.some((sql) => /^SET\b/i.test(sql))).toBe(false);
  });
  it('4A consistent reads select REPEATABLE READ READ ONLY explicitly', async () => {
    const h = harness();
    await tenantTransaction(
      h.pool,
      context,
      async (client) => {
        await client.query('read');
      },
      'REPEATABLE_READ_READ_ONLY',
    );
    expect(h.calls).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      "SELECT set_config('app.tenant_id', $1, true)",
      'read',
      'COMMIT',
      'release',
    ]);
  });
});
