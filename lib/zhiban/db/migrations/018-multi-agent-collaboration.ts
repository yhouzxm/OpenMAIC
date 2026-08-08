import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;
const tables = ['agent_role_templates', 'intervention_briefs', 'intervention_transitions'];

export const multiAgentCollaborationMigration: ZhibanMigration = {
  version: '018',
  description: 'course agent role templates and auditable monitor intervention workflow',
  checksum: 'zhiban-018-multi-agent-collaboration-v1',
  up: [
    `ALTER TABLE zhiban.analysis_jobs DROP CONSTRAINT analysis_jobs_job_type_check`,
    `ALTER TABLE zhiban.analysis_jobs ADD CONSTRAINT analysis_jobs_job_type_check CHECK(job_type IN('profile_rebuild','ema_evaluate','monitor_evaluate'))`,
    `CREATE TABLE zhiban.agent_role_templates (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID,role_type VARCHAR(24) NOT NULL CHECK(role_type IN('tutor','peer','monitor')),
      version VARCHAR(80) NOT NULL,name VARCHAR(120) NOT NULL,persona TEXT NOT NULL,policy JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN('draft','active','archived')),created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      UNIQUE(tenant_id,course_id,role_type,version),CHECK(jsonb_typeof(policy)='object'))`,
    `CREATE TABLE zhiban.intervention_briefs (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,learner_id UUID NOT NULL,course_id UUID NOT NULL,source_event_id VARCHAR(160) NOT NULL,
      target_role VARCHAR(24) NOT NULL CHECK(target_role IN('peer','tutor','teacher')),level VARCHAR(24) NOT NULL CHECK(level IN('peer','tutor','teacher')),
      objective TEXT NOT NULL,tone VARCHAR(80) NOT NULL,evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      prohibited_content JSONB NOT NULL DEFAULT '[]'::jsonb,max_turns INTEGER NOT NULL DEFAULT 4 CHECK(max_turns BETWEEN 1 AND 12),
      policy_version VARCHAR(80) NOT NULL,prompt_version VARCHAR(80) NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK(status IN('pending','accepted','dismissed','delivered','escalated','expired')),
      command_id VARCHAR(240) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),responded_at TIMESTAMPTZ,expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '7 days',
      FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      UNIQUE(tenant_id,command_id),CHECK(jsonb_typeof(evidence_summary)='object'),CHECK(jsonb_typeof(prohibited_content)='array'))`,
    `CREATE TABLE zhiban.intervention_transitions (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,brief_id UUID NOT NULL,actor_type VARCHAR(24) NOT NULL CHECK(actor_type IN('student','teacher','monitor','system')),
      actor_id UUID,from_status VARCHAR(24),to_status VARCHAR(24) NOT NULL,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(brief_id) REFERENCES zhiban.intervention_briefs(id) ON DELETE CASCADE,CHECK(jsonb_typeof(metadata)='object'))`,
    ...tables.flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING (tenant_id=${tenantSetting}) WITH CHECK (tenant_id=${tenantSetting})`,
    ]),
    `CREATE INDEX intervention_briefs_pending_idx ON zhiban.intervention_briefs(tenant_id,learner_id,created_at DESC) WHERE status='pending'`,
    `CREATE INDEX intervention_briefs_course_idx ON zhiban.intervention_briefs(tenant_id,course_id,created_at DESC)`,
    `CREATE INDEX intervention_transitions_brief_idx ON zhiban.intervention_transitions(brief_id,created_at)`,
  ],
  down: [
    ...tables.slice().reverse().map((table) => `DROP TABLE IF EXISTS zhiban.${table}`),
    `ALTER TABLE zhiban.analysis_jobs DROP CONSTRAINT analysis_jobs_job_type_check`,
    `ALTER TABLE zhiban.analysis_jobs ADD CONSTRAINT analysis_jobs_job_type_check CHECK(job_type IN('profile_rebuild','ema_evaluate'))`,
  ],
};
