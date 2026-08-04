import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;

export const rbacDataScopesMigration: ZhibanMigration = {
  version: '004',
  description: 'RBAC data scope catalog and role scope policies',
  checksum: 'zhiban-004-rbac-data-scopes-v1',
  up: [
    `CREATE TABLE zhiban.authorization_scopes (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      scope_type VARCHAR(32) NOT NULL
        CHECK (scope_type IN ('project_group', 'class', 'course')),
      code VARCHAR(64) NOT NULL,
      name VARCHAR(200) NOT NULL,
      external_ref VARCHAR(200),
      parent_scope_id UUID REFERENCES zhiban.authorization_scopes(id) ON DELETE SET NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, scope_type, code),
      UNIQUE (id, tenant_id)
    )`,
    `CREATE INDEX authorization_scopes_lookup_idx
      ON zhiban.authorization_scopes (tenant_id, scope_type, status)`,
    `ALTER TABLE zhiban.authorization_scopes ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.authorization_scopes FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.authorization_scopes
      USING (tenant_id = ${tenantSetting}) WITH CHECK (tenant_id = ${tenantSetting})`,
    `CREATE TABLE zhiban.role_scope_policies (
      role_id UUID NOT NULL REFERENCES zhiban.roles(id) ON DELETE CASCADE,
      scope_type VARCHAR(32) NOT NULL
        CHECK (scope_type IN ('self', 'project_group', 'class', 'course', 'tenant', 'system')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (role_id, scope_type)
    )`,
    `INSERT INTO zhiban.role_scope_policies (role_id, scope_type)
      SELECT r.id, allowed.scope_type
      FROM zhiban.roles r
      JOIN (VALUES
        ('student', 'self'),
        ('head_teacher', 'class'),
        ('course_teacher', 'course'),
        ('risk_reviewer', 'class'),
        ('risk_reviewer', 'course'),
        ('risk_reviewer', 'tenant'),
        ('teaching_admin', 'tenant'),
        ('institution_admin', 'tenant'),
        ('system_admin', 'tenant'),
        ('system_admin', 'system'),
        ('researcher', 'tenant')
      ) AS allowed(role_code, scope_type) ON allowed.role_code = r.code
      WHERE r.tenant_id IS NULL
      ON CONFLICT DO NOTHING`,
    `UPDATE zhiban.role_assignments ra SET revoked_at = now()
      FROM zhiban.roles r
      WHERE ra.role_id = r.id AND r.code = 'student'
        AND ra.scope_type = 'tenant' AND ra.revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM zhiban.role_assignments existing
          WHERE existing.account_id = ra.account_id AND existing.role_id = ra.role_id
            AND existing.scope_type = 'self' AND existing.revoked_at IS NULL
        )`,
    `UPDATE zhiban.role_assignments ra SET scope_type = 'self', scope_id = NULL
      FROM zhiban.roles r
      WHERE ra.role_id = r.id AND r.code = 'student'
        AND ra.scope_type = 'tenant' AND ra.revoked_at IS NULL`,
    `UPDATE zhiban.role_assignments ra SET revoked_at = now()
      FROM zhiban.roles r
      WHERE ra.role_id = r.id AND r.code IN ('head_teacher', 'course_teacher')
        AND ra.scope_type = 'tenant' AND ra.revoked_at IS NULL`,
    `CREATE FUNCTION zhiban.validate_role_assignment_scope() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM zhiban.role_scope_policies policy
          WHERE policy.role_id = NEW.role_id AND policy.scope_type = NEW.scope_type
        ) THEN
          RAISE EXCEPTION 'scope type % is not allowed for role %', NEW.scope_type, NEW.role_id;
        END IF;
        IF NEW.scope_type IN ('project_group', 'class', 'course') AND NOT EXISTS (
          SELECT 1 FROM zhiban.authorization_scopes scope
          WHERE scope.id = NEW.scope_id AND scope.tenant_id = NEW.tenant_id
            AND scope.scope_type = NEW.scope_type AND scope.status = 'active'
        ) THEN
          RAISE EXCEPTION 'authorization scope is missing, archived, or has the wrong type';
        END IF;
        RETURN NEW;
      END $$`,
    `CREATE TRIGGER role_assignment_scope_guard
      BEFORE INSERT OR UPDATE OF role_id, scope_type, scope_id, tenant_id
      ON zhiban.role_assignments FOR EACH ROW
      EXECUTE FUNCTION zhiban.validate_role_assignment_scope()`,
  ],
  down: [
    `DROP TRIGGER IF EXISTS role_assignment_scope_guard ON zhiban.role_assignments`,
    `DROP FUNCTION IF EXISTS zhiban.validate_role_assignment_scope()`,
    `DROP TABLE IF EXISTS zhiban.role_scope_policies`,
    `DROP TABLE IF EXISTS zhiban.authorization_scopes`,
  ],
};
