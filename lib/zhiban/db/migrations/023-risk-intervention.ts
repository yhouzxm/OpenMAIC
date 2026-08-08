import type { ZhibanMigration } from './001-initial-identity';
const tenant = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;
const tables = [
  'risk_rules',
  'risk_snapshots',
  'risk_cases',
  'risk_case_transitions',
  'risk_support_preferences',
];
export const riskInterventionMigration: ZhibanMigration = {
  version: '023',
  description: 'explainable learning risk warnings, SLA cases and teacher intervention workflow',
  checksum: 'zhiban-023-risk-intervention-v1',
  up: [
    `ALTER TABLE zhiban.analysis_jobs DROP CONSTRAINT analysis_jobs_job_type_check`,
    `ALTER TABLE zhiban.analysis_jobs ADD CONSTRAINT analysis_jobs_job_type_check CHECK(job_type IN('profile_rebuild','ema_evaluate','monitor_evaluate','risk_evaluate'))`,
    `CREATE TABLE zhiban.risk_rules(id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID,code VARCHAR(80) NOT NULL,name VARCHAR(160) NOT NULL,risk_type VARCHAR(32) NOT NULL CHECK(risk_type IN('achievement','engagement','completion','inactivity','dropout')),configuration JSONB NOT NULL DEFAULT '{}'::jsonb,version INTEGER NOT NULL DEFAULT 1,status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN('draft','active','archived')),created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,UNIQUE(tenant_id,course_id,code,version),CHECK(jsonb_typeof(configuration)='object'))`,
    `CREATE TABLE zhiban.risk_snapshots(id UUID PRIMARY KEY,tenant_id UUID NOT NULL,learner_id UUID NOT NULL,course_id UUID NOT NULL,risk_type VARCHAR(32) NOT NULL,score NUMERIC(6,3) NOT NULL CHECK(score BETWEEN 0 AND 100),confidence NUMERIC(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1),level SMALLINT NOT NULL CHECK(level BETWEEN 0 AND 3),evidence JSONB NOT NULL,sources JSONB NOT NULL,rule_version VARCHAR(80) NOT NULL,algorithm_version VARCHAR(80) NOT NULL,source_event_id VARCHAR(200) NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN('active','superseded','dismissed','expired')),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '14 days',FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,UNIQUE(tenant_id,learner_id,course_id,risk_type,source_event_id),UNIQUE(id,tenant_id),CHECK(jsonb_typeof(evidence)='object'),CHECK(jsonb_typeof(sources)='array'))`,
    `CREATE TABLE zhiban.risk_cases(id UUID PRIMARY KEY,tenant_id UUID NOT NULL,snapshot_id UUID NOT NULL,learner_id UUID NOT NULL,course_id UUID NOT NULL,severity SMALLINT NOT NULL CHECK(severity BETWEEN 1 AND 3),status VARCHAR(24) NOT NULL DEFAULT 'new' CHECK(status IN('new','acknowledged','in_progress','escalated','resolved','dismissed')),assigned_to UUID,takeover BOOLEAN NOT NULL DEFAULT false,sla_due_at TIMESTAMPTZ NOT NULL,acknowledged_at TIMESTAMPTZ,resolved_at TIMESTAMPTZ,resolution_code VARCHAR(40),resolution_note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(snapshot_id,tenant_id) REFERENCES zhiban.risk_snapshots(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(assigned_to,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),UNIQUE(snapshot_id),UNIQUE(id,tenant_id))`,
    `CREATE TABLE zhiban.risk_case_transitions(id UUID PRIMARY KEY,tenant_id UUID NOT NULL,case_id UUID NOT NULL,actor_id UUID,actor_type VARCHAR(24) NOT NULL CHECK(actor_type IN('system','teacher','reviewer')),from_status VARCHAR(24),to_status VARCHAR(24) NOT NULL,action VARCHAR(40) NOT NULL,note TEXT NOT NULL DEFAULT '',metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(case_id,tenant_id) REFERENCES zhiban.risk_cases(id,tenant_id) ON DELETE CASCADE,CHECK(jsonb_typeof(metadata)='object'))`,
    `CREATE TABLE zhiban.risk_support_preferences(tenant_id UUID NOT NULL,learner_id UUID NOT NULL,course_id UUID NOT NULL,proactive_support_enabled BOOLEAN NOT NULL DEFAULT true,paused_until TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,learner_id,course_id),FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE)`,
    ...tables.flatMap((t) => [
      `ALTER TABLE zhiban.${t} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${t} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${t} USING(tenant_id=${tenant}) WITH CHECK(tenant_id=${tenant})`,
    ]),
    `CREATE INDEX risk_cases_queue_idx ON zhiban.risk_cases(tenant_id,course_id,status,severity DESC,sla_due_at)`,
    `CREATE INDEX risk_snapshots_heatmap_idx ON zhiban.risk_snapshots(tenant_id,course_id,risk_type,created_at DESC)`,
  ],
  down: [
    ...tables
      .slice()
      .reverse()
      .map((t) => `DROP TABLE IF EXISTS zhiban.${t}`),
    `ALTER TABLE zhiban.analysis_jobs DROP CONSTRAINT analysis_jobs_job_type_check`,
    `ALTER TABLE zhiban.analysis_jobs ADD CONSTRAINT analysis_jobs_job_type_check CHECK(job_type IN('profile_rebuild','ema_evaluate','monitor_evaluate'))`,
  ],
};
