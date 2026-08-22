import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;

export const courseTutorMigration: ZhibanMigration = {
  version: '038',
  description: 'course-level Tutor configuration, knowledge retrieval, conversations, and feedback',
  checksum: 'zhiban-038-course-tutor-v1',
  up: [
    `CREATE TABLE zhiban.course_tutor_configs (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,enabled BOOLEAN NOT NULL DEFAULT true,
      display_name VARCHAR(120) NOT NULL DEFAULT '课程 Tutor',welcome_message TEXT NOT NULL DEFAULT '你好，我可以帮助你理解课程知识和拆解学习任务。',
      system_prompt TEXT NOT NULL DEFAULT '',retrieval_top_k INTEGER NOT NULL DEFAULT 5 CHECK(retrieval_top_k BETWEEN 1 AND 12),
      citation_required BOOLEAN NOT NULL DEFAULT true,answer_scope VARCHAR(24) NOT NULL DEFAULT 'course_only' CHECK(answer_scope IN('course_only','course_first')),
      max_history_messages INTEGER NOT NULL DEFAULT 12 CHECK(max_history_messages BETWEEN 2 AND 40),status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK(status IN('draft','published','disabled')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),updated_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,course_id),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(updated_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE zhiban.course_tutor_documents (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,source_type VARCHAR(32) NOT NULL
        CHECK(source_type IN('activity_content','course_resource','assignment','manual')),source_id VARCHAR(160) NOT NULL,
      title VARCHAR(300) NOT NULL,content TEXT NOT NULL,checksum VARCHAR(64) NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK(status IN('active','archived','unsupported')),metadata JSONB NOT NULL DEFAULT '{}'::jsonb,synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,course_id,source_type,source_id),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,CHECK(jsonb_typeof(metadata)='object')
    )`,
    `CREATE TABLE zhiban.course_tutor_chunks (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,document_id UUID NOT NULL,chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,token_estimate INTEGER NOT NULL DEFAULT 0,search_vector TSVECTOR GENERATED ALWAYS AS(to_tsvector('simple',content)) STORED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(document_id,chunk_index),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(document_id,tenant_id) REFERENCES zhiban.course_tutor_documents(id,tenant_id) ON DELETE CASCADE
    )`,
    `CREATE TABLE zhiban.course_tutor_sessions (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,student_id UUID NOT NULL,title VARCHAR(240) NOT NULL DEFAULT '课程辅导',
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE
    )`,
    `CREATE TABLE zhiban.course_tutor_messages (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,session_id UUID NOT NULL,student_id UUID NOT NULL,
      role VARCHAR(16) NOT NULL CHECK(role IN('user','assistant')),content TEXT NOT NULL,citations JSONB NOT NULL DEFAULT '[]'::jsonb,
      prompt_version VARCHAR(40) NOT NULL DEFAULT 'v1',model_id VARCHAR(160),latency_ms INTEGER,input_tokens INTEGER,output_tokens INTEGER,
      status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK(status IN('completed','blocked','failed')),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(session_id,tenant_id) REFERENCES zhiban.course_tutor_sessions(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,CHECK(jsonb_typeof(citations)='array')
    )`,
    `CREATE TABLE zhiban.course_tutor_feedback (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,message_id UUID NOT NULL,student_id UUID NOT NULL,
      rating SMALLINT NOT NULL CHECK(rating IN(-1,1)),comment TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,message_id,student_id),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(message_id,tenant_id) REFERENCES zhiban.course_tutor_messages(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE
    )`,
    `CREATE INDEX course_tutor_chunks_search_idx ON zhiban.course_tutor_chunks USING GIN(search_vector)`,
    `CREATE INDEX course_tutor_sessions_student_idx ON zhiban.course_tutor_sessions(tenant_id,student_id,course_id,last_message_at DESC)`,
    `CREATE INDEX course_tutor_messages_session_idx ON zhiban.course_tutor_messages(tenant_id,session_id,created_at)`,
    ...['course_tutor_configs','course_tutor_documents','course_tutor_chunks','course_tutor_sessions','course_tutor_messages','course_tutor_feedback'].flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
    ]),
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.course_tutor_feedback`,
    `DROP TABLE IF EXISTS zhiban.course_tutor_messages`,
    `DROP TABLE IF EXISTS zhiban.course_tutor_sessions`,
    `DROP TABLE IF EXISTS zhiban.course_tutor_chunks`,
    `DROP TABLE IF EXISTS zhiban.course_tutor_documents`,
    `DROP TABLE IF EXISTS zhiban.course_tutor_configs`,
  ],
};
