import type { ZhibanMigration } from './001-initial-identity';

const tenant = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;
export const monitorClosedLoopMigration: ZhibanMigration = {
  version: '045',
  description: 'Monitor policy, explainable decisions and intervention effectiveness loop',
  checksum: 'zhiban-045-monitor-closed-loop-v1',
  up: [
    `CREATE TABLE zhiban.course_monitor_configs(
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,enabled BOOLEAN NOT NULL DEFAULT false,
      mode VARCHAR(16) NOT NULL DEFAULT 'shadow' CHECK(mode IN('shadow','active','paused')),
      tutor_threshold NUMERIC(5,2) NOT NULL DEFAULT 60,peer_threshold NUMERIC(5,2) NOT NULL DEFAULT 35,
      teacher_threshold NUMERIC(5,2) NOT NULL DEFAULT 75,cooldown_minutes INTEGER NOT NULL DEFAULT 30 CHECK(cooldown_minutes BETWEEN 1 AND 10080),
      daily_limit INTEGER NOT NULL DEFAULT 3 CHECK(daily_limit BETWEEN 1 AND 20),followup_hours INTEGER NOT NULL DEFAULT 24 CHECK(followup_hours BETWEEN 1 AND 720),
      policy_version VARCHAR(80) NOT NULL DEFAULT 'monitor-v2',updated_by UUID,version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,course_id),FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(updated_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE SET NULL)`,
    `CREATE TABLE zhiban.monitor_decisions(
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,learner_id UUID NOT NULL,source_event_id VARCHAR(160) NOT NULL,
      risk_score NUMERIC(6,2) NOT NULL,risk_level VARCHAR(16) NOT NULL CHECK(risk_level IN('none','low','medium','high')),
      signal_type VARCHAR(32) NOT NULL,target_role VARCHAR(24) CHECK(target_role IN('peer','tutor','teacher')),
      disposition VARCHAR(24) NOT NULL CHECK(disposition IN('no_action','shadow','suppressed','dispatched','escalated')),
      reason TEXT NOT NULL,evidence JSONB NOT NULL DEFAULT '{}'::jsonb,policy_version VARCHAR(80) NOT NULL,brief_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,course_id,learner_id,source_event_id),
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(brief_id) REFERENCES zhiban.intervention_briefs(id) ON DELETE SET NULL,CHECK(jsonb_typeof(evidence)='object'))`,
    `CREATE TABLE zhiban.intervention_effectiveness(
      id UUID PRIMARY KEY,tenant_id UUID NOT NULL,brief_id UUID NOT NULL,course_id UUID NOT NULL,learner_id UUID NOT NULL,
      before_score NUMERIC(6,2),after_score NUMERIC(6,2),effective BOOLEAN,teacher_note TEXT,
      measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),measured_by VARCHAR(24) NOT NULL DEFAULT 'monitor' CHECK(measured_by IN('monitor','teacher')),
      UNIQUE(tenant_id,brief_id,measured_by),FOREIGN KEY(brief_id) REFERENCES zhiban.intervention_briefs(id) ON DELETE CASCADE,
      FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(learner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE CASCADE)`,
    ...['course_monitor_configs','monitor_decisions','intervention_effectiveness'].flatMap((table)=>[
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,`ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table} USING(tenant_id=${tenant}) WITH CHECK(tenant_id=${tenant})`,
    ]),
    `CREATE INDEX monitor_decisions_course_idx ON zhiban.monitor_decisions(tenant_id,course_id,created_at DESC)`,
    `CREATE INDEX monitor_decisions_learner_idx ON zhiban.monitor_decisions(tenant_id,learner_id,course_id,created_at DESC)`,
  ],
  down: [`DROP TABLE IF EXISTS zhiban.intervention_effectiveness`,`DROP TABLE IF EXISTS zhiban.monitor_decisions`,`DROP TABLE IF EXISTS zhiban.course_monitor_configs`],
};
