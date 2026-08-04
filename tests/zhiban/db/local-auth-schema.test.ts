import { describe, expect, it } from 'vitest';

import { localAuthMigration } from '@/lib/zhiban/db/migrations/002-local-auth';

const schema = localAuthMigration.up.join('\n');

describe('Zhiban local auth migration contract', () => {
  it('creates hashed sessions and one-time reset tokens without plaintext secrets', () => {
    expect(schema).toContain('CREATE TABLE zhiban.user_sessions');
    expect(schema).toContain('access_token_hash VARCHAR(128) NOT NULL UNIQUE');
    expect(schema).toContain('CREATE TABLE zhiban.password_reset_tokens');
    expect(schema).toContain('token_hash VARCHAR(128) NOT NULL UNIQUE');
    expect(schema).not.toMatch(/password\s+(TEXT|VARCHAR)/i);
  });

  it('enforces tenant RLS and hardens existing tenant tables with FORCE RLS', () => {
    expect(schema).toContain('ALTER TABLE zhiban.user_sessions FORCE ROW LEVEL SECURITY');
    expect(schema).toContain('ALTER TABLE zhiban.password_reset_tokens FORCE ROW LEVEL SECURITY');
    expect(schema).toContain('ALTER TABLE zhiban.accounts FORCE ROW LEVEL SECURITY');
    expect(schema).toContain("current_setting('zhiban.tenant_id', true)");
  });

  it('has a scoped rollback that preserves migration 001 data', () => {
    expect(localAuthMigration.down).toContain('DROP TABLE IF EXISTS zhiban.user_sessions');
    expect(localAuthMigration.down).toContain('DROP TABLE IF EXISTS zhiban.password_reset_tokens');
    expect(localAuthMigration.down.join('\n')).not.toContain('DROP SCHEMA');
  });
});
