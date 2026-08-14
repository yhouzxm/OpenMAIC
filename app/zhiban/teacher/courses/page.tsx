import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TeacherPortal } from '@/components/zhiban/teacher-portal';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { listTeacherCourses } from '@/lib/zhiban/teacher-courses';
export default async function TeacherCoursesPage() {
  const store = await cookies();
  const value = store.get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!value) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), value);
  if (!principal) redirect('/zhiban/login');
  if (principal.accountType !== 'teacher') redirect('/zhiban');
  const courses = await listTeacherCourses(getZhibanPool(), principal);
  return <TeacherPortal principalName={principal.displayName} courses={courses} embedded />;
}
