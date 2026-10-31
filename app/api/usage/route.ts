import { aggregateUsage } from '@/lib/usage/aggregate';
import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { readUsageRecords } from '@/lib/server/usage-storage';

const log = createLogger('UsageAPI');

/**
 * GET /api/usage
 *
 * Aggregates the deployment-wide usage log (data/usage/*.jsonl) by model, by
 * day, and by modality. Pure usage — no cost. Optional `?months=YYYY-MM,...`.
 */
export async function GET(req: NextRequest) {
  try {
    const monthsParam = req.nextUrl.searchParams.get('months');
    const months = monthsParam ? monthsParam.split(',').map((s) => s.trim()) : undefined;

    const records = await readUsageRecords({ months });

    return apiSuccess(aggregateUsage(records));
  } catch (error) {
    log.error('Usage aggregation failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to read usage',
    );
  }
}
