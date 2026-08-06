import { describe, expect, it } from 'vitest';
import { learningEventsProfilesMigration } from '@/lib/zhiban/db/migrations/014-learning-events-profiles';
describe('learning events and profiles schema', () => {
  const ddl = learningEventsProfilesMigration.up.join('\n');
  it('creates ledger, profiles, snapshots and backfills sources', () => {
    expect(ddl).toContain('CREATE TABLE zhiban.learning_events');
    expect(ddl).toContain('CREATE TABLE zhiban.learner_profiles');
    expect(ddl).toContain('CREATE TABLE zhiban.learner_profile_snapshots');
    expect(ddl).toContain('classroom_learning_events');
    expect(ddl).toContain('pbl_learning_events');
  });
  it('forces tenant RLS', () => expect(ddl.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(3));
});
