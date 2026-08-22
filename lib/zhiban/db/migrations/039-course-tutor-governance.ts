import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;

export const courseTutorGovernanceMigration: ZhibanMigration = {
  version: '039',
  description: 'course Tutor synchronization, idempotency, safety governance, and analytics',
  checksum: 'zhiban-039-course-tutor-governance-v1',
  up: [
    `ALTER TABLE zhiban.course_tutor_configs
      ADD COLUMN auto_sync BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN last_synced_at TIMESTAMPTZ,
      ADD COLUMN last_sync_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(last_sync_status IN('pending','running','succeeded','failed')),
      ADD COLUMN last_sync_error TEXT`,
    `ALTER TABLE zhiban.course_tutor_messages
      ADD COLUMN request_id UUID,
      ADD COLUMN safety_category VARCHAR(40),
      ADD COLUMN context JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(context)='object')`,
    `CREATE UNIQUE INDEX course_tutor_messages_request_idx ON zhiban.course_tutor_messages(tenant_id,student_id,request_id) WHERE request_id IS NOT NULL AND role='assistant'`,
    `CREATE TABLE zhiban.course_tutor_sync_runs (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,trigger_type VARCHAR(20) NOT NULL
        CHECK(trigger_type IN('manual','automatic')),status VARCHAR(20) NOT NULL CHECK(status IN('running','succeeded','failed')),
      source_count INTEGER NOT NULL DEFAULT 0,changed_count INTEGER NOT NULL DEFAULT 0,error_message TEXT,started_by UUID,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),finished_at TIMESTAMPTZ,UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(started_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE SET NULL
    )`,
    `CREATE INDEX course_tutor_sync_runs_course_idx ON zhiban.course_tutor_sync_runs(tenant_id,course_id,started_at DESC)`,
    `ALTER TABLE zhiban.course_tutor_sync_runs ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.course_tutor_sync_runs FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.course_tutor_sync_runs USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.course_tutor_sync_runs`,
    `DROP INDEX IF EXISTS zhiban.course_tutor_messages_request_idx`,
    `ALTER TABLE zhiban.course_tutor_messages DROP COLUMN IF EXISTS context,DROP COLUMN IF EXISTS safety_category,DROP COLUMN IF EXISTS request_id`,
    `ALTER TABLE zhiban.course_tutor_configs DROP COLUMN IF EXISTS last_sync_error,DROP COLUMN IF EXISTS last_sync_status,DROP COLUMN IF EXISTS last_synced_at,DROP COLUMN IF EXISTS auto_sync`,
  ],
};
