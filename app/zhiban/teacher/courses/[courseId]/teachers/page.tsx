import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TeacherCourseTeachers } from '@/components/zhiban/teacher-course-roster';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getTeacherCourseRoster } from '@/lib/zhiban/course-roster';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function CourseTeachersPage({ params }: { params: Promise<{ courseId: string }> }) {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal) redirect('/zhiban/login');
  const { courseId } = await params;
  const roster = await getTeacherCourseRoster(getZhibanPool(), principal, courseId);
  return <TeacherCourseTeachers teachers={roster.teachers} />;
}
