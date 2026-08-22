import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;

export const courseworkCompletionMigration: ZhibanMigration = {
  version: '037',
  description:
    'resource history, activity assignments, discussion grading, and course learning events',
  checksum: 'zhiban-037-coursework-completion-v1',
  up: [
    `CREATE TABLE zhiban.course_resource_versions (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,resource_id UUID NOT NULL,version INTEGER NOT NULL,
      title VARCHAR(240) NOT NULL,description TEXT NOT NULL DEFAULT '',url TEXT,file_name VARCHAR(500),mime_type VARCHAR(200),
      file_size BIGINT,content BYTEA,download_allowed BOOLEAN NOT NULL,ai_index_enabled BOOLEAN NOT NULL,
      created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(resource_id,version),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(resource_id,tenant_id) REFERENCES zhiban.course_resources_v2(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE zhiban.activity_assignments (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,activity_id UUID NOT NULL,title VARCHAR(240) NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',submission_type VARCHAR(20) NOT NULL DEFAULT 'mixed' CHECK(submission_type IN('text','file','mixed')),
      max_files INTEGER NOT NULL DEFAULT 5 CHECK(max_files BETWEEN 0 AND 20),max_file_size BIGINT NOT NULL DEFAULT 15728640 CHECK(max_file_size BETWEEN 1 AND 52428800),
      max_attempts INTEGER NOT NULL DEFAULT 1 CHECK(max_attempts BETWEEN 1 AND 100),opens_at TIMESTAMPTZ,due_at TIMESTAMPTZ,
      allow_late BOOLEAN NOT NULL DEFAULT false,status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','closed','archived')),
      grade_item_id UUID,created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,activity_id),UNIQUE(id,tenant_id),FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id,tenant_id) REFERENCES zhiban.course_activities(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(grade_item_id) REFERENCES zhiban.course_grade_items(id) ON DELETE SET NULL,
      FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT,
      CHECK(due_at IS NULL OR opens_at IS NULL OR due_at>=opens_at)
    )`,
    `CREATE TABLE zhiban.activity_assignment_submissions (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,assignment_id UUID NOT NULL,student_id UUID NOT NULL,
      attempt_no INTEGER NOT NULL CHECK(attempt_no>0),text_content TEXT NOT NULL DEFAULT '',status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK(status IN('draft','submitted','returned','graded')),is_late BOOLEAN NOT NULL DEFAULT false,content_hash VARCHAR(64),
      feedback TEXT NOT NULL DEFAULT '',score NUMERIC(8,2),started_at TIMESTAMPTZ NOT NULL DEFAULT now(),submitted_at TIMESTAMPTZ,
      returned_at TIMESTAMPTZ,graded_at TIMESTAMPTZ,graded_by UUID,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(assignment_id,student_id,attempt_no),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(assignment_id,tenant_id) REFERENCES zhiban.activity_assignments(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(graded_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT,
      CHECK(score IS NULL OR score BETWEEN 0 AND 100)
    )`,
    `CREATE TABLE zhiban.activity_assignment_files (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,submission_id UUID NOT NULL,file_name VARCHAR(500) NOT NULL,
      mime_type VARCHAR(200) NOT NULL,file_size BIGINT NOT NULL,content BYTEA NOT NULL,content_hash VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(submission_id,tenant_id) REFERENCES zhiban.activity_assignment_submissions(id,tenant_id) ON DELETE CASCADE
    )`,
    `ALTER TABLE zhiban.discussion_topics ADD COLUMN grade_item_id UUID,
      ADD CONSTRAINT discussion_topics_grade_item_fk FOREIGN KEY(grade_item_id)
      REFERENCES zhiban.course_grade_items(id) ON DELETE SET NULL`,
    `CREATE TABLE zhiban.discussion_scores (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,topic_id UUID NOT NULL,student_id UUID NOT NULL,
      score NUMERIC(8,2) NOT NULL CHECK(score BETWEEN 0 AND 100),feedback TEXT NOT NULL DEFAULT '',graded_by UUID NOT NULL,
      graded_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,topic_id,student_id),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(topic_id,tenant_id) REFERENCES zhiban.discussion_topics(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(graded_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT
    )`,
    `CREATE INDEX activity_assignments_course_idx ON zhiban.activity_assignments(tenant_id,course_id,status)`,
    `CREATE INDEX activity_assignment_submissions_teacher_idx ON zhiban.activity_assignment_submissions(tenant_id,course_id,status,submitted_at)`,
    `CREATE INDEX activity_assignment_submissions_student_idx ON zhiban.activity_assignment_submissions(tenant_id,student_id,assignment_id,attempt_no DESC)`,
    ...[
      'course_resource_versions',
      'activity_assignments',
      'activity_assignment_submissions',
      'activity_assignment_files',
      'discussion_scores',
    ].flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
    ]),
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.discussion_scores`,
    `ALTER TABLE zhiban.discussion_topics DROP CONSTRAINT IF EXISTS discussion_topics_grade_item_fk,DROP COLUMN IF EXISTS grade_item_id`,
    `DROP TABLE IF EXISTS zhiban.activity_assignment_files`,
    `DROP TABLE IF EXISTS zhiban.activity_assignment_submissions`,
    `DROP TABLE IF EXISTS zhiban.activity_assignments`,
    `DROP TABLE IF EXISTS zhiban.course_resource_versions`,
  ],
};
