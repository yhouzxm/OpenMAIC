import { afterEach, describe, expect, it } from 'vitest';

import {
  closeZhibanPool,
  createZhibanPool,
  resolveZhibanPoolConfig,
} from '@/lib/zhiban/db/connection';

describe('Zhiban PostgreSQL connection configuration', () => {
  afterEach(async () => {
    await closeZhibanPool();
  });

  it('requires a PostgreSQL DATABASE_URL without echoing credentials', () => {
    expect(() => resolveZhibanPoolConfig({})).toThrow('DATABASE_URL is required');
    expect(() =>
      resolveZhibanPoolConfig({ DATABASE_URL: 'mysql://user:secret@example.test/app' }),
    ).toThrow('must use postgres:// or postgresql://');
  });

  it('applies safe defaults and bounds operator supplied pool settings', () => {
    const connectionString = 'postgresql://user:secret@127.0.0.1:5432/openmaic';
    expect(resolveZhibanPoolConfig({ DATABASE_URL: connectionString })).toMatchObject({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5_000,
      application_name: 'openmaic-zhiban',
    });
    expect(
      resolveZhibanPoolConfig({
        DATABASE_URL: connectionString,
        ZHIBAN_DB_POOL_MAX: '500',
        ZHIBAN_DB_CONNECT_TIMEOUT_MS: '10',
      }),
    ).toMatchObject({ max: 50, connectionTimeoutMillis: 500 });
  });

  it('creates a lazy pg pool without opening a connection immediately', async () => {
    const pool = createZhibanPool({
      DATABASE_URL: 'postgresql://user:secret@127.0.0.1:5432/openmaic',
    });
    expect(pool.options.application_name).toBe('openmaic-zhiban');
    await pool.end();
  });
});
