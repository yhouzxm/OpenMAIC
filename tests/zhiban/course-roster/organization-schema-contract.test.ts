import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync('lib/zhiban/course-roster/service.ts', 'utf8');

describe('course roster organization schema contract', () => {
  it('uses the canonical primary organization relation', () => {
    expect(service).toContain('org.id=a.primary_organization_id');
    expect(service).toContain('zhiban.organization_units org');
    expect(service).not.toContain('aom.is_primary');
    expect(service).not.toContain('zhiban.organizations org');
  });

  it('resolves the administrative class from membership with a student-profile fallback', () => {
    expect(service).toContain("cm.student_id=a.id AND cm.status='active'");
    expect(service).toContain('oc.offering_id=o.id AND oc.class_id=cm.class_id');
    expect(service).toContain("COALESCE(cl.name,sp.class_name,'未分班')");
    expect(service).not.toContain('cl.id=o.class_id');
  });
});
