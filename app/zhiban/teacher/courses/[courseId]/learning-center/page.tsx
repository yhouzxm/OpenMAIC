import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LearningCenter } from '@/components/zhiban/learning-center';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { getLearningCenterAccessState } from '@/lib/zhiban/learning-center/service';
import { resolveMechatronicsCourse } from '@/lib/zhiban/mechatronics-course';

export default async function TeacherLearningCenterPreviewPage({
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
  const course = await resolveMechatronicsCourse(pool, principal, courseId);
  if (!course) redirect(`/zhiban/teacher/courses/${courseId}`);
  const access = await getLearningCenterAccessState(pool, principal, course.id);
  if (access.access.mode !== 'teacher_preview') redirect(`/zhiban/teacher/courses/${course.id}`);
  if (courseId !== course.id) redirect(`/zhiban/teacher/courses/${course.id}/learning-center`);
  return <LearningCenter courseId={course.id} previewMode="teacher" />;
}
