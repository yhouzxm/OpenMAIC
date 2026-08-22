import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;

export const courseActivityGovernanceMigration: ZhibanMigration = {
  version: '035',
  description: 'course activity dependencies, completion progress, and safe structure governance',
  checksum: 'zhiban-035-course-activity-governance-v1',
  up: [
    `CREATE TABLE zhiban.course_activity_dependencies (
      tenant_id UUID NOT NULL,course_id UUID NOT NULL,activity_id UUID NOT NULL,prerequisite_activity_id UUID NOT NULL,
      dependency_type VARCHAR(24) NOT NULL DEFAULT 'completed' CHECK(dependency_type IN('completed','score')),
      minimum_score NUMERIC(5,2),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(activity_id,prerequisite_activity_id),
      FOREIGN KEY(activity_id,tenant_id) REFERENCES zhiban.course_activities(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(prerequisite_activity_id,tenant_id) REFERENCES zhiban.course_activities(id,tenant_id) ON DELETE RESTRICT,
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      CHECK(activity_id<>prerequisite_activity_id),CHECK(minimum_score IS NULL OR minimum_score BETWEEN 0 AND 100)
    )`,
    `CREATE TABLE zhiban.student_activity_progress (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,activity_id UUID NOT NULL,student_id UUID NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'not_started' CHECK(status IN('not_started','in_progress','completed')),
      progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),score NUMERIC(5,2),
      started_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,activity_id,student_id),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id,tenant_id) REFERENCES zhiban.course_activities(id,tenant_id) ON DELETE RESTRICT,
      FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      CHECK(score IS NULL OR score BETWEEN 0 AND 100)
    )`,
    `CREATE INDEX course_activity_dependencies_course_idx ON zhiban.course_activity_dependencies(tenant_id,course_id)`,
    `CREATE INDEX student_activity_progress_student_idx ON zhiban.student_activity_progress(tenant_id,student_id,course_id,status)`,
    ...['course_activity_dependencies', 'student_activity_progress'].flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
    ]),
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.student_activity_progress`,
    `DROP TABLE IF EXISTS zhiban.course_activity_dependencies`,
  ],
};
