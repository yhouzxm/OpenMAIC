import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;

export const bulkImportMigration: ZhibanMigration = {
  version: '006',
  description: 'bulk import jobs and row validation reports',
  checksum: 'zhiban-006-bulk-import-v1',
  up: [
    `CREATE TABLE zhiban.import_jobs (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      created_by UUID NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      status VARCHAR(24) NOT NULL CHECK (status IN ('validated', 'invalid', 'running', 'completed', 'failed')),
      mode VARCHAR(24) NOT NULL DEFAULT 'skip' CHECK (mode IN ('skip', 'update')),
      total_rows INTEGER NOT NULL DEFAULT 0,
      valid_rows INTEGER NOT NULL DEFAULT 0,
      invalid_rows INTEGER NOT NULL DEFAULT 0,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT,
      executed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (created_by, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE RESTRICT,
      CHECK (jsonb_typeof(payload) = 'object'), CHECK (jsonb_typeof(summary) = 'object')
    )`,
    `CREATE TABLE zhiban.import_rows (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id UUID NOT NULL,
      job_id UUID NOT NULL REFERENCES zhiban.import_jobs(id) ON DELETE CASCADE,
      sheet_name VARCHAR(64) NOT NULL,
      row_number INTEGER NOT NULL CHECK (row_number >= 2),
      row_key VARCHAR(200),
      status VARCHAR(24) NOT NULL CHECK (status IN ('valid', 'invalid', 'created', 'updated', 'skipped')),
      errors JSONB NOT NULL DEFAULT '[]'::jsonb,
      UNIQUE (job_id, sheet_name, row_number),
      CHECK (jsonb_typeof(errors) = 'array')
    )`,
    `ALTER TABLE zhiban.import_jobs ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.import_jobs FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.import_jobs USING (tenant_id = ${tenantSetting}) WITH CHECK (tenant_id = ${tenantSetting})`,
    `ALTER TABLE zhiban.import_rows ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.import_rows FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.import_rows USING (tenant_id = ${tenantSetting}) WITH CHECK (tenant_id = ${tenantSetting})`,
    `CREATE INDEX import_jobs_tenant_created_idx ON zhiban.import_jobs (tenant_id, created_at DESC)`,
  ],
  down: [`DROP TABLE IF EXISTS zhiban.import_rows`, `DROP TABLE IF EXISTS zhiban.import_jobs`],
};
