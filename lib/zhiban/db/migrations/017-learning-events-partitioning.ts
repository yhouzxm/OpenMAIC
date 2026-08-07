import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;
const tableDefinition = `(id UUID NOT NULL,tenant_id UUID NOT NULL,learner_id UUID NOT NULL,course_id UUID NOT NULL,
  source_kind VARCHAR(24) NOT NULL CHECK(source_kind IN('classroom','pbl','quiz','submission','evaluation','system')),
  source_id VARCHAR(200) NOT NULL,event_type VARCHAR(100) NOT NULL,project_id UUID,classroom_binding_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,occurred_at TIMESTAMPTZ NOT NULL,received_at TIMESTAMPTZ NOT NULL DEFAULT now(),expires_at TIMESTAMPTZ,
  FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
  CHECK(jsonb_typeof(payload)='object'))`;

export const learningEventsPartitioningMigration: ZhibanMigration = {
  version: '017',
  description:
    'Monthly time partitioning and cross-partition idempotency for high-volume learning events',
  checksum: 'zhiban-017-learning-events-partitioning-v1',
  up: [
    `DROP INDEX IF EXISTS zhiban.learning_events_learner_course_time_idx`,
    `DROP INDEX IF EXISTS zhiban.learning_events_expiry_idx`,
    `ALTER TABLE zhiban.learning_events RENAME TO learning_events_unpartitioned`,
    `CREATE TABLE zhiban.learning_event_idempotency_keys(tenant_id UUID NOT NULL,source_kind VARCHAR(24) NOT NULL,source_id VARCHAR(200) NOT NULL,occurred_at TIMESTAMPTZ NOT NULL,PRIMARY KEY(tenant_id,source_kind,source_id))`,
    `CREATE TABLE zhiban.learning_events ${tableDefinition} PARTITION BY RANGE(occurred_at)`,
    `ALTER TABLE zhiban.learning_events ADD PRIMARY KEY(id,occurred_at)`,
    `DO $$ DECLARE start_month date; part_start date; part_end date; part_name text; offset_month int; BEGIN
       start_month=date_trunc('month',now())::date;
       FOR offset_month IN -2..12 LOOP part_start=(start_month+(offset_month||' months')::interval)::date;part_end=(part_start+interval '1 month')::date;part_name='learning_events_'||to_char(part_start,'YYYY_MM');
       EXECUTE format('CREATE TABLE zhiban.%I PARTITION OF zhiban.learning_events FOR VALUES FROM (%L) TO (%L)',part_name,part_start,part_end);END LOOP;
     END $$`,
    `CREATE TABLE zhiban.learning_events_default PARTITION OF zhiban.learning_events DEFAULT`,
    `INSERT INTO zhiban.learning_events SELECT * FROM zhiban.learning_events_unpartitioned`,
    `INSERT INTO zhiban.learning_event_idempotency_keys SELECT tenant_id,source_kind,source_id,occurred_at FROM zhiban.learning_events_unpartitioned ON CONFLICT DO NOTHING`,
    `CREATE FUNCTION zhiban.guard_learning_event_idempotency() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
       INSERT INTO zhiban.learning_event_idempotency_keys(tenant_id,source_kind,source_id,occurred_at) VALUES(NEW.tenant_id,NEW.source_kind,NEW.source_id,NEW.occurred_at) ON CONFLICT DO NOTHING;
       IF NOT FOUND THEN RETURN NULL; END IF; RETURN NEW; END $$`,
    `CREATE TRIGGER learning_events_idempotency BEFORE INSERT ON zhiban.learning_events FOR EACH ROW EXECUTE FUNCTION zhiban.guard_learning_event_idempotency()`,
    `ALTER TABLE zhiban.learning_events ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.learning_events FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.learning_events USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
    `ALTER TABLE zhiban.learning_event_idempotency_keys ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.learning_event_idempotency_keys FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.learning_event_idempotency_keys USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
    `CREATE INDEX learning_events_learner_course_time_idx ON zhiban.learning_events(tenant_id,learner_id,course_id,occurred_at DESC)`,
    `CREATE INDEX learning_events_expiry_idx ON zhiban.learning_events(tenant_id,expires_at) WHERE expires_at IS NOT NULL`,
    `DROP TABLE zhiban.learning_events_unpartitioned`,
  ],
  down: [
    `ALTER TABLE zhiban.learning_events DISABLE TRIGGER learning_events_idempotency`,
    `ALTER TABLE zhiban.learning_events RENAME TO learning_events_partitioned`,
    `CREATE TABLE zhiban.learning_events ${tableDefinition}`,
    `ALTER TABLE zhiban.learning_events ADD PRIMARY KEY(id),ADD UNIQUE(tenant_id,source_kind,source_id)`,
    `INSERT INTO zhiban.learning_events SELECT id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,project_id,classroom_binding_id,payload,occurred_at,received_at,expires_at FROM zhiban.learning_events_partitioned`,
    `ALTER TABLE zhiban.learning_events ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.learning_events FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.learning_events USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
    `CREATE INDEX learning_events_learner_course_time_idx ON zhiban.learning_events(tenant_id,learner_id,course_id,occurred_at DESC)`,
    `CREATE INDEX learning_events_expiry_idx ON zhiban.learning_events(tenant_id,expires_at) WHERE expires_at IS NOT NULL`,
    `DROP TABLE zhiban.learning_events_partitioned CASCADE`,
    `DROP TABLE zhiban.learning_event_idempotency_keys`,
    `DROP FUNCTION zhiban.guard_learning_event_idempotency()`,
  ],
};
