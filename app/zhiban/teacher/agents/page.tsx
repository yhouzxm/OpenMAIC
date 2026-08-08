import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TeacherAgentConsole } from '@/components/zhiban/teacher-agent-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
export default async function Page() {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal?.permissions.includes('course:manage')) redirect('/zhiban');
  return <TeacherAgentConsole hideHeader />;
}
