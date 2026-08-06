import type { ZhibanMigration } from './001-initial-identity';
const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;
const tables = ['learning_events', 'learner_profiles', 'learner_profile_snapshots'];
export const learningEventsProfilesMigration: ZhibanMigration = {
  version: '014',
  description: 'Unified learning event ledger and explainable learner profile snapshots',
  checksum: 'zhiban-014-learning-events-profiles-v1',
  up: [
    `CREATE TABLE zhiban.learning_events (id UUID PRIMARY KEY,tenant_id UUID NOT NULL,learner_id UUID NOT NULL,course_id UUID NOT NULL,source_kind VARCHAR(24) NOT NULL CHECK(source_kind IN('classroom','pbl','quiz','submission','evaluation','system')),source_id VARCHAR(200) NOT NULL,event_type VARCHAR(100) NOT NULL,project_id UUID,classroom_binding_id UUID,payload JSONB NOT NULL DEFAULT '{}'::jsonb,occurred_at TIMESTAMPTZ NOT NULL,received_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,UNIQUE(tenant_id,source_kind,source_id),CHECK(jsonb_typeof(payload)='object'))`,
    `CREATE TABLE zhiban.learner_profiles (id UUID PRIMARY KEY,tenant_id UUID NOT NULL,learner_id UUID NOT NULL,course_id UUID NOT NULL,dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,algorithm_version VARCHAR(40) NOT NULL,profile_version INTEGER NOT NULL DEFAULT 1 CHECK(profile_version>0),event_count INTEGER NOT NULL DEFAULT 0,computed_from TIMESTAMPTZ,computed_to TIMESTAMPTZ,computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,UNIQUE(tenant_id,learner_id,course_id),UNIQUE(id,tenant_id),CHECK(jsonb_typeof(dimensions)='object'),CHECK(jsonb_typeof(evidence_summary)='object'))`,
    `CREATE TABLE zhiban.learner_profile_snapshots (id UUID PRIMARY KEY,tenant_id UUID NOT NULL,profile_id UUID NOT NULL,profile_version INTEGER NOT NULL,dimensions JSONB NOT NULL,evidence_summary JSONB NOT NULL,algorithm_version VARCHAR(40) NOT NULL,event_count INTEGER NOT NULL,computed_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(profile_id,tenant_id) REFERENCES zhiban.learner_profiles(id,tenant_id) ON DELETE CASCADE,UNIQUE(profile_id,profile_version),CHECK(jsonb_typeof(dimensions)='object'),CHECK(jsonb_typeof(evidence_summary)='object'))`,
    ...tables.flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING (tenant_id=${tenantSetting}) WITH CHECK (tenant_id=${tenantSetting})`,
    ]),
    `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,classroom_binding_id,payload,occurred_at,received_at) SELECT e.id,e.tenant_id,s.student_id,cc.course_id,'classroom',e.id::text,e.event_type,cc.id,e.payload,e.occurred_at,e.received_at FROM zhiban.classroom_learning_events e JOIN zhiban.classroom_learning_sessions s ON s.id=e.session_id JOIN zhiban.course_classrooms cc ON cc.id=s.course_classroom_id ON CONFLICT DO NOTHING`,
    `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,project_id,payload,occurred_at) SELECT e.id,e.tenant_id,i.student_id,p.course_id,'pbl',e.id::text,e.event_type,p.id,e.payload,e.occurred_at FROM zhiban.pbl_learning_events e JOIN zhiban.pbl_project_instances i ON i.id=e.instance_id JOIN zhiban.pbl_projects p ON p.id=i.project_id ON CONFLICT DO NOTHING`,
    `CREATE INDEX learning_events_learner_course_time_idx ON zhiban.learning_events(tenant_id,learner_id,course_id,occurred_at DESC)`,
    `CREATE INDEX learner_profiles_course_idx ON zhiban.learner_profiles(tenant_id,course_id,computed_at DESC)`,
  ],
  down: tables
    .slice()
    .reverse()
    .map((table) => `DROP TABLE IF EXISTS zhiban.${table}`),
};
