export interface ZhibanMigration {
  version: string;
  description: string;
  checksum: string;
  up: readonly string[];
  down: readonly string[];
}

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;

export const initialIdentityMigration: ZhibanMigration = {
  version: '001',
  description: 'initial identity, RBAC, service principal, and audit schema',
  checksum: 'zhiban-001-identity-v1',
  up: [
    `CREATE TABLE zhiban.tenants (
      id UUID PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL,
      tenant_type VARCHAR(32) NOT NULL DEFAULT 'institution'
        CHECK (tenant_type IN ('institution', 'system')),
      status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'archived')),
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )`,
    `CREATE TABLE zhiban.accounts (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE RESTRICT,
      login_name VARCHAR(128) NOT NULL,
      display_name VARCHAR(200) NOT NULL,
      account_type VARCHAR(24) NOT NULL
        CHECK (account_type IN ('student', 'teacher', 'admin')),
      status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'locked', 'disabled', 'archived')),
      mobile_encrypted BYTEA,
      mobile_lookup_hash VARCHAR(128),
      mobile_last4 VARCHAR(4),
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      UNIQUE (id, tenant_id),
      CHECK (mobile_last4 IS NULL OR mobile_last4 ~ '^[0-9]{4}$')
    )`,
    `CREATE UNIQUE INDEX accounts_tenant_login_active_uq
      ON zhiban.accounts (tenant_id, lower(login_name)) WHERE deleted_at IS NULL`,
    `CREATE UNIQUE INDEX accounts_tenant_mobile_active_uq
      ON zhiban.accounts (tenant_id, mobile_lookup_hash)
      WHERE mobile_lookup_hash IS NOT NULL AND deleted_at IS NULL`,
    `CREATE TABLE zhiban.password_credentials (
      account_id UUID PRIMARY KEY REFERENCES zhiban.accounts(id) ON DELETE CASCADE,
      password_hash TEXT NOT NULL,
      algorithm VARCHAR(32) NOT NULL DEFAULT 'argon2id'
        CHECK (algorithm = 'argon2id'),
      algorithm_version INTEGER NOT NULL DEFAULT 19 CHECK (algorithm_version > 0),
      must_change BOOLEAN NOT NULL DEFAULT true,
      failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
      locked_until TIMESTAMPTZ,
      password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE zhiban.student_profiles (
      account_id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      student_no VARCHAR(64) NOT NULL,
      real_name VARCHAR(200) NOT NULL,
      enrollment_year INTEGER CHECK (enrollment_year BETWEEN 1900 AND 9999),
      education_level VARCHAR(64),
      major_code VARCHAR(64),
      major_name VARCHAR(200),
      learning_center VARCHAR(200),
      study_status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (study_status IN ('active', 'suspended', 'graduated', 'withdrawn')),
      extension JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT student_profiles_account_fk FOREIGN KEY (account_id, tenant_id)
        REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE,
      CONSTRAINT student_profiles_tenant_no_uq UNIQUE (tenant_id, student_no)
    )`,
    `CREATE TABLE zhiban.teacher_profiles (
      account_id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      employee_no VARCHAR(64) NOT NULL,
      real_name VARCHAR(200) NOT NULL,
      department VARCHAR(200),
      professional_title VARCHAR(100),
      employment_status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (employment_status IN ('active', 'leave', 'retired', 'departed')),
      extension JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT teacher_profiles_account_fk FOREIGN KEY (account_id, tenant_id)
        REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE,
      CONSTRAINT teacher_profiles_tenant_employee_uq UNIQUE (tenant_id, employee_no)
    )`,
    `CREATE TABLE zhiban.admin_profiles (
      account_id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      admin_level VARCHAR(32) NOT NULL DEFAULT 'institution'
        CHECK (admin_level IN ('teaching', 'institution', 'system')),
      default_data_scope VARCHAR(32) NOT NULL DEFAULT 'tenant'
        CHECK (default_data_scope IN ('tenant', 'system')),
      extension JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT admin_profiles_account_fk FOREIGN KEY (account_id, tenant_id)
        REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE
    )`,
    `CREATE TABLE zhiban.roles (
      id UUID PRIMARY KEY,
      tenant_id UUID REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      code VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL,
      role_type VARCHAR(24) NOT NULL DEFAULT 'business'
        CHECK (role_type IN ('business', 'administrative', 'research')),
      system_role BOOLEAN NOT NULL DEFAULT false,
      status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX roles_system_code_uq
      ON zhiban.roles (code) WHERE tenant_id IS NULL`,
    `CREATE UNIQUE INDEX roles_tenant_code_uq
      ON zhiban.roles (tenant_id, code) WHERE tenant_id IS NOT NULL`,
    `CREATE TABLE zhiban.permissions (
      id UUID PRIMARY KEY,
      code VARCHAR(100) NOT NULL UNIQUE,
      resource VARCHAR(64) NOT NULL,
      action VARCHAR(64) NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (resource, action)
    )`,
    `CREATE TABLE zhiban.role_permissions (
      role_id UUID NOT NULL REFERENCES zhiban.roles(id) ON DELETE CASCADE,
      permission_id UUID NOT NULL REFERENCES zhiban.permissions(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (role_id, permission_id)
    )`,
    `CREATE TABLE zhiban.role_assignments (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      account_id UUID NOT NULL,
      role_id UUID NOT NULL REFERENCES zhiban.roles(id) ON DELETE RESTRICT,
      scope_type VARCHAR(32) NOT NULL
        CHECK (scope_type IN ('self', 'project_group', 'class', 'course', 'tenant', 'system')),
      scope_id UUID,
      granted_by UUID REFERENCES zhiban.accounts(id) ON DELETE SET NULL,
      valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
      valid_until TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT role_assignments_account_fk FOREIGN KEY (account_id, tenant_id)
        REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE,
      CHECK (valid_until IS NULL OR valid_until > valid_from),
      CHECK ((scope_type IN ('project_group', 'class', 'course') AND scope_id IS NOT NULL)
        OR (scope_type IN ('self', 'tenant', 'system') AND scope_id IS NULL))
    )`,
    `CREATE UNIQUE INDEX role_assignments_active_uq
      ON zhiban.role_assignments (account_id, role_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
      WHERE revoked_at IS NULL`,
    `CREATE INDEX role_assignments_authorization_idx
      ON zhiban.role_assignments (tenant_id, account_id, scope_type, scope_id)
      WHERE revoked_at IS NULL`,
    `CREATE TABLE zhiban.service_principals (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      code VARCHAR(64) NOT NULL,
      name VARCHAR(160) NOT NULL,
      principal_type VARCHAR(32) NOT NULL
        CHECK (principal_type IN ('tutor_agent', 'peer_agent', 'monitor_agent',
          'strategy_agent', 'integration_worker', 'analytics_worker')),
      capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
      allowed_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
      credential_hash TEXT,
      status VARCHAR(24) NOT NULL DEFAULT 'disabled'
        CHECK (status IN ('active', 'disabled', 'rotating')),
      credential_rotated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, code),
      CHECK (jsonb_typeof(capabilities) = 'array'),
      CHECK (jsonb_typeof(allowed_scopes) = 'array')
    )`,
    `CREATE TABLE zhiban.audit_log (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id UUID REFERENCES zhiban.tenants(id) ON DELETE SET NULL,
      actor_type VARCHAR(24) NOT NULL
        CHECK (actor_type IN ('account', 'service', 'system', 'anonymous')),
      actor_account_id UUID,
      actor_service_id UUID,
      action VARCHAR(120) NOT NULL,
      resource_type VARCHAR(100) NOT NULL,
      resource_id TEXT,
      request_id VARCHAR(128),
      ip_hash VARCHAR(128),
      before_data JSONB,
      after_data JSONB,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((actor_type = 'account' AND actor_account_id IS NOT NULL AND actor_service_id IS NULL)
        OR (actor_type = 'service' AND actor_service_id IS NOT NULL AND actor_account_id IS NULL)
        OR (actor_type IN ('system', 'anonymous') AND actor_account_id IS NULL AND actor_service_id IS NULL))
    )`,
    `CREATE INDEX audit_log_tenant_time_idx
      ON zhiban.audit_log (tenant_id, occurred_at DESC)`,
    `CREATE INDEX audit_log_resource_idx
      ON zhiban.audit_log (resource_type, resource_id, occurred_at DESC)`,
    `CREATE FUNCTION zhiban.reject_audit_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'zhiban.audit_log is append-only';
      END $$`,
    `CREATE TRIGGER audit_log_append_only
      BEFORE UPDATE OR DELETE ON zhiban.audit_log
      FOR EACH ROW EXECUTE FUNCTION zhiban.reject_audit_mutation()`,
    `INSERT INTO zhiban.roles (id, code, name, role_type, system_role) VALUES
      ('00000000-0000-4000-8000-000000000001', 'student', '学生', 'business', true),
      ('00000000-0000-4000-8000-000000000002', 'head_teacher', '班主任', 'business', true),
      ('00000000-0000-4000-8000-000000000003', 'course_teacher', '任课教师', 'business', true),
      ('00000000-0000-4000-8000-000000000004', 'risk_reviewer', '风险复核员', 'research', true),
      ('00000000-0000-4000-8000-000000000005', 'teaching_admin', '教学管理员', 'administrative', true),
      ('00000000-0000-4000-8000-000000000006', 'institution_admin', '机构管理员', 'administrative', true),
      ('00000000-0000-4000-8000-000000000007', 'system_admin', '系统管理员', 'administrative', true),
      ('00000000-0000-4000-8000-000000000008', 'researcher', '研究人员', 'research', true)`,
    `INSERT INTO zhiban.permissions (id, code, resource, action, description) VALUES
      ('10000000-0000-4000-8000-000000000001', 'account:read', 'account', 'read', '查看授权范围内账号'),
      ('10000000-0000-4000-8000-000000000002', 'account:manage', 'account', 'manage', '管理授权范围内账号'),
      ('10000000-0000-4000-8000-000000000003', 'course:read', 'course', 'read', '查看课程'),
      ('10000000-0000-4000-8000-000000000004', 'course:manage', 'course', 'manage', '管理课程'),
      ('10000000-0000-4000-8000-000000000005', 'grade:read', 'grade', 'read', '查看成绩'),
      ('10000000-0000-4000-8000-000000000006', 'grade:publish', 'grade', 'publish', '发布成绩'),
      ('10000000-0000-4000-8000-000000000007', 'risk:read', 'risk', 'read', '查看风险信息'),
      ('10000000-0000-4000-8000-000000000008', 'risk:handle', 'risk', 'handle', '处理风险案例'),
      ('10000000-0000-4000-8000-000000000009', 'audit:read', 'audit', 'read', '查看审计记录'),
      ('10000000-0000-4000-8000-000000000010', 'research:export', 'research', 'export', '导出脱敏研究数据')`,
    `INSERT INTO zhiban.role_permissions (role_id, permission_id)
      SELECT '00000000-0000-4000-8000-000000000007'::uuid, id FROM zhiban.permissions`,
    `ALTER TABLE zhiban.tenants ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.tenants
      USING (id = ${tenantSetting}) WITH CHECK (id = ${tenantSetting})`,
    ...[
      'accounts',
      'student_profiles',
      'teacher_profiles',
      'admin_profiles',
      'role_assignments',
      'service_principals',
      'audit_log',
    ].flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table}
        USING (tenant_id = ${tenantSetting}) WITH CHECK (tenant_id = ${tenantSetting})`,
    ]),
    `ALTER TABLE zhiban.roles ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_or_system_roles ON zhiban.roles
      USING (tenant_id IS NULL OR tenant_id = ${tenantSetting})
      WITH CHECK (tenant_id = ${tenantSetting})`,
    `ALTER TABLE zhiban.password_credentials ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY password_credentials_tenant_isolation ON zhiban.password_credentials
      USING (EXISTS (
        SELECT 1 FROM zhiban.accounts
        WHERE accounts.id = password_credentials.account_id
          AND accounts.tenant_id = ${tenantSetting}
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM zhiban.accounts
        WHERE accounts.id = password_credentials.account_id
          AND accounts.tenant_id = ${tenantSetting}
      ))`,
  ],
  down: [`DROP SCHEMA IF EXISTS zhiban CASCADE`],
};
