import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal, hasScopedPermission } from '@/lib/zhiban/rbac';

export default async function ImportPage() {
  const store = await cookies();
  const value = store.get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!value) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), value);
  if (!principal) redirect('/zhiban/login');
  if (!hasScopedPermission(principal, 'account:manage')) redirect('/zhiban/admin');
  redirect('/zhiban/admin/import/users');
}
