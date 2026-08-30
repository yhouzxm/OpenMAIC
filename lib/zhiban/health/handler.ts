import { NextResponse } from 'next/server';

import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { checkZhibanDatabaseHealth, type ZhibanDatabaseHealth } from '@/lib/zhiban/db/health';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';

interface HealthRouteDependencies {
  databaseUrl?: string;
  getPool: () => ZhibanDatabasePool;
  checkHealth: (pool: ZhibanDatabasePool) => Promise<ZhibanDatabaseHealth>;
}

const noStoreHeaders = { 'Cache-Control': 'no-store' };

export function createZhibanHealthHandler(
  dependencies: HealthRouteDependencies = {
    databaseUrl: process.env.DATABASE_URL,
    getPool: getZhibanPool,
    checkHealth: checkZhibanDatabaseHealth,
  },
) {
  return async function GET() {
    if (!dependencies.databaseUrl?.trim()) {
      return NextResponse.json(
        {
          status: 'unavailable',
          database: 'not_configured',
          schema: 'unknown',
        },
        { status: 503, headers: noStoreHeaders },
      );
    }

    try {
      const health = await dependencies.checkHealth(dependencies.getPool());
      return NextResponse.json(health, {
        status: health.status === 'healthy' ? 200 : 503,
        headers: noStoreHeaders,
      });
    } catch {
      return NextResponse.json(
        {
          status: 'unhealthy',
          database: 'unreachable',
          schema: 'unknown',
        },
        { status: 503, headers: noStoreHeaders },
      );
    }
  };
}
