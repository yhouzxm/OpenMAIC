import { createRequire } from 'node:module';
import { Pool } from 'pg';
import * as analysisService from '../lib/zhiban/analysis/service';
import * as partitionMaintenance from '../lib/zhiban/analysis/partition-maintenance';

const analysisExports = analysisService as unknown as {
  processAnalysisJobs?: typeof import('../lib/zhiban/analysis/service').processAnalysisJobs;
  default?: typeof import('../lib/zhiban/analysis/service');
};
const partitionExports = partitionMaintenance as unknown as {
  ensureLearningEventPartitions?: typeof import('../lib/zhiban/analysis/partition-maintenance').ensureLearningEventPartitions;
  default?: typeof import('../lib/zhiban/analysis/partition-maintenance');
};
const processAnalysisJobs =
  analysisExports.processAnalysisJobs ?? analysisExports.default?.processAnalysisJobs;
const ensureLearningEventPartitions =
  partitionExports.ensureLearningEventPartitions ??
  partitionExports.default?.ensureLearningEventPartitions;
if (!processAnalysisJobs || !ensureLearningEventPartitions)
  throw new Error('Unable to load Zhiban analysis worker modules');

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env') as typeof import('@next/env');
loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const configuredTenantId = process.env.ZHIBAN_WORKER_TENANT_ID;

const pool = new Pool({ connectionString, max: 4 });
const once = process.argv.includes('--once');
const workerId = `zhiban-worker-${process.pid}`;

try {
  await ensureLearningEventPartitions(pool);
  do {
    const tenantIds=configuredTenantId?[configuredTenantId]:(await pool.query<{id:string}>(`SELECT id::text FROM zhiban.tenants WHERE status='active' ORDER BY id`)).rows.map(row=>row.id);
    let processed=0;
    for(const tenantId of tenantIds) processed+=(await processAnalysisJobs(pool, tenantId, { limit: 50, workerId:`${workerId}-${tenantId}` })).processed;
    if (once) {
      console.log(`Processed analysis jobs: ${processed} across ${tenantIds.length} tenant(s)`);
      break;
    }
    if (!processed) await new Promise((resolve) => setTimeout(resolve, 2000));
  } while (true);
} finally {
  await pool.end();
}
