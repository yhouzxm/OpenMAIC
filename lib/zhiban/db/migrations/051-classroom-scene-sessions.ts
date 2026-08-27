import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;

export const classroomSceneSessionsMigration: ZhibanMigration = {
  version: '051',
  description: 'Shared classroom scene dispatch sessions for lightweight teacher-led learning',
  checksum: 'zhiban-051-classroom-scene-sessions-v1',
  up: [
    `CREATE TABLE zhiban.classroom_scene_sessions (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      course_classroom_id UUID NOT NULL,
      active_scene_id VARCHAR(32),
      dispatch_type VARCHAR(24) NOT NULL CHECK(dispatch_type IN ('SCENE','VIRTUAL_LAB')),
      dispatch_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(dispatch_payload)='object'),
      status VARCHAR(24) NOT NULL DEFAULT 'PREPARED' CHECK(status IN ('PREPARED','ACTIVE','COMPLETED')),
      version INTEGER NOT NULL CHECK(version > 0),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_by UUID NOT NULL,
      updated_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(course_classroom_id,tenant_id) REFERENCES zhiban.course_classrooms(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),
      FOREIGN KEY(updated_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),
      UNIQUE(tenant_id,course_classroom_id,version),
      UNIQUE(id,tenant_id)
    )`,
    `CREATE INDEX classroom_scene_sessions_current_idx ON zhiban.classroom_scene_sessions(tenant_id,course_classroom_id,version DESC)`,
    `ALTER TABLE zhiban.classroom_scene_sessions ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.classroom_scene_sessions FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.classroom_scene_sessions USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
  ],
  down: ['DROP TABLE IF EXISTS zhiban.classroom_scene_sessions'],
};
