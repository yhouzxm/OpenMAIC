import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;
const tables = ['course_classrooms', 'classroom_learning_sessions', 'classroom_learning_events'];

export const openmaicClassroomAdaptationMigration: ZhibanMigration = {
  version: '011',
  description: 'OpenMAIC classroom bindings, learner sessions, progress, and event audit',
  checksum: 'zhiban-011-openmaic-classroom-adaptation-v1',
  up: [
    `CREATE TABLE zhiban.course_classrooms (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, course_id UUID NOT NULL,
      classroom_id VARCHAR(160) NOT NULL, title VARCHAR(300) NOT NULL, description TEXT NOT NULL DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 0, opens_at TIMESTAMPTZ, closes_at TIMESTAMPTZ,
      status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
      created_by UUID NOT NULL, updated_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),
      FOREIGN KEY (updated_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),
      UNIQUE (tenant_id,course_id,classroom_id), UNIQUE (id,tenant_id))`,
    `CREATE TABLE zhiban.classroom_learning_sessions (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, course_classroom_id UUID NOT NULL, student_id UUID NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
      progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
      current_scene_id VARCHAR(160), visited_scene_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ,
      FOREIGN KEY (course_classroom_id,tenant_id) REFERENCES zhiban.course_classrooms(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      UNIQUE (course_classroom_id,student_id), UNIQUE (id,tenant_id), CHECK (jsonb_typeof(visited_scene_ids)='array'))`,
    `CREATE TABLE zhiban.classroom_learning_events (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, session_id UUID NOT NULL, event_id UUID NOT NULL,
      event_type VARCHAR(40) NOT NULL CHECK (event_type IN ('classroom_opened','scene_viewed','interaction','classroom_completed')),
      scene_id VARCHAR(160), payload JSONB NOT NULL DEFAULT '{}'::jsonb, occurred_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (session_id,tenant_id) REFERENCES zhiban.classroom_learning_sessions(id,tenant_id) ON DELETE CASCADE,
      UNIQUE (tenant_id,event_id), CHECK (jsonb_typeof(payload)='object'))`,
    ...tables.flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING (tenant_id=${tenantSetting}) WITH CHECK (tenant_id=${tenantSetting})`,
    ]),
    `CREATE INDEX course_classrooms_course_order_idx ON zhiban.course_classrooms(tenant_id,course_id,status,display_order)`,
    `CREATE INDEX classroom_sessions_student_idx ON zhiban.classroom_learning_sessions(tenant_id,student_id,last_activity_at DESC)`,
    `CREATE INDEX classroom_events_session_time_idx ON zhiban.classroom_learning_events(session_id,occurred_at)`,
  ],
  down: tables.slice().reverse().map((table) => `DROP TABLE IF EXISTS zhiban.${table}`),
};
