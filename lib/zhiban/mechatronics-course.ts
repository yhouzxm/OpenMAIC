import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac/types';
import { AuthorizationError } from '@/lib/zhiban/rbac/service';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
export {
  MECHATRONICS_COURSE_CODE,
  MECHATRONICS_LEGACY_COURSE_ID,
} from './mechatronics-course.constants';
import {
  MECHATRONICS_COURSE_CODE,
  MECHATRONICS_LEGACY_COURSE_ID,
} from './mechatronics-course.constants';

/** Legacy route alias retained for old bookmarks and the original competition URL. */

export interface BoundMechatronicsCourse {
  id: string;
  code: string;
  name: string;
}

export async function resolveMechatronicsCourse(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  requestedCourseId: string,
): Promise<BoundMechatronicsCourse | null> {
  const result = await withZhibanTenant(pool, principal.tenantId, (client) =>
    client.query<{ id: string; code: string; name: string }>(
      `SELECT id,code,name FROM zhiban.courses
       WHERE tenant_id=$1 AND code=$2
       ORDER BY created_at ASC LIMIT 1`,
      [principal.tenantId, MECHATRONICS_COURSE_CODE],
    ),
  );
  const course = result.rows[0] ?? null;
  if (!course) return null;
  return requestedCourseId === MECHATRONICS_LEGACY_COURSE_ID || requestedCourseId === course.id
    ? course
    : null;
}

/** Returns the bound mechatronics course only when the authenticated student is enrolled. */
export async function resolveEnrolledMechatronicsCourse(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
): Promise<BoundMechatronicsCourse | null> {
  if (principal.accountType !== 'student') return null;
  const course = await resolveMechatronicsCourse(pool, principal, MECHATRONICS_LEGACY_COURSE_ID);
  if (!course) return null;
  const enrollment = await withZhibanTenant(pool, principal.tenantId, (client) =>
    client.query<{ id: string }>(
      `SELECT e.id FROM zhiban.enrollments e
       JOIN zhiban.course_offerings o ON o.id=e.offering_id
       WHERE e.tenant_id=$1 AND e.student_id=$2 AND e.status='enrolled' AND o.course_id=$3
       LIMIT 1`,
      [principal.tenantId, principal.id, course.id],
    ),
  );
  return enrollment.rows[0] ? course : null;
}

export async function requireMechatronicsStudentEnrollment(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  requestedCourseId: string,
): Promise<BoundMechatronicsCourse> {
  if (principal.accountType !== 'student') throw new AuthorizationError('Student access required');
  const course = await resolveMechatronicsCourse(pool, principal, requestedCourseId);
  if (!course) throw new AuthorizationError('课程不存在或未绑定机电智能诊断学习中心');
  const enrollment = await withZhibanTenant(pool, principal.tenantId, (client) =>
    client.query<{ id: string }>(
      `SELECT e.id FROM zhiban.enrollments e
       JOIN zhiban.course_offerings o ON o.id=e.offering_id
       WHERE e.tenant_id=$1 AND e.student_id=$2 AND e.status='enrolled' AND o.course_id=$3
       LIMIT 1`,
      [principal.tenantId, principal.id, course.id],
    ),
  );
  if (!enrollment.rows[0]) throw new AuthorizationError('你尚未选修“机电一体化系统”课程');
  return course;
}
