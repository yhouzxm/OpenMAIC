import { describe, expect, it } from 'vitest';

import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { QueryResult, ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';

class TenantClient implements ZhibanDatabasePool, ZhibanDatabaseClient {
  readonly statements: Array<{ text: string; values?: readonly unknown[] }> = [];
  released = false;

  async connect() {
    return this;
  }

  release() {
    this.released = true;
  }

  async query<TRow extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<TRow>> {
    this.statements.push({ text, values });
    return { rows: [] };
  }
}

describe('withZhibanTenant', () => {
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('sets a transaction-local tenant before running business queries', async () => {
    const db = new TenantClient();

    const result = await withZhibanTenant(db, tenantId, async (client) => {
      await client.query('SELECT * FROM zhiban.accounts');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(db.statements).toEqual([
      { text: 'BEGIN', values: undefined },
      { text: "SELECT set_config('zhiban.tenant_id', $1, true)", values: [tenantId] },
      { text: 'SELECT * FROM zhiban.accounts', values: undefined },
      { text: 'COMMIT', values: undefined },
    ]);
    expect(db.released).toBe(true);
  });

  it('rejects invalid tenant identifiers before acquiring a connection', async () => {
    const db = new TenantClient();
    await expect(withZhibanTenant(db, 'tenant-a', async () => undefined)).rejects.toThrow(
      'valid UUID',
    );
    expect(db.statements).toEqual([]);
  });

  it('rolls back and releases the connection when the operation fails', async () => {
    const db = new TenantClient();
    await expect(
      withZhibanTenant(db, tenantId, async () => {
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');

    expect(db.statements.at(-1)?.text).toBe('ROLLBACK');
    expect(db.released).toBe(true);
  });

  it('serializes concurrent business queries on the transaction client', async () => {
    const db = new TenantClient();
    let activeQueries = 0;
    let maximumActiveQueries = 0;
    const originalQuery = db.query.bind(db);

    db.query = async <TRow extends Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<TRow>> => {
      if (!text.startsWith('BUSINESS')) return originalQuery<TRow>(text, values);
      activeQueries += 1;
      maximumActiveQueries = Math.max(maximumActiveQueries, activeQueries);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeQueries -= 1;
      return originalQuery<TRow>(text, values);
    };

    await withZhibanTenant(db, tenantId, async (client) => {
      await Promise.all([
        client.query('BUSINESS QUERY 1'),
        client.query('BUSINESS QUERY 2'),
        client.query('BUSINESS QUERY 3'),
      ]);
    });

    expect(maximumActiveQueries).toBe(1);
    expect(db.statements.map(({ text }) => text)).toEqual([
      'BEGIN',
      "SELECT set_config('zhiban.tenant_id', $1, true)",
      'BUSINESS QUERY 1',
      'BUSINESS QUERY 2',
      'BUSINESS QUERY 3',
      'COMMIT',
    ]);
  });
});
