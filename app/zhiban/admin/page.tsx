import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AdminConsole } from '@/components/zhiban/admin-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal, hasScopedPermission } from '@/lib/zhiban/rbac';

export default async function ZhibanAdminPage() {
  const cookieStore = await cookies();
  const value = cookieStore.get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!value) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), value);
  if (!principal) redirect('/zhiban/login');

  if (!hasScopedPermission(principal, 'account:read')) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">无权访问账号管理</h1>
        <p className="mt-3 text-slate-600">请联系机构管理员分配账号查看权限。</p>
      </main>
    );
  }

  return <AdminConsole principal={principal} />;
}
