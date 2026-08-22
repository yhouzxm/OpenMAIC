import type { ZhibanMigration } from './001-initial-identity';
export const monitorTeacherNotificationsMigration:ZhibanMigration={version:'046',description:'allow Monitor teacher escalation notifications without a risk case',checksum:'zhiban-046-monitor-teacher-notifications-v1',up:[
  `ALTER TABLE zhiban.risk_notifications ALTER COLUMN case_id DROP NOT NULL`,
  `ALTER TABLE zhiban.risk_notifications DROP CONSTRAINT risk_notifications_notification_type_check`,
  `ALTER TABLE zhiban.risk_notifications ADD CONSTRAINT risk_notifications_notification_type_check CHECK(notification_type IN('level3','sla_overdue','assignment','learner_request','monitor_escalation'))`,
],down:[
  `DELETE FROM zhiban.risk_notifications WHERE notification_type='monitor_escalation'`,
  `ALTER TABLE zhiban.risk_notifications DROP CONSTRAINT risk_notifications_notification_type_check`,
  `ALTER TABLE zhiban.risk_notifications ADD CONSTRAINT risk_notifications_notification_type_check CHECK(notification_type IN('level3','sla_overdue','assignment','learner_request'))`,
  `ALTER TABLE zhiban.risk_notifications ALTER COLUMN case_id SET NOT NULL`,
]};
