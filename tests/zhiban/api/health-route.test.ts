import { describe, expect, it, vi } from 'vitest';

import type { ZhibanDatabaseHealth } from '@/lib/zhiban/db/health';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import { createZhibanHealthHandler } from '@/lib/zhiban/health/handler';

const pool = {} as ZhibanDatabasePool;

describe('GET /api/zhiban/health', () => {
  it('returns 503 without trying to connect when DATABASE_URL is absent', async () => {
    const getPool = vi.fn(() => pool);
    const response = await createZhibanHealthHandler({
      databaseUrl: '',
      getPool,
      checkHealth: vi.fn(),
    })();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'unavailable',
      database: 'not_configured',
      schema: 'unknown',
    });
    expect(getPool).not.toHaveBeenCalled();
  });

  it.each([
    ['healthy', 200],
    ['migration_required', 503],
    ['unhealthy', 503],
  ] as const)('maps %s database health to HTTP %i', async (status, expectedStatus) => {
    const health: ZhibanDatabaseHealth = {
      status,
      database: status === 'unhealthy' ? 'unreachable' : 'reachable',
      schema:
        status === 'healthy' ? 'ready' : status === 'migration_required' ? 'missing' : 'unknown',
      expectedVersions: ['001'],
      appliedVersions: status === 'healthy' ? ['001'] : [],
      pendingVersions: status === 'healthy' ? [] : ['001'],
      driftedVersions: [],
      latencyMs: 3,
    };
    const response = await createZhibanHealthHandler({
      databaseUrl: 'postgresql://configured',
      getPool: () => pool,
      checkHealth: vi.fn().mockResolvedValue(health),
    })();

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual(health);
  });

  it('does not expose connection errors or credentials', async () => {
    const response = await createZhibanHealthHandler({
      databaseUrl: 'postgresql://user:secret@database/openmaic',
      getPool: () => {
        throw new Error('connect ECONNREFUSED password=secret');
      },
      checkHealth: vi.fn(),
    })();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain('secret');
    expect(body).not.toContain('ECONNREFUSED');
  });
});
