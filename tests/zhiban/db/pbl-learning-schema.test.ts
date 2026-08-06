import { describe, expect, it } from 'vitest';
import { pblLearningMigration } from '@/lib/zhiban/db/migrations/009-pbl-learning';

describe('Zhiban PBL learning schema', () => {
  const sql = pblLearningMigration.up.join('\n');

  it('stores definitions, learner state, events, submissions, and evaluations', () => {
    for (const table of ['pbl_projects', 'pbl_project_instances', 'pbl_learning_events', 'pbl_submissions', 'pbl_evaluations']) {
      expect(sql).toContain(`CREATE TABLE zhiban.${table}`);
    }
  });

  it('keeps OpenMAIC packages and learner state as versioned JSON documents', () => {
    expect(sql).toContain('openmaic_package JSONB');
    expect(sql).toContain('package_version INTEGER');
    expect(sql).toContain('project_state JSONB NOT NULL');
    expect(sql).toContain('UNIQUE (project_id, student_id)');
  });

  it('enforces tenant isolation on all PBL tables', () => {
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(5);
  });
});
