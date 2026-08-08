import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;

export const agentOperationsMigration: ZhibanMigration = {
  version: '020',
  description: 'agent intervention lifecycle, invocation metrics and teacher operations',
  checksum: 'zhiban-020-agent-operations-v1',
  up: [
    `ALTER TABLE zhiban.intervention_briefs DROP CONSTRAINT intervention_briefs_status_check`,
    `ALTER TABLE zhiban.intervention_briefs ADD CONSTRAINT intervention_briefs_status_check CHECK(status IN('pending','accepted','running','dismissed','delivered','failed','escalated','resolved','expired'))`,
    `ALTER TABLE zhiban.intervention_briefs ADD COLUMN assigned_to UUID, ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0, ADD COLUMN last_error TEXT, ADD COLUMN started_at TIMESTAMPTZ, ADD COLUMN delivered_at TIMESTAMPTZ, ADD COLUMN resolved_at TIMESTAMPTZ, ADD COLUMN resolution_note TEXT`,
    `ALTER TABLE zhiban.intervention_briefs ADD CONSTRAINT intervention_briefs_assigned_to_fk FOREIGN KEY(assigned_to,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE SET NULL`,
    `CREATE TABLE zhiban.agent_invocation_metrics (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, brief_id UUID NOT NULL, course_id UUID NOT NULL, learner_id UUID NOT NULL,
      role_type VARCHAR(24) NOT NULL CHECK(role_type IN('tutor','peer','teacher')), outcome VARCHAR(24) NOT NULL CHECK(outcome IN('started','succeeded','failed','timeout','degraded')),
      latency_ms INTEGER, input_tokens INTEGER, output_tokens INTEGER, error_code VARCHAR(80), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(brief_id) REFERENCES zhiban.intervention_briefs(id) ON DELETE CASCADE,
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE
    )`,
    `ALTER TABLE zhiban.agent_invocation_metrics ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.agent_invocation_metrics FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.agent_invocation_metrics USING (tenant_id=${tenantSetting}) WITH CHECK (tenant_id=${tenantSetting})`,
    `CREATE INDEX agent_invocation_metrics_course_idx ON zhiban.agent_invocation_metrics(tenant_id,course_id,created_at DESC)`,
    `CREATE INDEX intervention_briefs_teacher_queue_idx ON zhiban.intervention_briefs(tenant_id,course_id,status,created_at DESC)`,
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.agent_invocation_metrics`,
    `DROP INDEX IF EXISTS zhiban.intervention_briefs_teacher_queue_idx`,
    `ALTER TABLE zhiban.intervention_briefs DROP CONSTRAINT intervention_briefs_assigned_to_fk`,
    `ALTER TABLE zhiban.intervention_briefs DROP COLUMN assigned_to, DROP COLUMN attempt_count, DROP COLUMN last_error, DROP COLUMN started_at, DROP COLUMN delivered_at, DROP COLUMN resolved_at, DROP COLUMN resolution_note`,
    `ALTER TABLE zhiban.intervention_briefs DROP CONSTRAINT intervention_briefs_status_check`,
    `ALTER TABLE zhiban.intervention_briefs ADD CONSTRAINT intervention_briefs_status_check CHECK(status IN('pending','accepted','dismissed','delivered','escalated','expired'))`,
  ],
};
