import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;
const newTables = ['pbl_project_templates','pbl_rubrics','pbl_rubric_criteria','pbl_grade_items','pbl_tasks','pbl_groups','pbl_group_members','pbl_grouping_rules','pbl_rubric_scores'];

export const pblCollaborationAssessmentMigration: ZhibanMigration = {
  version: '010',
  description: 'PBL templates, dependency tasks, groups, versioned review, rubrics, and grade items',
  checksum: 'zhiban-010-pbl-collaboration-assessment-v1',
  up: [
    `CREATE TABLE zhiban.pbl_project_templates (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, code VARCHAR(80) NOT NULL, name VARCHAR(200) NOT NULL,
      description TEXT NOT NULL DEFAULT '', definition JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
      status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
      created_by UUID NOT NULL, updated_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id), FOREIGN KEY (updated_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),
      UNIQUE (tenant_id,code), UNIQUE (id,tenant_id), CHECK (jsonb_typeof(definition)='object'))`,
    `CREATE TABLE zhiban.pbl_rubrics (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, course_id UUID NOT NULL, name VARCHAR(200) NOT NULL, description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1 CHECK (version>0), status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
      created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id), UNIQUE (id,tenant_id))`,
    `CREATE TABLE zhiban.pbl_rubric_criteria (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, rubric_id UUID NOT NULL, code VARCHAR(80) NOT NULL, name VARCHAR(200) NOT NULL,
      description TEXT NOT NULL DEFAULT '', weight NUMERIC(5,2) NOT NULL CHECK (weight>0 AND weight<=100), max_score NUMERIC(7,2) NOT NULL DEFAULT 100 CHECK (max_score>0),
      levels JSONB NOT NULL DEFAULT '[]'::jsonb, display_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (rubric_id,tenant_id) REFERENCES zhiban.pbl_rubrics(id,tenant_id) ON DELETE CASCADE,
      UNIQUE (rubric_id,code), UNIQUE (id,tenant_id), CHECK (jsonb_typeof(levels)='array'))`,
    `CREATE TABLE zhiban.pbl_grade_items (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, course_id UUID NOT NULL, code VARCHAR(80) NOT NULL, name VARCHAR(200) NOT NULL,
      category VARCHAR(24) NOT NULL DEFAULT 'project' CHECK (category IN ('formative','project','final')),
      weight NUMERIC(5,2) NOT NULL CHECK (weight>=0 AND weight<=100), max_score NUMERIC(7,2) NOT NULL DEFAULT 100 CHECK (max_score>0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), FOREIGN KEY (course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      UNIQUE (tenant_id,course_id,code), UNIQUE (id,tenant_id))`,
    `ALTER TABLE zhiban.pbl_projects ADD COLUMN template_id UUID, ADD COLUMN rubric_id UUID, ADD COLUMN grade_item_id UUID,
      ADD FOREIGN KEY (template_id,tenant_id) REFERENCES zhiban.pbl_project_templates(id,tenant_id) ON DELETE SET NULL,
      ADD FOREIGN KEY (rubric_id,tenant_id) REFERENCES zhiban.pbl_rubrics(id,tenant_id) ON DELETE SET NULL,
      ADD FOREIGN KEY (grade_item_id,tenant_id) REFERENCES zhiban.pbl_grade_items(id,tenant_id) ON DELETE SET NULL`,
    `CREATE TABLE zhiban.pbl_tasks (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, project_id UUID NOT NULL, openmaic_task_id VARCHAR(160), milestone_id VARCHAR(160),
      title VARCHAR(300) NOT NULL, description TEXT NOT NULL DEFAULT '', display_order INTEGER NOT NULL,
      task_scope VARCHAR(24) NOT NULL DEFAULT 'individual' CHECK (task_scope IN ('individual','group')),
      dependencies JSONB NOT NULL DEFAULT '[]'::jsonb, status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      FOREIGN KEY (project_id,tenant_id) REFERENCES zhiban.pbl_projects(id,tenant_id) ON DELETE CASCADE,
      UNIQUE (project_id,openmaic_task_id), UNIQUE (id,tenant_id), CHECK (jsonb_typeof(dependencies)='array'))`,
    `CREATE TABLE zhiban.pbl_groups (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, project_id UUID NOT NULL, code VARCHAR(80) NOT NULL, name VARCHAR(200) NOT NULL,
      grouping_method VARCHAR(24) NOT NULL DEFAULT 'manual' CHECK (grouping_method IN ('manual','random','class','balanced')),
      max_members INTEGER CHECK (max_members IS NULL OR max_members>0), created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (project_id,tenant_id) REFERENCES zhiban.pbl_projects(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id), UNIQUE (project_id,code), UNIQUE (id,tenant_id))`,
    `CREATE TABLE zhiban.pbl_group_members (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, project_id UUID NOT NULL, group_id UUID NOT NULL, student_id UUID NOT NULL,
      group_role VARCHAR(24) NOT NULL DEFAULT 'member' CHECK (group_role IN ('leader','member','recorder','presenter')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), left_at TIMESTAMPTZ,
      FOREIGN KEY (group_id,tenant_id) REFERENCES zhiban.pbl_groups(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (project_id,tenant_id) REFERENCES zhiban.pbl_projects(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      UNIQUE (group_id,student_id), UNIQUE (id,tenant_id))`,
    `CREATE UNIQUE INDEX pbl_group_active_project_student_uq ON zhiban.pbl_group_members (tenant_id,project_id,student_id)
      WHERE left_at IS NULL`,
    `CREATE TABLE zhiban.pbl_grouping_rules (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, project_id UUID NOT NULL, method VARCHAR(24) NOT NULL CHECK (method IN ('random','class','balanced')),
      group_size INTEGER NOT NULL CHECK (group_size BETWEEN 2 AND 20), rules JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (project_id,tenant_id) REFERENCES zhiban.pbl_projects(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id), CHECK (jsonb_typeof(rules)='object'))`,
    `ALTER TABLE zhiban.pbl_submissions ADD COLUMN submitted_by UUID, ADD COLUMN group_id UUID,
      ADD COLUMN content_hash VARCHAR(128), ADD COLUMN hash_algorithm VARCHAR(24) NOT NULL DEFAULT 'sha256',
      ADD COLUMN review_status VARCHAR(24) NOT NULL DEFAULT 'submitted' CHECK (review_status IN ('submitted','changes_requested','approved')),
      ADD COLUMN reviewed_by UUID, ADD COLUMN teacher_feedback TEXT, ADD COLUMN reviewed_at TIMESTAMPTZ,
      ADD FOREIGN KEY (submitted_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),
      ADD FOREIGN KEY (group_id,tenant_id) REFERENCES zhiban.pbl_groups(id,tenant_id) ON DELETE SET NULL,
      ADD FOREIGN KEY (reviewed_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id)`,
    `UPDATE zhiban.pbl_submissions s SET submitted_by=i.student_id, content_hash=md5(s.content), hash_algorithm='legacy-md5'
      FROM zhiban.pbl_project_instances i WHERE i.id=s.instance_id`,
    `ALTER TABLE zhiban.pbl_submissions ALTER COLUMN submitted_by SET NOT NULL, ALTER COLUMN content_hash SET NOT NULL`,
    `ALTER TABLE zhiban.pbl_evaluations ADD CONSTRAINT pbl_evaluations_id_tenant_uq UNIQUE (id,tenant_id)`,
    `CREATE TABLE zhiban.pbl_rubric_scores (
      id UUID PRIMARY KEY, tenant_id UUID NOT NULL, evaluation_id UUID NOT NULL, criterion_id UUID NOT NULL,
      score NUMERIC(7,2) NOT NULL CHECK (score>=0), feedback TEXT NOT NULL DEFAULT '', scored_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (evaluation_id,tenant_id) REFERENCES zhiban.pbl_evaluations(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (criterion_id,tenant_id) REFERENCES zhiban.pbl_rubric_criteria(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (scored_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id), UNIQUE (evaluation_id,criterion_id))`,
    `ALTER TABLE zhiban.pbl_evaluations ADD COLUMN rubric_id UUID, ADD COLUMN grade_item_id UUID, ADD COLUMN teacher_reviewed BOOLEAN NOT NULL DEFAULT false,
      ADD FOREIGN KEY (rubric_id,tenant_id) REFERENCES zhiban.pbl_rubrics(id,tenant_id) ON DELETE SET NULL,
      ADD FOREIGN KEY (grade_item_id,tenant_id) REFERENCES zhiban.pbl_grade_items(id,tenant_id) ON DELETE SET NULL`,
    ...newTables.flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`, `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING (tenant_id=${tenantSetting}) WITH CHECK (tenant_id=${tenantSetting})`,
    ]),
    `CREATE INDEX pbl_tasks_project_order_idx ON zhiban.pbl_tasks(project_id,display_order)`,
    `CREATE INDEX pbl_group_members_student_idx ON zhiban.pbl_group_members(tenant_id,student_id,left_at)`,
    `CREATE INDEX pbl_submissions_review_idx ON zhiban.pbl_submissions(tenant_id,review_status,submitted_at)`,
  ],
  down: [
    `ALTER TABLE zhiban.pbl_evaluations DROP CONSTRAINT IF EXISTS pbl_evaluations_id_tenant_uq,DROP COLUMN IF EXISTS teacher_reviewed,DROP COLUMN IF EXISTS grade_item_id,DROP COLUMN IF EXISTS rubric_id`,
    `ALTER TABLE zhiban.pbl_submissions DROP COLUMN IF EXISTS reviewed_at,DROP COLUMN IF EXISTS teacher_feedback,DROP COLUMN IF EXISTS reviewed_by,DROP COLUMN IF EXISTS review_status,DROP COLUMN IF EXISTS hash_algorithm,DROP COLUMN IF EXISTS content_hash,DROP COLUMN IF EXISTS group_id,DROP COLUMN IF EXISTS submitted_by`,
    ...newTables.slice().reverse().map((table) => `DROP TABLE IF EXISTS zhiban.${table}`),
    `ALTER TABLE zhiban.pbl_projects DROP COLUMN IF EXISTS grade_item_id,DROP COLUMN IF EXISTS rubric_id,DROP COLUMN IF EXISTS template_id`,
  ],
};
