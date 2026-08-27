import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LearningCenter } from '@/components/zhiban/learning-center';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { isTeacherPreviewPrincipal } from '@/lib/zhiban/learning-center/access';
import { getLearningCenterAccessState } from '@/lib/zhiban/learning-center/service';
import {
  requireMechatronicsStudentEnrollment,
  resolveMechatronicsCourse,
} from '@/lib/zhiban/mechatronics-course';

export default async function LearningCenterPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal) redirect('/zhiban/login');
  const pool = getZhibanPool();
  if (principal.accountType !== 'student') {
    const course = await resolveMechatronicsCourse(pool, principal, courseId);
    if (course && isTeacherPreviewPrincipal(principal, course.id))
      redirect(`/zhiban/teacher/courses/${course.id}/learning-center`);
    redirect('/zhiban');
  }
  const course = await requireMechatronicsStudentEnrollment(pool, principal, courseId);
  const access = await getLearningCenterAccessState(pool, principal, course.id);
  if (access.access.mode === 'teacher_preview')
    redirect(`/zhiban/teacher/courses/${course.id}/learning-center`);
  if (courseId !== course.id) redirect(`/zhiban/student/courses/${course.id}/learning-center`);
  return <LearningCenter courseId={course.id} />;
}
