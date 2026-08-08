import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { TeacherCourseShell } from '@/components/zhiban/teacher-course-workspace';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { listTeacherCourses } from '@/lib/zhiban/teacher-courses';

export default async function TeacherCourseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ courseId: string }>;
}) {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal) redirect('/zhiban/login');
  if (!principal.permissions.includes('course:manage')) redirect('/zhiban');
  const { courseId } = await params;
  const course = (await listTeacherCourses(getZhibanPool(), principal)).find(
    (item) => item.id === courseId,
  );
  if (!course) notFound();
  return (
    <TeacherCourseShell principalName={principal.displayName} course={course}>
      {children}
    </TeacherCourseShell>
  );
}
