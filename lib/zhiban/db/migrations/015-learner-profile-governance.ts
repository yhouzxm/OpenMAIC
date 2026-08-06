import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;

export const learnerProfileGovernanceMigration: ZhibanMigration = {
  version: '015',
  description:
    'Learner profile collection preferences, corrections, retention, and governance audit',
  checksum: 'zhiban-015-learner-profile-governance-v1',
  up: [
    `ALTER TABLE zhiban.learning_events ADD COLUMN expires_at TIMESTAMPTZ`,
    `UPDATE zhiban.learning_events SET expires_at=occurred_at+INTERVAL '730 days' WHERE expires_at IS NULL`,
    `CREATE INDEX learning_events_expiry_idx ON zhiban.learning_events(tenant_id,expires_at) WHERE expires_at IS NOT NULL`,
    `CREATE TABLE zhiban.learner_profile_preferences (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,learner_id UUID NOT NULL,course_id UUID NOT NULL,
      collection_enabled BOOLEAN NOT NULL DEFAULT true,retention_days INTEGER NOT NULL DEFAULT 730 CHECK(retention_days BETWEEN 30 AND 3650),
      changed_by UUID NOT NULL,changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      UNIQUE(tenant_id,learner_id,course_id))`,
    `CREATE TABLE zhiban.learner_profile_corrections (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,learner_id UUID NOT NULL,course_id UUID NOT NULL,
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 2000),status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','rejected','cancelled')),
      resolution TEXT,resolved_by UUID,resolved_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE)`,
    ...['learner_profile_preferences', 'learner_profile_corrections'].flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING (tenant_id=${tenantSetting}) WITH CHECK (tenant_id=${tenantSetting})`,
    ]),
    `CREATE INDEX learner_profile_corrections_course_status_idx ON zhiban.learner_profile_corrections(tenant_id,course_id,status,created_at DESC)`,
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.learner_profile_corrections`,
    `DROP TABLE IF EXISTS zhiban.learner_profile_preferences`,
    `DROP INDEX IF EXISTS zhiban.learning_events_expiry_idx`,
    `ALTER TABLE zhiban.learning_events DROP COLUMN IF EXISTS expires_at`,
  ],
};
