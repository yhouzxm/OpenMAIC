import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AdminConsole } from '@/components/zhiban/admin-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function ZhibanAdminPage() {
  const cookieStore = await cookies();
  const value = cookieStore.get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!value) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), value);
  if (!principal) redirect('/zhiban/login');

  return <AdminConsole principal={principal} />;
}
