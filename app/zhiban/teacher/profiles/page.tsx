import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TeacherProfileConsole } from '@/components/zhiban/teacher-profile-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
export default async function Page() {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const p = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!p?.permissions.includes('course:manage')) redirect('/zhiban');
  return <TeacherProfileConsole hideHeader />;
}
