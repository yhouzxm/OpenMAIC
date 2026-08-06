import { describe, expect, it } from 'vitest';
import { learnerProfileGovernanceMigration } from '@/lib/zhiban/db/migrations/015-learner-profile-governance';

const schema = learnerProfileGovernanceMigration.up.join('\n');

describe('learner profile governance migration', () => {
  it('adds collection preferences, corrections and event expiry', () => {
    expect(schema).toContain('ADD COLUMN expires_at');
    expect(schema).toContain('CREATE TABLE zhiban.learner_profile_preferences');
    expect(schema).toContain('collection_enabled BOOLEAN NOT NULL DEFAULT true');
    expect(schema).toContain('CREATE TABLE zhiban.learner_profile_corrections');
    expect(schema).toContain("status IN('pending','accepted','rejected','cancelled')");
  });

  it('enforces tenant RLS and has a reversible down migration', () => {
    expect(schema.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(2);
    expect(schema.match(/CREATE POLICY tenant_isolation/g)).toHaveLength(2);
    expect(learnerProfileGovernanceMigration.down.join('\n')).toContain(
      'DROP COLUMN IF EXISTS expires_at',
    );
  });
});
