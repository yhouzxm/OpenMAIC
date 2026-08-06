import { describe, expect, it } from 'vitest';
import { pblCollaborationAssessmentMigration } from '@/lib/zhiban/db/migrations/010-pbl-collaboration-assessment';
describe('PBL collaboration and assessment schema', () => {
  const sql = pblCollaborationAssessmentMigration.up.join('\n');
  it('adds templates, dependency tasks, groups and four group roles', () => {
    expect(sql).toContain('pbl_project_templates');
    expect(sql).toContain('pbl_tasks');
    expect(sql).toContain('dependencies JSONB');
    expect(sql).toContain("'leader','member','recorder','presenter'");
  });
  it('adds version review, hashes, rubrics and grade items', () => {
    expect(sql).toContain('content_hash');
    expect(sql).toContain('changes_requested');
    expect(sql).toContain('pbl_rubrics');
    expect(sql).toContain('pbl_grade_items');
    expect(sql).toContain('pbl_rubric_scores');
  });
  it('isolates all new tables by tenant', () =>
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(9));
});
