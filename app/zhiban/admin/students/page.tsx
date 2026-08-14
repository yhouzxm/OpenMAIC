import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { StudentRegistryConsole } from '@/components/zhiban/student-registry-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal, hasScopedPermission } from '@/lib/zhiban/rbac';

export default async function Page() {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const pool = getZhibanPool(),
    principal = await getAuthorizedPrincipal(pool, token);
  if (!principal) redirect('/zhiban/login');
  if (!hasScopedPermission(principal, 'class:manage')) redirect('/zhiban/admin');
  return <StudentRegistryConsole />;
}
