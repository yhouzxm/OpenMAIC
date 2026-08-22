import type { ZhibanMigration } from './001-initial-identity';

export const openMaicActivityTypesMigration: ZhibanMigration = {
  version: '043',
  description: 'split OpenMAIC single activities into five first-class course activity types',
  checksum: 'zhiban-043-openmaic-activity-types-v1',
  up: [
    `ALTER TABLE zhiban.course_activities DROP CONSTRAINT course_activities_activity_type_check`,
    `ALTER TABLE zhiban.course_activities ADD CONSTRAINT course_activities_activity_type_check CHECK(activity_type IN
      ('content','resource','classroom','pbl','assignment','quiz','discussion','ema','practice','summary','ai_support','openmaic_interaction','openmaic_slide','openmaic_quiz','openmaic_interactive','openmaic_pbl','openmaic_3d'))`,
    `UPDATE zhiban.course_activities a SET activity_type=CASE COALESCE(d.document_state->>'activityKind','slide')
       WHEN 'quiz' THEN 'openmaic_quiz' WHEN 'interactive' THEN 'openmaic_interactive'
       WHEN 'pbl' THEN 'openmaic_pbl' WHEN 'visualization3d' THEN 'openmaic_3d' ELSE 'openmaic_slide' END
       FROM zhiban.openmaic_activity_documents d WHERE d.activity_id=a.id AND a.activity_type='openmaic_interaction'`,
    `UPDATE zhiban.course_activities SET activity_type='openmaic_slide' WHERE activity_type='openmaic_interaction'`,
    `ALTER TABLE zhiban.course_activities DROP CONSTRAINT course_activities_activity_type_check`,
    `ALTER TABLE zhiban.course_activities ADD CONSTRAINT course_activities_activity_type_check CHECK(activity_type IN
      ('content','resource','classroom','pbl','assignment','quiz','discussion','ema','practice','summary','ai_support','openmaic_slide','openmaic_quiz','openmaic_interactive','openmaic_pbl','openmaic_3d'))`,
  ],
  down: [
    `ALTER TABLE zhiban.course_activities DROP CONSTRAINT course_activities_activity_type_check`,
    `ALTER TABLE zhiban.course_activities ADD CONSTRAINT course_activities_activity_type_check CHECK(activity_type IN
      ('content','resource','classroom','pbl','assignment','quiz','discussion','ema','practice','summary','ai_support','openmaic_interaction','openmaic_slide','openmaic_quiz','openmaic_interactive','openmaic_pbl','openmaic_3d'))`,
    `UPDATE zhiban.course_activities SET activity_type='openmaic_interaction' WHERE activity_type IN('openmaic_slide','openmaic_quiz','openmaic_interactive','openmaic_pbl','openmaic_3d')`,
    `ALTER TABLE zhiban.course_activities DROP CONSTRAINT course_activities_activity_type_check`,
    `ALTER TABLE zhiban.course_activities ADD CONSTRAINT course_activities_activity_type_check CHECK(activity_type IN
      ('content','resource','classroom','pbl','assignment','quiz','discussion','ema','practice','summary','ai_support','openmaic_interaction'))`,
  ],
};
