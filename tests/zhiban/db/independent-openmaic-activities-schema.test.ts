import { describe, expect, it } from 'vitest';
import { independentOpenMaicActivitiesMigration } from '@/lib/zhiban/db/migrations/042-independent-openmaic-activities';
describe('independent OpenMAIC activities migration',()=>{
  const sql=independentOpenMaicActivitiesMigration.up.join('\n');
  it('owns documents, student sessions and events without classroom bindings',()=>{
    expect(sql).toContain('openmaic_activity_documents'); expect(sql).toContain('openmaic_activity_sessions'); expect(sql).toContain('openmaic_activity_events'); expect(sql).not.toContain('course_classrooms');
  });
  it('cascades activity lifecycle and isolates every table by tenant',()=>{
    expect(sql).toContain('REFERENCES zhiban.course_activities(id,tenant_id) ON DELETE CASCADE'); expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(3);
  });
});
