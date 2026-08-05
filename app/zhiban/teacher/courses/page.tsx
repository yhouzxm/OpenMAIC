import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TeacherCourseConsole } from '@/components/zhiban/teacher-course-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
export default async function TeacherCoursesPage() {
  const store = await cookies();
  const value = store.get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!value) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), value);
  if (!principal) redirect('/zhiban/login');
  if (!principal.permissions.includes('course:manage')) redirect('/zhiban/admin');
  return <TeacherCourseConsole principalName={principal.displayName} />;
}
