import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { CourseRoster, CourseStudentRecord, CourseTeacherRecord } from './types';

type Row = Record<string, unknown>;

function text(value: unknown) {
  return value == null ? '' : String(value);
}

export async function getTeacherCourseRoster(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
): Promise<CourseRoster> {
  if (!principal.permissions.includes('course:manage')) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const hasTenantCourseScope = principal.grants.some(
      (grant) =>
        grant.permission === 'course:manage' &&
        (grant.scopeType === 'tenant' || grant.scopeType === 'system'),
    );
    const accessible = await client.query(
      `SELECT 1 FROM zhiban.courses c
       WHERE c.id=$1 AND c.tenant_id=$2 AND (
         c.owner_teacher_id=$3 OR EXISTS(
           SELECT 1 FROM zhiban.course_offerings o
           JOIN zhiban.teaching_assignments ta ON ta.offering_id=o.id
           WHERE o.course_id=c.id AND ta.teacher_id=$3 AND ta.ended_at IS NULL
         ) OR $4::boolean
       )`,
      [courseId, principal.tenantId, principal.id, hasTenantCourseScope],
    );
    if (!accessible.rows[0]) throw new Error('Permission denied');

    const [teacherResult, studentResult] = await Promise.all([
      client.query<Row>(
        `SELECT DISTINCT a.id,tp.employee_no,COALESCE(tp.real_name,a.display_name) name,
           COALESCE(org.name,'未设置') organization_name,ta.teaching_role,
           COALESCE(o.name,o.code) offering_name,ta.assigned_at
         FROM zhiban.course_offerings o
         JOIN zhiban.teaching_assignments ta ON ta.offering_id=o.id AND ta.ended_at IS NULL
         JOIN zhiban.accounts a ON a.id=ta.teacher_id AND a.deleted_at IS NULL
         LEFT JOIN zhiban.teacher_profiles tp ON tp.account_id=a.id
         LEFT JOIN zhiban.organization_units org ON org.id=a.primary_organization_id
         WHERE o.course_id=$1
         ORDER BY name,offering_name`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT DISTINCT a.id,sp.student_no,COALESCE(sp.real_name,a.display_name) name,
           COALESCE(org.name,sp.learning_center,'未设置') organization_name,
           COALESCE(cl.name,sp.class_name,'未分班') class_name,COALESCE(o.name,o.code) offering_name,
           e.status,e.enrolled_at
         FROM zhiban.course_offerings o
         JOIN zhiban.enrollments e ON e.offering_id=o.id
         JOIN zhiban.accounts a ON a.id=e.student_id AND a.deleted_at IS NULL
         LEFT JOIN zhiban.student_profiles sp ON sp.account_id=a.id
         LEFT JOIN zhiban.class_memberships cm ON cm.student_id=a.id AND cm.status='active'
         LEFT JOIN zhiban.course_offering_classes oc ON oc.offering_id=o.id AND oc.class_id=cm.class_id
         LEFT JOIN zhiban.classes cl ON cl.id=oc.class_id
         LEFT JOIN zhiban.organization_units org ON org.id=a.primary_organization_id
         WHERE o.course_id=$1
         ORDER BY name,offering_name`,
        [courseId],
      ),
    ]);

    const teachers: CourseTeacherRecord[] = teacherResult.rows.map((row) => ({
      id: text(row.id), employeeNo: text(row.employee_no), name: text(row.name),
      organizationName: text(row.organization_name),
      teachingRole: text(row.teaching_role) as CourseTeacherRecord['teachingRole'],
      offeringName: text(row.offering_name), assignedAt: new Date(text(row.assigned_at)).toISOString(),
    }));
    const students: CourseStudentRecord[] = studentResult.rows.map((row) => ({
      id: text(row.id), studentNo: text(row.student_no), name: text(row.name),
      organizationName: text(row.organization_name), className: text(row.class_name),
      offeringName: text(row.offering_name), status: text(row.status),
      enrolledAt: new Date(text(row.enrolled_at)).toISOString(),
    }));
    return { teachers, students };
  });
}
