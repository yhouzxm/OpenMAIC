import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id', true), '')::uuid`;

const tenantTables = [
  'academic_terms',
  'classes',
  'courses',
  'course_offerings',
  'class_memberships',
  'teaching_assignments',
  'enrollments',
];

export const academicOrganizationMigration: ZhibanMigration = {
  version: '005',
  description: 'academic terms, classes, courses, teaching assignments, and enrollments',
  checksum: 'zhiban-005-academic-organization-v1',
  up: [
    `INSERT INTO zhiban.permissions (id, code, resource, action, description) VALUES
      ('10000000-0000-4000-8000-000000000011', 'class:read', 'class', 'read', '查看授权范围内班级'),
      ('10000000-0000-4000-8000-000000000012', 'class:manage', 'class', 'manage', '管理授权范围内班级'),
      ('10000000-0000-4000-8000-000000000013', 'enrollment:read', 'enrollment', 'read', '查看授权范围内选课'),
      ('10000000-0000-4000-8000-000000000014', 'enrollment:manage', 'enrollment', 'manage', '管理授权范围内选课')
      ON CONFLICT (code) DO NOTHING`,
    `INSERT INTO zhiban.role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM zhiban.roles r
      JOIN (VALUES
        ('student', 'class:read'), ('student', 'enrollment:read'),
        ('head_teacher', 'class:read'), ('head_teacher', 'class:manage'),
        ('head_teacher', 'enrollment:read'), ('head_teacher', 'enrollment:manage'),
        ('course_teacher', 'class:read'), ('course_teacher', 'enrollment:read'),
        ('teaching_admin', 'class:read'), ('teaching_admin', 'class:manage'),
        ('teaching_admin', 'enrollment:read'), ('teaching_admin', 'enrollment:manage'),
        ('institution_admin', 'class:read'), ('institution_admin', 'class:manage'),
        ('institution_admin', 'enrollment:read'), ('institution_admin', 'enrollment:manage'),
        ('system_admin', 'class:read'), ('system_admin', 'class:manage'),
        ('system_admin', 'enrollment:read'), ('system_admin', 'enrollment:manage')
      ) AS grant_map(role_code, permission_code) ON grant_map.role_code = r.code
      JOIN zhiban.permissions p ON p.code = grant_map.permission_code
      WHERE r.tenant_id IS NULL ON CONFLICT DO NOTHING`,
    `CREATE TABLE zhiban.academic_terms (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      code VARCHAR(64) NOT NULL,
      name VARCHAR(160) NOT NULL,
      starts_on DATE NOT NULL,
      ends_on DATE NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'active', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, code), UNIQUE (id, tenant_id),
      CHECK (ends_on >= starts_on)
    )`,
    `CREATE TABLE zhiban.classes (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      term_id UUID NOT NULL,
      code VARCHAR(64) NOT NULL,
      name VARCHAR(200) NOT NULL,
      head_teacher_id UUID,
      capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
      status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed', 'archived')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (id, tenant_id) REFERENCES zhiban.authorization_scopes(id, tenant_id) ON DELETE RESTRICT,
      FOREIGN KEY (term_id, tenant_id) REFERENCES zhiban.academic_terms(id, tenant_id) ON DELETE RESTRICT,
      FOREIGN KEY (head_teacher_id, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE RESTRICT,
      UNIQUE (tenant_id, code), UNIQUE (id, tenant_id)
    )`,
    `CREATE TABLE zhiban.courses (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      code VARCHAR(64) NOT NULL,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      credits NUMERIC(5,2) CHECK (credits IS NULL OR credits >= 0),
      owner_teacher_id UUID,
      status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'archived')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (id, tenant_id) REFERENCES zhiban.authorization_scopes(id, tenant_id) ON DELETE RESTRICT,
      FOREIGN KEY (owner_teacher_id, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE RESTRICT,
      UNIQUE (tenant_id, code), UNIQUE (id, tenant_id)
    )`,
    `CREATE TABLE zhiban.course_offerings (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      course_id UUID NOT NULL,
      term_id UUID NOT NULL,
      class_id UUID,
      code VARCHAR(80) NOT NULL,
      capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
      enrollment_starts_at TIMESTAMPTZ,
      enrollment_ends_at TIMESTAMPTZ,
      status VARCHAR(24) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'open', 'in_progress', 'completed', 'cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (course_id, tenant_id) REFERENCES zhiban.courses(id, tenant_id) ON DELETE RESTRICT,
      FOREIGN KEY (term_id, tenant_id) REFERENCES zhiban.academic_terms(id, tenant_id) ON DELETE RESTRICT,
      FOREIGN KEY (class_id, tenant_id) REFERENCES zhiban.classes(id, tenant_id) ON DELETE RESTRICT,
      UNIQUE (tenant_id, code), UNIQUE (id, tenant_id),
      CHECK (enrollment_ends_at IS NULL OR enrollment_starts_at IS NULL OR enrollment_ends_at >= enrollment_starts_at)
    )`,
    `CREATE TABLE zhiban.class_memberships (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      class_id UUID NOT NULL,
      student_id UUID NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'transferred', 'completed', 'withdrawn')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      left_at TIMESTAMPTZ,
      FOREIGN KEY (class_id, tenant_id) REFERENCES zhiban.classes(id, tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (student_id, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE,
      UNIQUE (class_id, student_id)
    )`,
    `CREATE TABLE zhiban.teaching_assignments (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      offering_id UUID NOT NULL,
      teacher_id UUID NOT NULL,
      teaching_role VARCHAR(32) NOT NULL DEFAULT 'primary'
        CHECK (teaching_role IN ('primary', 'assistant', 'tutor')),
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at TIMESTAMPTZ,
      FOREIGN KEY (offering_id, tenant_id) REFERENCES zhiban.course_offerings(id, tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_id, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE,
      UNIQUE (offering_id, teacher_id, teaching_role)
    )`,
    `CREATE TABLE zhiban.enrollments (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      offering_id UUID NOT NULL,
      student_id UUID NOT NULL,
      source VARCHAR(24) NOT NULL DEFAULT 'admin'
        CHECK (source IN ('admin', 'self', 'import', 'class_sync')),
      status VARCHAR(24) NOT NULL DEFAULT 'enrolled'
        CHECK (status IN ('pending', 'enrolled', 'completed', 'dropped', 'rejected')),
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      dropped_at TIMESTAMPTZ,
      created_by UUID,
      FOREIGN KEY (offering_id, tenant_id) REFERENCES zhiban.course_offerings(id, tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (student_id, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (created_by, tenant_id) REFERENCES zhiban.accounts(id, tenant_id) ON DELETE RESTRICT,
      UNIQUE (offering_id, student_id), UNIQUE (id, tenant_id)
    )`,
    ...tenantTables.flatMap((table) => [
      `ALTER TABLE zhiban.${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE zhiban.${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON zhiban.${table}
        USING (tenant_id = ${tenantSetting}) WITH CHECK (tenant_id = ${tenantSetting})`,
    ]),
    `CREATE INDEX class_memberships_student_idx ON zhiban.class_memberships (tenant_id, student_id, status)`,
    `CREATE INDEX teaching_assignments_teacher_idx ON zhiban.teaching_assignments (tenant_id, teacher_id)`,
    `CREATE INDEX enrollments_student_idx ON zhiban.enrollments (tenant_id, student_id, status)`,
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.enrollments`,
    `DROP TABLE IF EXISTS zhiban.teaching_assignments`,
    `DROP TABLE IF EXISTS zhiban.class_memberships`,
    `DROP TABLE IF EXISTS zhiban.course_offerings`,
    `DROP TABLE IF EXISTS zhiban.courses`,
    `DROP TABLE IF EXISTS zhiban.classes`,
    `DROP TABLE IF EXISTS zhiban.academic_terms`,
    `DELETE FROM zhiban.role_permissions rp USING zhiban.permissions p
      WHERE rp.permission_id = p.id AND p.code IN ('class:read', 'class:manage', 'enrollment:read', 'enrollment:manage')`,
    `DELETE FROM zhiban.permissions WHERE code IN ('class:read', 'class:manage', 'enrollment:read', 'enrollment:manage')`,
  ],
};
