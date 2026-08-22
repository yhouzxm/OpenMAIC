import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;

export const unifiedCourseStructureMigration: ZhibanMigration = {
  version: '034',
  description: 'versioned course modules, chapters, and unified learning activities',
  checksum: 'zhiban-034-unified-course-structure-v1',
  up: [
    `CREATE TABLE zhiban.course_modules (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL DEFAULT '',position INTEGER NOT NULL DEFAULT 0,status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK(status IN('draft','published')),created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE zhiban.course_chapters (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,module_id UUID NOT NULL,title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL DEFAULT '',position INTEGER NOT NULL DEFAULT 0,estimated_minutes INTEGER NOT NULL DEFAULT 0
        CHECK(estimated_minutes BETWEEN 0 AND 100000),status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK(status IN('draft','published')),created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(module_id,tenant_id) REFERENCES zhiban.course_modules(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE zhiban.course_activities (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,chapter_id UUID NOT NULL,title VARCHAR(240) NOT NULL,
      description TEXT NOT NULL DEFAULT '',activity_type VARCHAR(32) NOT NULL CHECK(activity_type IN
        ('content','resource','classroom','pbl','assignment','quiz','discussion','ema','practice','summary','ai_support')),
      reference_id VARCHAR(200),position INTEGER NOT NULL DEFAULT 0,estimated_minutes INTEGER NOT NULL DEFAULT 0
        CHECK(estimated_minutes BETWEEN 0 AND 100000),required BOOLEAN NOT NULL DEFAULT true,
      opens_at TIMESTAMPTZ,closes_at TIMESTAMPTZ,opening_rule JSONB NOT NULL DEFAULT '{"type":"always"}'::jsonb,
      completion_rule JSONB NOT NULL DEFAULT '{"type":"manual"}'::jsonb,status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK(status IN('draft','published')),created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(chapter_id,tenant_id) REFERENCES zhiban.course_chapters(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT,
      CHECK(closes_at IS NULL OR opens_at IS NULL OR closes_at>=opens_at),
      CHECK(jsonb_typeof(opening_rule)='object' AND jsonb_typeof(completion_rule)='object')
    )`,
    `CREATE TABLE zhiban.course_design_versions (
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,version INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK(status IN('published','superseded')),
      change_note VARCHAR(1000) NOT NULL DEFAULT '',snapshot JSONB NOT NULL,published_by UUID NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,course_id,version),UNIQUE(id,tenant_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(published_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE RESTRICT,
      CHECK(jsonb_typeof(snapshot)='object')
    )`,
    `CREATE INDEX course_modules_order_idx ON zhiban.course_modules(tenant_id,course_id,position)`,
    `CREATE INDEX course_chapters_order_idx ON zhiban.course_chapters(tenant_id,module_id,position)`,
    `CREATE INDEX course_activities_order_idx ON zhiban.course_activities(tenant_id,chapter_id,position)`,
    `CREATE UNIQUE INDEX course_design_one_published_idx ON zhiban.course_design_versions(tenant_id,course_id)
      WHERE status='published'`,
    ...['course_modules', 'course_chapters', 'course_activities', 'course_design_versions'].flatMap(
      (table) => [
        `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
        `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
        `CREATE POLICY tenant_isolation ON zhiban.${table} USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
      ],
    ),
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.course_design_versions`,
    `DROP TABLE IF EXISTS zhiban.course_activities`,
    `DROP TABLE IF EXISTS zhiban.course_chapters`,
    `DROP TABLE IF EXISTS zhiban.course_modules`,
  ],
};
