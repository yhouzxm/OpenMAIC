import type { ZhibanMigration } from './001-initial-identity';

const rolePermissions: Record<string, readonly string[]> = {
  student: ['course:read', 'grade:read'],
  head_teacher: ['account:read', 'course:read', 'grade:read', 'risk:read', 'risk:handle'],
  course_teacher: [
    'account:read',
    'course:read',
    'course:manage',
    'grade:read',
    'grade:publish',
    'risk:read',
  ],
  risk_reviewer: ['account:read', 'risk:read', 'risk:handle'],
  teaching_admin: [
    'account:read',
    'course:read',
    'course:manage',
    'grade:read',
    'grade:publish',
    'risk:read',
    'risk:handle',
  ],
  institution_admin: [
    'account:read',
    'account:manage',
    'course:read',
    'course:manage',
    'grade:read',
    'grade:publish',
    'risk:read',
    'risk:handle',
    'audit:read',
    'research:export',
  ],
  researcher: ['research:export'],
};

const insertStatements = Object.entries(rolePermissions).map(
  ([role, permissions]) => `INSERT INTO zhiban.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM zhiban.roles r
    JOIN zhiban.permissions p ON p.code = ANY (ARRAY[${permissions
      .map((permission) => `'${permission}'`)
      .join(', ')}]::varchar[])
    WHERE r.code = '${role}' AND r.tenant_id IS NULL
    ON CONFLICT DO NOTHING`,
);

export const defaultRbacMigration: ZhibanMigration = {
  version: '003',
  description: 'default role permission mappings',
  checksum: 'zhiban-003-default-rbac-v1',
  up: insertStatements,
  down: [
    `DELETE FROM zhiban.role_permissions rp
     USING zhiban.roles r
     WHERE rp.role_id = r.id AND r.tenant_id IS NULL
       AND r.code IN (${Object.keys(rolePermissions)
         .map((role) => `'${role}'`)
         .join(', ')})`,
  ],
};
