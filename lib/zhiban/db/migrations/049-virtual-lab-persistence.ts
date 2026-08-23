import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;
const tables = ['virtual_lab_sessions', 'virtual_lab_actions', 'virtual_lab_learner_profiles'];

/**
 * The current competition course is registered by code rather than as a zhiban.courses UUID.
 * Keep its learning ledger isolated but tenant-scoped, instead of weakening existing FK rules.
 */
export const virtualLabPersistenceMigration: ZhibanMigration = {
  version: '049',
  description: 'Virtual Lab sessions, actions, assessments, and source-labelled learner abilities',
  checksum: 'zhiban-049-virtual-lab-persistence-v1',
  up: [
    `CREATE TABLE zhiban.virtual_lab_sessions (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      course_id VARCHAR(128) NOT NULL,
      chapter_id VARCHAR(128) NOT NULL,
      activity_id VARCHAR(128) NOT NULL,
      scenario_id VARCHAR(128) NOT NULL,
      attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
      status VARCHAR(24) NOT NULL DEFAULT 'in_progress' CHECK(status IN('in_progress','completed','abandoned')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      duration_seconds INTEGER CHECK(duration_seconds >= 0),
      overall_score NUMERIC(5,2) CHECK(overall_score >= 0 AND overall_score <= 100),
      assessment_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      weak_points_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      recommendations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      hints_used INTEGER NOT NULL DEFAULT 0 CHECK(hints_used >= 0),
      wrong_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
      actions_count INTEGER NOT NULL DEFAULT 0 CHECK(actions_count >= 0),
      verification_passed BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(user_id, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE,
      UNIQUE(tenant_id, user_id, course_id, activity_id, scenario_id, attempt_number),
      CHECK(jsonb_typeof(assessment_json) = 'object'),
      CHECK(jsonb_typeof(weak_points_json) = 'array'),
      CHECK(jsonb_typeof(recommendations_json) = 'array'),
      CHECK(jsonb_typeof(wrong_actions) = 'array')
    )`,
    `CREATE TABLE zhiban.virtual_lab_actions (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      session_id UUID NOT NULL,
      action_type VARCHAR(100) NOT NULL,
      target VARCHAR(128),
      value JSONB,
      unit VARCHAR(32),
      phase VARCHAR(64),
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(session_id, tenant_id) REFERENCES zhiban.virtual_lab_sessions(id, tenant_id) ON DELETE CASCADE,
      CHECK(value IS NULL OR jsonb_typeof(value) IN ('string','number','boolean','object','array','null')),
      CHECK(jsonb_typeof(payload_json) = 'object')
    )`,
    `CREATE TABLE zhiban.virtual_lab_learner_profiles (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      course_id VARCHAR(128) NOT NULL,
      activity_id VARCHAR(128) NOT NULL,
      scenario_id VARCHAR(128) NOT NULL,
      dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
      weak_points_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      performance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_label VARCHAR(200) NOT NULL DEFAULT 'Virtual Lab 实训 Assessment',
      source_attempts INTEGER NOT NULL DEFAULT 0 CHECK(source_attempts >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(user_id, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE,
      UNIQUE(tenant_id, user_id, course_id, activity_id, scenario_id),
      CHECK(jsonb_typeof(dimensions) = 'object'),
      CHECK(jsonb_typeof(weak_points_json) = 'array'),
      CHECK(jsonb_typeof(performance_json) = 'object')
    )`,
    ...tables.flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING (tenant_id=${tenantSetting}) WITH CHECK (tenant_id=${tenantSetting})`,
    ]),
    `CREATE INDEX virtual_lab_sessions_student_history_idx ON zhiban.virtual_lab_sessions(tenant_id,user_id,course_id,activity_id,scenario_id,completed_at DESC)`,
    `CREATE INDEX virtual_lab_sessions_course_completed_idx ON zhiban.virtual_lab_sessions(tenant_id,course_id,activity_id,scenario_id,completed_at DESC) WHERE status='completed'`,
    `CREATE INDEX virtual_lab_actions_session_time_idx ON zhiban.virtual_lab_actions(tenant_id,session_id,created_at)`,
  ],
  down: tables.slice().reverse().map((table) => `DROP TABLE IF EXISTS zhiban.${table}`),
};
