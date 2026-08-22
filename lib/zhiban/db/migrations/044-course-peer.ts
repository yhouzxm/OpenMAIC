import type { ZhibanMigration } from './001-initial-identity';

const tenant = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;
const tables = ['course_peer_configs', 'course_peer_sessions', 'course_peer_messages', 'course_peer_feedback'];

export const coursePeerMigration: ZhibanMigration = {
  version: '044',
  description: 'course-level Peer companion configuration, safe conversations, and feedback',
  checksum: 'zhiban-044-course-peer-v1',
  up: [
    `CREATE TABLE zhiban.course_peer_configs (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,enabled BOOLEAN NOT NULL DEFAULT true,
      display_name VARCHAR(120) NOT NULL DEFAULT '智伴 Peer',welcome_message TEXT NOT NULL DEFAULT '最近学习感觉怎么样？如果遇到困难，可以和我聊聊。',
      system_prompt TEXT NOT NULL DEFAULT '',proactive_enabled BOOLEAN NOT NULL DEFAULT true,emotion_check_enabled BOOLEAN NOT NULL DEFAULT true,
      cooldown_minutes INTEGER NOT NULL DEFAULT 120 CHECK(cooldown_minutes BETWEEN 10 AND 10080),max_turns INTEGER NOT NULL DEFAULT 8 CHECK(max_turns BETWEEN 2 AND 30),
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','disabled')),version INTEGER NOT NULL DEFAULT 1,
      updated_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,course_id),UNIQUE(id,tenant_id),FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(updated_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT)`,
    `CREATE TABLE zhiban.course_peer_sessions (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,student_id UUID NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN('active','archived','escalated')),
      turn_count INTEGER NOT NULL DEFAULT 0,last_emotion VARCHAR(24) NOT NULL DEFAULT 'neutral',last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE)`,
    `CREATE TABLE zhiban.course_peer_messages (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,session_id UUID NOT NULL,student_id UUID NOT NULL,
      role VARCHAR(16) NOT NULL CHECK(role IN('user','assistant')),content TEXT NOT NULL,emotion_label VARCHAR(24) NOT NULL DEFAULT 'neutral',
      risk_level VARCHAR(16) NOT NULL DEFAULT 'none' CHECK(risk_level IN('none','low','high')),safety_category VARCHAR(32),
      status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK(status IN('completed','blocked','failed')),request_id UUID,
      prompt_version VARCHAR(40) NOT NULL DEFAULT 'peer-v1',model_id VARCHAR(160),latency_ms INTEGER,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(id,tenant_id),UNIQUE(tenant_id,student_id,request_id,role),FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(session_id,tenant_id) REFERENCES zhiban.course_peer_sessions(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE)`,
    `CREATE TABLE zhiban.course_peer_feedback (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,message_id UUID NOT NULL,student_id UUID NOT NULL,
      rating SMALLINT NOT NULL CHECK(rating IN(-1,1)),comment TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,message_id,student_id),UNIQUE(id,tenant_id),FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(message_id,tenant_id) REFERENCES zhiban.course_peer_messages(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(student_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE)`,
    `CREATE INDEX course_peer_sessions_student_idx ON zhiban.course_peer_sessions(tenant_id,student_id,course_id,last_message_at DESC)`,
    `CREATE INDEX course_peer_messages_session_idx ON zhiban.course_peer_messages(tenant_id,session_id,created_at)`,
    ...tables.flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING(tenant_id=${tenant}) WITH CHECK(tenant_id=${tenant})`,
    ]),
  ],
  down: tables.slice().reverse().map((table) => `DROP TABLE IF EXISTS zhiban.${table}`),
};
