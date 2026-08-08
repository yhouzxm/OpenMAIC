import type { ZhibanMigration } from './001-initial-identity';
const tenant = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;
const tables = ['risk_course_controls', 'risk_notifications', 'risk_learner_requests'];
export const riskGovernanceMigration: ZhibanMigration = {
  version: '024',
  description:
    'risk governance controls, notifications, learner requests and intervention outcomes',
  checksum: 'zhiban-024-risk-governance-v1',
  up: [
    `ALTER TABLE zhiban.risk_cases ADD COLUMN intervention_brief_id UUID,ADD COLUMN outcome VARCHAR(40),ADD COLUMN outcome_score NUMERIC(6,3),ADD CONSTRAINT risk_cases_intervention_fk FOREIGN KEY(intervention_brief_id) REFERENCES zhiban.intervention_briefs(id) ON DELETE SET NULL`,
    `CREATE TABLE zhiban.risk_course_controls(tenant_id UUID NOT NULL,course_id UUID NOT NULL,mode VARCHAR(24) NOT NULL DEFAULT 'shadow' CHECK(mode IN('off','shadow','active')),automatic_intervention_enabled BOOLEAN NOT NULL DEFAULT false,emergency_stop BOOLEAN NOT NULL DEFAULT false,sla_scan_enabled BOOLEAN NOT NULL DEFAULT true,updated_by UUID,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,course_id),FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(updated_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id))`,
    `CREATE TABLE zhiban.risk_notifications(id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,case_id UUID NOT NULL,recipient_id UUID,notification_type VARCHAR(32) NOT NULL CHECK(notification_type IN('level3','sla_overdue','assignment','learner_request')),title VARCHAR(200) NOT NULL,message TEXT NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'unread' CHECK(status IN('unread','read','dismissed')),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),read_at TIMESTAMPTZ,FOREIGN KEY(case_id,tenant_id) REFERENCES zhiban.risk_cases(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(recipient_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE)`,
    `CREATE TABLE zhiban.risk_learner_requests(id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,learner_id UUID NOT NULL,case_id UUID,request_type VARCHAR(32) NOT NULL CHECK(request_type IN('help','explanation','correction')),content TEXT NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','handled','rejected','cancelled')),response TEXT NOT NULL DEFAULT '',handled_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),handled_at TIMESTAMPTZ,FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(case_id,tenant_id) REFERENCES zhiban.risk_cases(id,tenant_id) ON DELETE SET NULL,FOREIGN KEY(handled_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id))`,
    ...tables.flatMap((t) => [
      `ALTER TABLE zhiban.${t} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${t} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${t} USING(tenant_id=${tenant}) WITH CHECK(tenant_id=${tenant})`,
    ]),
    `CREATE INDEX risk_notifications_recipient_idx ON zhiban.risk_notifications(tenant_id,recipient_id,status,created_at DESC)`,
    `CREATE INDEX risk_requests_course_idx ON zhiban.risk_learner_requests(tenant_id,course_id,status,created_at)`,
  ],
  down: [
    ...tables
      .slice()
      .reverse()
      .map((t) => `DROP TABLE IF EXISTS zhiban.${t}`),
    `ALTER TABLE zhiban.risk_cases DROP CONSTRAINT risk_cases_intervention_fk,DROP COLUMN intervention_brief_id,DROP COLUMN outcome,DROP COLUMN outcome_score`,
  ],
};
