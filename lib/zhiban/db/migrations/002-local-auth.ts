import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;

const tenantTables = [
  'tenants',
  'accounts',
  'password_credentials',
  'student_profiles',
  'teacher_profiles',
  'admin_profiles',
  'roles',
  'role_assignments',
  'service_principals',
  'audit_log',
] as const;

export const localAuthMigration: ZhibanMigration = {
  version: '002',
  description: 'local authentication sessions and password reset tokens',
  checksum: 'zhiban-002-local-auth-v1',
  up: [
    `CREATE TABLE zhiban.user_sessions (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      account_id UUID NOT NULL,
      access_token_hash VARCHAR(128) NOT NULL UNIQUE,
      authenticated_via VARCHAR(32) NOT NULL DEFAULT 'local'
        CHECK (authenticated_via = 'local'),
      assurance_level VARCHAR(32) NOT NULL DEFAULT 'password'
        CHECK (assurance_level = 'password'),
      ip_hash VARCHAR(128),
      user_agent_hash VARCHAR(128),
      authenticated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ,
      revoke_reason VARCHAR(64),
      CONSTRAINT user_sessions_account_fk FOREIGN KEY (account_id, tenant_id)
        REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE,
      CHECK (expires_at > authenticated_at)
    )`,
    `CREATE INDEX user_sessions_active_account_idx
      ON zhiban.user_sessions (tenant_id, account_id, expires_at DESC)
      WHERE revoked_at IS NULL`,
    `CREATE TABLE zhiban.password_reset_tokens (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      account_id UUID NOT NULL,
      token_hash VARCHAR(128) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      requested_ip_hash VARCHAR(128),
      CONSTRAINT password_reset_tokens_account_fk FOREIGN KEY (account_id, tenant_id)
        REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE,
      CHECK (expires_at > created_at)
    )`,
    `CREATE INDEX password_reset_tokens_active_account_idx
      ON zhiban.password_reset_tokens (tenant_id, account_id, expires_at DESC)
      WHERE used_at IS NULL`,
    `ALTER TABLE zhiban.user_sessions ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.user_sessions FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.user_sessions
      USING (tenant_id = ${tenantSetting}) WITH CHECK (tenant_id = ${tenantSetting})`,
    `ALTER TABLE zhiban.password_reset_tokens ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.password_reset_tokens FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.password_reset_tokens
      USING (tenant_id = ${tenantSetting}) WITH CHECK (tenant_id = ${tenantSetting})`,
    ...tenantTables.map((table) => `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`),
  ],
  down: [
    ...[...tenantTables]
      .reverse()
      .map((table) => `ALTER TABLE zhiban.${table} NO FORCE ROW LEVEL SECURITY`),
    'DROP TABLE IF EXISTS zhiban.password_reset_tokens',
    'DROP TABLE IF EXISTS zhiban.user_sessions',
  ],
};
