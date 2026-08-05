import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;

export const teacherCourseSettingsMigration: ZhibanMigration = {
  version: '007',
  description: 'teacher-managed course settings and version history',
  checksum: 'zhiban-007-teacher-course-settings-v1',
  up: [
    `CREATE TABLE zhiban.course_settings (
      course_id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      delivery_mode VARCHAR(24) NOT NULL DEFAULT 'blended'
        CHECK (delivery_mode IN ('online', 'blended', 'face_to_face')),
      learning_objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
      teaching_notes TEXT,
      pbl_enabled BOOLEAN NOT NULL DEFAULT true,
      pbl_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      agent_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      publication_status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (publication_status IN ('draft', 'published')),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      updated_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (course_id, tenant_id) REFERENCES zhiban.courses(id, tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE RESTRICT,
      CHECK (jsonb_typeof(learning_objectives) = 'array'),
      CHECK (jsonb_typeof(pbl_settings) = 'object'),
      CHECK (jsonb_typeof(agent_settings) = 'object')
    )`,
    `CREATE TABLE zhiban.course_setting_versions (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id UUID NOT NULL,
      course_id UUID NOT NULL,
      version INTEGER NOT NULL,
      snapshot JSONB NOT NULL,
      changed_by UUID NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (course_id, tenant_id) REFERENCES zhiban.courses(id, tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (changed_by, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE RESTRICT,
      UNIQUE (course_id, version), CHECK (jsonb_typeof(snapshot) = 'object')
    )`,
    ...['course_settings', 'course_setting_versions'].flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table}
        USING (tenant_id = ${tenantSetting}) WITH CHECK (tenant_id = ${tenantSetting})`,
    ]),
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.course_setting_versions`,
    `DROP TABLE IF EXISTS zhiban.course_settings`,
  ],
};
