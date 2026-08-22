import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;

export const courseContentDiscussionsMigration: ZhibanMigration = {
  version: '036',
  description: 'chapter content, versioned course resources, and moderated discussions',
  checksum: 'zhiban-036-course-content-discussions-v1',
  up: [
    `CREATE TABLE zhiban.course_activity_contents (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,activity_id UUID NOT NULL,
      content_format VARCHAR(24) NOT NULL DEFAULT 'markdown' CHECK(content_format IN('plain_text','markdown','html')),
      body TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK(status IN('draft','published')),updated_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,activity_id),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id,tenant_id) REFERENCES zhiban.course_activities(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(updated_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE zhiban.course_resources_v2 (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,title VARCHAR(240) NOT NULL,
      resource_type VARCHAR(24) NOT NULL CHECK(resource_type IN('document','video','audio','image','link','dataset','other')),
      url TEXT,file_name VARCHAR(500),mime_type VARCHAR(200),file_size BIGINT,content BYTEA,description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),download_allowed BOOLEAN NOT NULL DEFAULT true,
      ai_index_enabled BOOLEAN NOT NULL DEFAULT false,status VARCHAR(20) NOT NULL DEFAULT 'published'
        CHECK(status IN('draft','published','archived')),created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT,
      CHECK((resource_type='link' AND url IS NOT NULL) OR (resource_type<>'link')),
      CHECK(file_size IS NULL OR file_size BETWEEN 0 AND 15728640)
    )`,
    `CREATE TABLE zhiban.course_activity_resources (
      tenant_id UUID NOT NULL,course_id UUID NOT NULL,activity_id UUID NOT NULL,resource_id UUID NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(activity_id,resource_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id,tenant_id) REFERENCES zhiban.course_activities(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(resource_id,tenant_id) REFERENCES zhiban.course_resources_v2(id,tenant_id) ON DELETE CASCADE
    )`,
    `CREATE TABLE zhiban.discussion_topics (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,activity_id UUID,title VARCHAR(240) NOT NULL,
      description TEXT NOT NULL DEFAULT '',status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK(status IN('draft','open','closed','archived')),
      pinned BOOLEAN NOT NULL DEFAULT false,graded BOOLEAN NOT NULL DEFAULT false,created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id) REFERENCES zhiban.course_activities(id) ON DELETE SET NULL,
      FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE zhiban.discussion_posts (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,topic_id UUID NOT NULL,parent_post_id UUID,
      author_id UUID NOT NULL,content TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'published'
        CHECK(status IN('published','hidden','deleted')),ai_generated BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(topic_id,tenant_id) REFERENCES zhiban.discussion_topics(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(parent_post_id,tenant_id) REFERENCES zhiban.discussion_posts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(author_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE zhiban.discussion_moderation (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,post_id UUID NOT NULL,actor_id UUID NOT NULL,
      action VARCHAR(24) NOT NULL CHECK(action IN('hide','restore','delete','report')),reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(post_id,tenant_id) REFERENCES zhiban.discussion_posts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(actor_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT
    )`,
    `CREATE INDEX course_activity_contents_course_idx ON zhiban.course_activity_contents(tenant_id,course_id,status)`,
    `CREATE INDEX course_resources_v2_course_idx ON zhiban.course_resources_v2(tenant_id,course_id,status)`,
    `CREATE INDEX discussion_topics_course_idx ON zhiban.discussion_topics(tenant_id,course_id,status,pinned)`,
    `CREATE INDEX discussion_posts_topic_idx ON zhiban.discussion_posts(tenant_id,topic_id,created_at)`,
    ...[
      'course_activity_contents',
      'course_resources_v2',
      'course_activity_resources',
      'discussion_topics',
      'discussion_posts',
      'discussion_moderation',
    ].flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
    ]),
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.discussion_moderation`,
    `DROP TABLE IF EXISTS zhiban.discussion_posts`,
    `DROP TABLE IF EXISTS zhiban.discussion_topics`,
    `DROP TABLE IF EXISTS zhiban.course_activity_resources`,
    `DROP TABLE IF EXISTS zhiban.course_resources_v2`,
    `DROP TABLE IF EXISTS zhiban.course_activity_contents`,
  ],
};
