import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AcademicConsole } from '@/components/zhiban/academic-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal, hasScopedPermission } from '@/lib/zhiban/rbac';

export default async function AcademicAdminPage() {
  const cookieStore = await cookies();
  const value = cookieStore.get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!value) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), value);
  if (!principal) redirect('/zhiban/login');
  if (!hasScopedPermission(principal, 'course:manage')) redirect('/zhiban/admin');
  return <AcademicConsole />;
}
