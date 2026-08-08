import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;
const tables = ['course_grade_items', 'course_assessments', 'assessment_questions', 'assessment_attempts', 'assessment_answers', 'course_grade_records', 'course_final_grades', 'grade_change_log'];

export const assessmentGradesMigration: ZhibanMigration = {
  version: '021',
  description: 'course assessments, gradebook, weighted final grades and publication audit',
  checksum: 'zhiban-021-assessment-grades-v1',
  up: [
    `CREATE TABLE zhiban.course_grade_items (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,code VARCHAR(80) NOT NULL,name VARCHAR(200) NOT NULL,
      category VARCHAR(24) NOT NULL CHECK(category IN('formative','project','final')),source_type VARCHAR(32) NOT NULL DEFAULT 'manual' CHECK(source_type IN('manual','assessment','pbl','classroom_quiz')),
      source_id VARCHAR(160),weight NUMERIC(6,3) NOT NULL CHECK(weight>=0 AND weight<=100),max_score NUMERIC(8,2) NOT NULL DEFAULT 100 CHECK(max_score>0),
      drop_lowest BOOLEAN NOT NULL DEFAULT false,status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),
      created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),UNIQUE(tenant_id,course_id,code),UNIQUE(id,tenant_id))`,
    `CREATE TABLE zhiban.course_assessments (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,grade_item_id UUID NOT NULL,title VARCHAR(240) NOT NULL,description TEXT NOT NULL DEFAULT '',
      assessment_type VARCHAR(24) NOT NULL CHECK(assessment_type IN('quiz','assignment','exam','practice')),max_attempts INTEGER NOT NULL DEFAULT 1 CHECK(max_attempts BETWEEN 1 AND 100),
      scoring_method VARCHAR(24) NOT NULL DEFAULT 'highest' CHECK(scoring_method IN('highest','latest','average')),opens_at TIMESTAMPTZ,due_at TIMESTAMPTZ,
      status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','closed','archived')),created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(grade_item_id,tenant_id) REFERENCES zhiban.course_grade_items(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),UNIQUE(id,tenant_id),CHECK(due_at IS NULL OR opens_at IS NULL OR due_at>=opens_at))`,
    `CREATE TABLE zhiban.assessment_questions (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,assessment_id UUID NOT NULL,question_type VARCHAR(24) NOT NULL CHECK(question_type IN('single_choice','multiple_choice','true_false','short_answer','essay')),
      prompt TEXT NOT NULL,options JSONB NOT NULL DEFAULT '[]'::jsonb,answer_key JSONB NOT NULL DEFAULT '{}'::jsonb,max_score NUMERIC(8,2) NOT NULL CHECK(max_score>0),display_order INTEGER NOT NULL,
      FOREIGN KEY(assessment_id,tenant_id) REFERENCES zhiban.course_assessments(id,tenant_id) ON DELETE CASCADE,UNIQUE(assessment_id,display_order),UNIQUE(id,tenant_id),CHECK(jsonb_typeof(options)='array'),CHECK(jsonb_typeof(answer_key)='object'))`,
    `CREATE TABLE zhiban.assessment_attempts (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,assessment_id UUID NOT NULL,student_id UUID NOT NULL,attempt_no INTEGER NOT NULL CHECK(attempt_no>0),
      status VARCHAR(24) NOT NULL DEFAULT 'in_progress' CHECK(status IN('in_progress','submitted','graded','void')),score NUMERIC(8,2),started_at TIMESTAMPTZ NOT NULL DEFAULT now(),submitted_at TIMESTAMPTZ,graded_at TIMESTAMPTZ,graded_by UUID,
      FOREIGN KEY(assessment_id,tenant_id) REFERENCES zhiban.course_assessments(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(graded_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),UNIQUE(assessment_id,student_id,attempt_no),UNIQUE(id,tenant_id))`,
    `CREATE TABLE zhiban.assessment_answers (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,attempt_id UUID NOT NULL,question_id UUID NOT NULL,answer JSONB NOT NULL,score NUMERIC(8,2),feedback TEXT NOT NULL DEFAULT '',is_auto_graded BOOLEAN NOT NULL DEFAULT false,
      answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(attempt_id,tenant_id) REFERENCES zhiban.assessment_attempts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(question_id,tenant_id) REFERENCES zhiban.assessment_questions(id,tenant_id) ON DELETE CASCADE,UNIQUE(attempt_id,question_id),CHECK(jsonb_typeof(answer) IN('object','array','string','number','boolean')))` ,
    `CREATE TABLE zhiban.course_grade_records (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,grade_item_id UUID NOT NULL,student_id UUID NOT NULL,raw_score NUMERIC(8,2),normalized_score NUMERIC(8,4),
      status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','excused','void')),source_type VARCHAR(32) NOT NULL,source_id VARCHAR(160),feedback TEXT NOT NULL DEFAULT '',
      is_override BOOLEAN NOT NULL DEFAULT false,graded_by UUID,graded_at TIMESTAMPTZ,published_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(grade_item_id,tenant_id) REFERENCES zhiban.course_grade_items(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(graded_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),
      UNIQUE(tenant_id,grade_item_id,student_id),UNIQUE(id,tenant_id),CHECK(normalized_score IS NULL OR normalized_score BETWEEN 0 AND 100))`,
    `CREATE TABLE zhiban.course_final_grades (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,student_id UUID NOT NULL,formative_score NUMERIC(8,4),project_score NUMERIC(8,4),final_exam_score NUMERIC(8,4),total_score NUMERIC(8,4),
      letter_grade VARCHAR(12),status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','withdrawn')),calculation JSONB NOT NULL DEFAULT '{}'::jsonb,version INTEGER NOT NULL DEFAULT 1,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),published_at TIMESTAMPTZ,published_by UUID,
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(published_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),UNIQUE(tenant_id,course_id,student_id),UNIQUE(id,tenant_id),CHECK(jsonb_typeof(calculation)='object'))`,
    `CREATE TABLE zhiban.grade_change_log (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,student_id UUID,grade_record_id UUID,final_grade_id UUID,actor_id UUID NOT NULL,action VARCHAR(40) NOT NULL,
      before_value JSONB,after_value JSONB,reason TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(actor_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),FOREIGN KEY(grade_record_id,tenant_id) REFERENCES zhiban.course_grade_records(id,tenant_id) ON DELETE SET NULL,
      FOREIGN KEY(final_grade_id,tenant_id) REFERENCES zhiban.course_final_grades(id,tenant_id) ON DELETE SET NULL,CHECK(before_value IS NULL OR jsonb_typeof(before_value)='object'),CHECK(after_value IS NULL OR jsonb_typeof(after_value)='object'))`,
    ...tables.flatMap((table) => [`ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`, `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`, `CREATE POLICY tenant_isolation ON zhiban.${table} USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`]),
    `CREATE INDEX course_grade_records_course_student_idx ON zhiban.course_grade_records(tenant_id,course_id,student_id)`,
    `CREATE INDEX course_final_grades_course_status_idx ON zhiban.course_final_grades(tenant_id,course_id,status)`,
    `CREATE INDEX assessment_attempts_student_idx ON zhiban.assessment_attempts(tenant_id,student_id,assessment_id,attempt_no DESC)`,
  ],
  down: tables.slice().reverse().map((table) => `DROP TABLE IF EXISTS zhiban.${table}`),
};
