import { describe, expect, it } from 'vitest';

import { courseTutorGovernanceMigration } from '@/lib/zhiban/db/migrations/039-course-tutor-governance';

describe('course Tutor governance migration', () => {
  const sql = courseTutorGovernanceMigration.up.join('\n');

  it('adds synchronization audit, idempotency, safety context, and tenant isolation', () => {
    expect(sql).toContain('last_sync_status');
    expect(sql).toContain('CREATE TABLE zhiban.course_tutor_sync_runs');
    expect(sql).toContain('request_id UUID');
    expect(sql).toContain("role='assistant'");
    expect(sql).toContain('safety_category');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });
});
