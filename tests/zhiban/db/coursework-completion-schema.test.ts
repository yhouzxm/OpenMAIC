import { describe, expect, it } from 'vitest';
import { courseworkCompletionMigration } from '@/lib/zhiban/db/migrations/037-coursework-completion';

describe('coursework completion schema', () => {
  it('adds resource history, file assignments, grading and rollback DDL', () => {
    const up = courseworkCompletionMigration.up.join('\n');
    const down = courseworkCompletionMigration.down.join('\n');
    expect(up).toContain('course_resource_versions');
    expect(up).toContain('activity_assignments');
    expect(up).toContain('activity_assignment_submissions');
    expect(up).toContain('activity_assignment_files');
    expect(up).toContain('discussion_scores');
    expect(up).toContain('grade_item_id');
    expect(up).toContain('ENABLE ROW LEVEL SECURITY');
    expect(down).toContain('DROP TABLE IF EXISTS zhiban.activity_assignments');
  });
});
