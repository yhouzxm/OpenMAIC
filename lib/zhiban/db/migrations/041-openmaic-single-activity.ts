import type { ZhibanMigration } from './001-initial-identity';

export const openMaicSingleActivityMigration: ZhibanMigration = {
  version: '041',
  description: 'OpenMAIC single-scene course activity type',
  checksum: 'zhiban-041-openmaic-single-activity-v1',
  up: [
    `ALTER TABLE zhiban.course_activities DROP CONSTRAINT course_activities_activity_type_check`,
    `ALTER TABLE zhiban.course_activities ADD CONSTRAINT course_activities_activity_type_check CHECK(activity_type IN
      ('content','resource','classroom','pbl','assignment','quiz','discussion','ema','practice','summary','ai_support','openmaic_interaction'))`,
  ],
  down: [
    `UPDATE zhiban.course_activities SET activity_type='classroom' WHERE activity_type='openmaic_interaction'`,
    `ALTER TABLE zhiban.course_activities DROP CONSTRAINT course_activities_activity_type_check`,
    `ALTER TABLE zhiban.course_activities ADD CONSTRAINT course_activities_activity_type_check CHECK(activity_type IN
      ('content','resource','classroom','pbl','assignment','quiz','discussion','ema','practice','summary','ai_support'))`,
  ],
};
