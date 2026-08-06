import { describe, expect, it } from 'vitest';
import { openmaicClassroomAdaptationMigration } from '@/lib/zhiban/db/migrations/011-openmaic-classroom-adaptation';

describe('OpenMAIC classroom adaptation schema', () => {
  const ddl = openmaicClassroomAdaptationMigration.up.join('\n');
  it('stores course bindings, learner progress, and idempotent events', () => {
    expect(ddl).toContain('CREATE TABLE zhiban.course_classrooms');
    expect(ddl).toContain('CREATE TABLE zhiban.classroom_learning_sessions');
    expect(ddl).toContain('CREATE TABLE zhiban.classroom_learning_events');
    expect(ddl).toContain('UNIQUE (tenant_id,event_id)');
  });
  it('forces tenant RLS on every new table and has a reversible down migration', () => {
    expect(ddl.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(3);
    expect(openmaicClassroomAdaptationMigration.down).toHaveLength(3);
  });
});
