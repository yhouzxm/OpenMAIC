import { describe, expect, it } from 'vitest';
import { teachingAnalyticsOptimizationMigration } from '@/lib/zhiban/db/migrations/047-teaching-analytics-optimization';

describe('teaching analytics optimization schema', () => {
  const sql = teachingAnalyticsOptimizationMigration.up.join('\n');
  it('stores immutable analysis snapshots', () => {
    expect(sql).toContain('teaching_analysis_snapshots');
    expect(sql).toContain("jsonb_typeof(metrics)='object'");
    expect(sql).toContain('generated_at TIMESTAMPTZ');
  });
  it('tracks improvement actions through a reviewable lifecycle', () => {
    expect(sql).toContain('teaching_improvement_actions');
    expect(sql).toContain("'planned','in_progress','completed','cancelled'");
    expect(sql).toContain('baseline_value');
    expect(sql).toContain('result_value');
  });
  it('enforces tenant isolation and course cascade cleanup', () => {
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2);
    expect(sql).toContain('ON DELETE CASCADE');
  });
});
