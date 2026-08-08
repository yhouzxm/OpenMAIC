import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PblProjectConsole } from '@/components/zhiban/pbl-project-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function TeacherPblPage() {
  const value = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!value) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), value);
  if (!principal?.permissions.includes('course:manage')) redirect('/zhiban');
  return <PblProjectConsole hideHeader />;
}
