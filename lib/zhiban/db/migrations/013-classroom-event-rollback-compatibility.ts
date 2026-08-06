import type { ZhibanMigration } from './001-initial-identity';

const compatibleConstraint = `ALTER TABLE zhiban.classroom_learning_events ADD CONSTRAINT classroom_learning_events_event_type_check CHECK (event_type IN ('classroom_opened','scene_viewed','interaction','slide_action','quiz_answered','quiz_completed','simulation_interacted','pbl_activity','chat_message','resource_opened','classroom_completed'))`;
export const classroomEventRollbackCompatibilityMigration: ZhibanMigration = {
  version: '013',
  description: 'Keep legacy classroom interaction value valid across detailed-event rollback',
  checksum: 'zhiban-013-classroom-event-rollback-compatibility-v1',
  up: [`ALTER TABLE zhiban.classroom_learning_events DROP CONSTRAINT classroom_learning_events_event_type_check`, compatibleConstraint],
  // Deliberately retain the compatibility constraint: migration 012 down converts
  // detailed values to `interaction` before replacing this constraint.
  down: [],
};
