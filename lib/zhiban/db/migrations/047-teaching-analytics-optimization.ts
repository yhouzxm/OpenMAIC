import type { ZhibanMigration } from './001-initial-identity';

const tenant = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;
export const teachingAnalyticsOptimizationMigration: ZhibanMigration = {
  version: '047',
  description: 'course teaching analytics snapshots and continuous improvement actions',
  checksum: 'zhiban-047-teaching-analytics-optimization-v1',
  up: [
    `CREATE TABLE zhiban.teaching_analysis_snapshots(id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,analysis_version VARCHAR(40) NOT NULL DEFAULT 'teaching-v1',metrics JSONB NOT NULL,generated_by UUID NOT NULL,generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(generated_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id),CHECK(jsonb_typeof(metrics)='object'))`,
    `CREATE TABLE zhiban.teaching_improvement_actions(id UUID PRIMARY KEY,tenant_id UUID NOT NULL,course_id UUID NOT NULL,title VARCHAR(240) NOT NULL,evidence TEXT NOT NULL DEFAULT '',hypothesis TEXT NOT NULL DEFAULT '',action_type VARCHAR(32) NOT NULL CHECK(action_type IN('content','activity','assessment','agent','intervention','other')),priority VARCHAR(16) NOT NULL DEFAULT 'medium' CHECK(priority IN('low','medium','high')),status VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK(status IN('planned','in_progress','completed','cancelled')),target_metric VARCHAR(80) NOT NULL DEFAULT '',target_value NUMERIC(10,3),baseline_value NUMERIC(10,3),result_value NUMERIC(10,3),due_at TIMESTAMPTZ,owner_id UUID,created_by UUID NOT NULL,completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(course_id,tenant_id) REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(owner_id,tenant_id) REFERENCES zhiban.accounts(id,tenant_id) ON DELETE SET NULL,FOREIGN KEY(created_by,tenant_id) REFERENCES zhiban.accounts(id,tenant_id))`,
    ...['teaching_analysis_snapshots','teaching_improvement_actions'].flatMap((table)=>[`ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,`ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,`CREATE POLICY tenant_isolation ON zhiban.${table} USING(tenant_id=${tenant}) WITH CHECK(tenant_id=${tenant})`]),
    `CREATE INDEX teaching_snapshots_course_idx ON zhiban.teaching_analysis_snapshots(tenant_id,course_id,generated_at DESC)`,
    `CREATE INDEX teaching_actions_course_idx ON zhiban.teaching_improvement_actions(tenant_id,course_id,status,created_at DESC)`,
  ],
  down: [`DROP TABLE IF EXISTS zhiban.teaching_improvement_actions`,`DROP TABLE IF EXISTS zhiban.teaching_analysis_snapshots`],
};
