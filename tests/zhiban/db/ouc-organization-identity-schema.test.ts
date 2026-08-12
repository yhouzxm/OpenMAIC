import { describe, expect, it } from 'vitest';
import { oucOrganizationIdentityMigration } from '@/lib/zhiban/db/migrations/025-ouc-organization-identity';

describe('OUC organization and identity migration', () => {
  it('models the four-level organization hierarchy and seeds the supplied chain', () => {
    const sql = oucOrganizationIdentityMigration.up.join('\n');
    for (const value of [
      'organization_units',
      'organization_level BETWEEN 1 AND 4',
      "'51161'",
      "'330'",
      "'33008'",
      "'3300804'",
      'tenant_organization_bindings',
      "scope_type IN ('organization'",
    ])
      expect(sql).toContain(value);
  });

  it('supports hashed multi-identifier login without storing identifier plaintext', () => {
    const sql = oucOrganizationIdentityMigration.up.join('\n');
    expect(sql).toContain('account_login_identifiers');
    expect(sql).toContain("'mobile','student_no','employee_no','admin_account','login_name'");
    expect(sql).toContain('lookup_hash CHAR(64) NOT NULL UNIQUE');
    expect(sql).not.toContain('identifier_value VARCHAR');
  });

  it('stores encrypted identity data and auditable import rollback snapshots', () => {
    const sql = oucOrganizationIdentityMigration.up.join('\n');
    for (const value of [
      'identity_number_encrypted BYTEA',
      'identity_number_lookup_hash CHAR(64)',
      "initial_password_policy IN ('ouchn_birthdate','random_one_time')",
      'identity_import_batches',
      'identity_import_rows',
      'identity_import_changes',
      'identity_entity_revisions',
      'before_data JSONB',
      'after_data JSONB',
      'rollback_conflict',
      'FORCE ROW LEVEL SECURITY',
    ])
      expect(sql).toContain(value);
  });

  it('provides a scoped reverse migration', () => {
    const down = oucOrganizationIdentityMigration.down.join('\n');
    expect(down).toContain('DROP TABLE IF EXISTS zhiban.identity_import_changes');
    expect(down).toContain('DROP TABLE IF EXISTS zhiban.organization_units');
    expect(down).not.toContain('DROP SCHEMA');
  });
});
