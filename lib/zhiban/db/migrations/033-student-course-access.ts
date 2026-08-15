import type { ZhibanMigration } from './001-initial-identity';

export const studentCourseAccessMigration: ZhibanMigration = {
  version: '033',
  description: 'grant enrolled students explicit course-scoped access',
  checksum: 'zhiban-033-student-course-access-v1',
  up: [
    `INSERT INTO zhiban.role_scope_policies (role_id, scope_type)
      SELECT id, 'course'
      FROM zhiban.roles
      WHERE tenant_id IS NULL AND code = 'student'
      ON CONFLICT DO NOTHING`,
    `INSERT INTO zhiban.authorization_scopes
      (id, tenant_id, scope_type, code, name, external_ref, status)
      SELECT c.id, c.tenant_id, 'course', c.code, c.name, c.external_course_id, 'active'
      FROM zhiban.courses c
      WHERE NOT EXISTS (
        SELECT 1 FROM zhiban.authorization_scopes scope WHERE scope.id = c.id
      )
      ON CONFLICT (tenant_id, scope_type, code) DO NOTHING`,
    `INSERT INTO zhiban.role_assignments
      (id, tenant_id, account_id, role_id, scope_type, scope_id, granted_by)
      SELECT md5(e.id::text || ':' || o.course_id::text)::uuid,
        e.tenant_id, e.student_id, r.id, 'course', o.course_id, e.created_by
      FROM zhiban.enrollments e
      JOIN zhiban.course_offerings o
        ON o.id = e.offering_id AND o.tenant_id = e.tenant_id
      JOIN zhiban.roles r ON r.tenant_id IS NULL AND r.code = 'student'
      WHERE e.status = 'enrolled'
      ON CONFLICT (account_id, role_id, scope_type,
        COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
        WHERE revoked_at IS NULL DO NOTHING`,
  ],
  down: [
    `DELETE FROM zhiban.role_assignments ra
      USING zhiban.roles r
      WHERE ra.role_id = r.id AND r.tenant_id IS NULL AND r.code = 'student'
        AND ra.scope_type = 'course'`,
    `DELETE FROM zhiban.role_scope_policies policy
      USING zhiban.roles r
      WHERE policy.role_id = r.id AND r.tenant_id IS NULL AND r.code = 'student'
        AND policy.scope_type = 'course'`,
  ],
};
