import { Pool, type PoolConfig } from 'pg';

import type { ZhibanDatabasePool } from './types';

const DEFAULT_POOL_SIZE = 10;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const MIN_POOL_SIZE = 1;
const MAX_POOL_SIZE = 50;

interface GlobalZhibanPool {
  connectionString: string;
  pool: Pool;
}

const globalWithZhibanPool = globalThis as typeof globalThis & {
  __openmaicZhibanPool?: GlobalZhibanPool;
};

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function resolveZhibanPoolConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PoolConfig & { connectionString: string } {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required for Zhiban PostgreSQL');

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql:// with a hostname');
  }

  return {
    connectionString,
    max: boundedInteger(env.ZHIBAN_DB_POOL_MAX, DEFAULT_POOL_SIZE, MIN_POOL_SIZE, MAX_POOL_SIZE),
    connectionTimeoutMillis: boundedInteger(
      env.ZHIBAN_DB_CONNECT_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS,
      500,
      30_000,
    ),
    idleTimeoutMillis: 30_000,
    application_name: 'openmaic-zhiban',
  };
}

export function createZhibanPool(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Pool {
  return new Pool(resolveZhibanPoolConfig(env));
}

export function getZhibanPool(): ZhibanDatabasePool {
  const config = resolveZhibanPoolConfig();
  const cached = globalWithZhibanPool.__openmaicZhibanPool;
  if (cached?.connectionString === config.connectionString) {
    return cached.pool as unknown as ZhibanDatabasePool;
  }

  if (cached) void cached.pool.end();
  const pool = new Pool(config);
  globalWithZhibanPool.__openmaicZhibanPool = {
    connectionString: config.connectionString,
    pool,
  };
  return pool as unknown as ZhibanDatabasePool;
}

export async function closeZhibanPool(): Promise<void> {
  const cached = globalWithZhibanPool.__openmaicZhibanPool;
  delete globalWithZhibanPool.__openmaicZhibanPool;
  if (cached) await cached.pool.end();
}
