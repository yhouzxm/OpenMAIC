import { createRequire } from 'node:module';
import { Pool } from 'pg';
import { processAnalysisJobs } from '../lib/zhiban/analysis/service';
import { ensureLearningEventPartitions } from '../lib/zhiban/analysis/partition-maintenance';

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env') as typeof import('@next/env');
loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL;
const tenantId = process.env.ZHIBAN_WORKER_TENANT_ID;
if (!connectionString) throw new Error('DATABASE_URL is required');
if (!tenantId) throw new Error('ZHIBAN_WORKER_TENANT_ID is required');

const pool = new Pool({ connectionString, max: 4 });
const once = process.argv.includes('--once');
const workerId = `zhiban-worker-${process.pid}`;

try {
  await ensureLearningEventPartitions(pool);
  do {
    const result = await processAnalysisJobs(pool, tenantId, { limit: 50, workerId });
    if (once) {
      console.log(`Processed analysis jobs: ${result.processed}`);
      break;
    }
    if (!result.processed) await new Promise((resolve) => setTimeout(resolve, 2000));
  } while (true);
} finally {
  await pool.end();
}
