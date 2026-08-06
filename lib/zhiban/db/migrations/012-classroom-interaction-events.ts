import type { ZhibanMigration } from './001-initial-identity';

export const classroomInteractionEventsMigration: ZhibanMigration = {
  version: '012',
  description: 'Detailed OpenMAIC classroom interaction event taxonomy',
  checksum: 'zhiban-012-classroom-interaction-events-v1',
  up: [
    `ALTER TABLE zhiban.classroom_learning_events DROP CONSTRAINT classroom_learning_events_event_type_check`,
    `UPDATE zhiban.classroom_learning_events SET event_type='simulation_interacted' WHERE event_type='interaction'`,
    `ALTER TABLE zhiban.classroom_learning_events ADD CONSTRAINT classroom_learning_events_event_type_check CHECK (event_type IN ('classroom_opened','scene_viewed','slide_action','quiz_answered','quiz_completed','simulation_interacted','pbl_activity','chat_message','resource_opened','classroom_completed'))`,
    `CREATE INDEX classroom_events_type_idx ON zhiban.classroom_learning_events(tenant_id,event_type,occurred_at DESC)`,
  ],
  down: [
    `UPDATE zhiban.classroom_learning_events SET event_type='interaction' WHERE event_type NOT IN ('classroom_opened','scene_viewed','classroom_completed')`,
    `ALTER TABLE zhiban.classroom_learning_events DROP CONSTRAINT classroom_learning_events_event_type_check`,
    `ALTER TABLE zhiban.classroom_learning_events ADD CONSTRAINT classroom_learning_events_event_type_check CHECK (event_type IN ('classroom_opened','scene_viewed','interaction','classroom_completed'))`,
    `DROP INDEX IF EXISTS zhiban.classroom_events_type_idx`,
  ],
};
