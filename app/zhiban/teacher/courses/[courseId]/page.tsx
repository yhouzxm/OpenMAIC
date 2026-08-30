import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { TeacherCourseOverview } from '@/components/zhiban/teacher-course-workspace';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { listTeacherCourses } from '@/lib/zhiban/teacher-courses';
import { getTeacherCourseStructure } from '@/lib/zhiban/curriculum';
import { MECHATRONICS_COURSE_CODE } from '@/lib/zhiban/mechatronics-course.constants';

export default async function TeacherCoursePage({
  params,
}: {
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
  if (course.code === MECHATRONICS_COURSE_CODE)
    redirect(`/zhiban/teacher/courses/${course.id}/learning-center`);
  const structure = await getTeacherCourseStructure(getZhibanPool(), principal, courseId);
  return (
    <TeacherCourseOverview
      course={course}
      modules={structure.modules}
      publishedVersion={
        structure.versions.find((version) => version.status === 'published')?.version ?? null
      }
    />
  );
}
