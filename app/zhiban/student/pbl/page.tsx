import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { StudentPblConsole } from '@/components/zhiban/student-pbl-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
export default async function StudentPblPage() {
  const value = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value; if (!value) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), value); if (!principal?.permissions.includes('course:read')) redirect('/zhiban');
  return <StudentPblConsole />;
}
