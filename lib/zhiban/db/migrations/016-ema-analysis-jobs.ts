import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;
const tables = ['ema_templates', 'ema_instances', 'ema_responses', 'analysis_jobs'];

export const emaAnalysisJobsMigration: ZhibanMigration = {
  version: '016',
  description: 'EMA questionnaires, trigger instances, responses, and asynchronous analysis jobs',
  checksum: 'zhiban-016-ema-analysis-jobs-v1',
  up: [
    `CREATE TABLE zhiban.ema_templates (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID,code VARCHAR(80) NOT NULL,title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL DEFAULT '',questions JSONB NOT NULL,rules JSONB NOT NULL,version INTEGER NOT NULL DEFAULT 1,
      status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN('draft','active','archived')),
      created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      UNIQUE(tenant_id,course_id,code,version),CHECK(jsonb_typeof(questions)='array'),CHECK(jsonb_typeof(rules)='object'))`,
    `CREATE TABLE zhiban.ema_instances (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,template_id UUID NOT NULL,learner_id UUID NOT NULL,course_id UUID NOT NULL,
      trigger_event_id UUID,trigger_reason VARCHAR(200) NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','answered','skipped','expired','cancelled')),
      triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),expires_at TIMESTAMPTZ NOT NULL,completed_at TIMESTAMPTZ,
      FOREIGN KEY(template_id) REFERENCES zhiban.ema_templates(id) ON DELETE RESTRICT,
      FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      UNIQUE(tenant_id,template_id,learner_id,trigger_event_id))`,
    `CREATE TABLE zhiban.ema_responses (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,instance_id UUID NOT NULL,learner_id UUID NOT NULL,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,skipped BOOLEAN NOT NULL DEFAULT false,skip_reason TEXT,submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(instance_id) REFERENCES zhiban.ema_instances(id) ON DELETE CASCADE,
      FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      UNIQUE(instance_id),CHECK(jsonb_typeof(answers)='object'),CHECK(NOT skipped OR answers='{}'::jsonb))`,
    `CREATE TABLE zhiban.analysis_jobs (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,job_type VARCHAR(40) NOT NULL CHECK(job_type IN('profile_rebuild','ema_evaluate')),
      idempotency_key VARCHAR(240) NOT NULL,payload JSONB NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','succeeded','failed','cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20),run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked_at TIMESTAMPTZ,locked_by VARCHAR(120),last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ,
      UNIQUE(tenant_id,idempotency_key),CHECK(jsonb_typeof(payload)='object'))`,
    ...tables.flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING (tenant_id=${tenantSetting}) WITH CHECK (tenant_id=${tenantSetting})`,
    ]),
    `CREATE INDEX ema_instances_learner_pending_idx ON zhiban.ema_instances(tenant_id,learner_id,triggered_at DESC) WHERE status='pending'`,
    `CREATE INDEX ema_instances_course_time_idx ON zhiban.ema_instances(tenant_id,course_id,triggered_at DESC)`,
    `CREATE INDEX analysis_jobs_claim_idx ON zhiban.analysis_jobs(status,run_after,created_at) WHERE status IN('queued','running')`,
  ],
  down: tables
    .slice()
    .reverse()
    .map((table) => `DROP TABLE IF EXISTS zhiban.${table}`),
};
