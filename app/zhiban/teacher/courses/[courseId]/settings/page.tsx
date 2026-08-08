import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TeacherCourseConsole } from '@/components/zhiban/teacher-course-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function TeacherCourseSettingsPage({
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
  return (
    <TeacherCourseConsole
      principalName={principal.displayName}
      initialCourseId={courseId}
      embedded
    />
  );
}
