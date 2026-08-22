import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('student course catalog query', () => {
  it('starts from active enrollments and keeps courses without an open classroom', () => {
    const source = readFileSync(
      new URL('../../../lib/zhiban/classroom/service.ts', import.meta.url),
      'utf8',
    );
    const queryStart = source.indexOf("COALESCE(cc.id::text,'course:'||c.id::text)");
    const queryEnd = source.indexOf('GROUP BY cc.id,c.id,s.id', queryStart);
    const query = source.slice(queryStart, queryEnd);

    expect(query).toContain('FROM zhiban.enrollments e');
    expect(query).toContain('LEFT JOIN zhiban.course_classrooms cc');
    expect(query).toContain("e.student_id=$2 AND e.status='enrolled'");
    expect(query).not.toContain('WHERE cc.tenant_id=$1');
    expect(query).toContain('BOOL_OR(settings.pbl_enabled) AS pbl_enabled');
    expect(query).not.toContain('COALESCE(BOOL_OR(settings.pbl_enabled),true)');
    expect(query).toContain("count(*) FILTER(WHERE progress.status='completed')");
    expect(query).toContain("jsonb_array_elements(chapter_item->'activities')");
  });
});
