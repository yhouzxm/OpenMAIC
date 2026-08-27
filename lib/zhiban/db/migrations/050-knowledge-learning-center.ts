import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;

/** Knowledge-station events use VARCHAR course ids so the code-registered competition course is supported. */
export const knowledgeLearningCenterMigration: ZhibanMigration = {
  version: '050',
  description:
    'Knowledge station learning events for the automatic production line learning center',
  checksum: 'zhiban-050-knowledge-learning-center-v2',
  up: [
    `CREATE TABLE zhiban.knowledge_learning_events (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      learner_id UUID NOT NULL,
      course_id VARCHAR(128) NOT NULL,
      station_id VARCHAR(64) NOT NULL,
      knowledge_point_id VARCHAR(64),
      event_type VARCHAR(64) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_correct BOOLEAN,
      attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt > 0),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY(learner_id) REFERENCES zhiban.accounts(id) ON DELETE CASCADE,
      CHECK(jsonb_typeof(payload) = 'object')
    )`,
    `CREATE INDEX knowledge_learning_events_learner_course_idx ON zhiban.knowledge_learning_events(tenant_id,learner_id,course_id,occurred_at DESC)`,
    `CREATE INDEX knowledge_learning_events_station_idx ON zhiban.knowledge_learning_events(tenant_id,course_id,station_id,knowledge_point_id,occurred_at DESC)`,
    `ALTER TABLE zhiban.knowledge_learning_events ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.knowledge_learning_events FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.knowledge_learning_events USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
  ],
  down: ['DROP TABLE IF EXISTS zhiban.knowledge_learning_events'],
};
