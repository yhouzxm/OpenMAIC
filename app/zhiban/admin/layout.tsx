import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminGlobalShell } from '@/components/zhiban/admin-global-shell';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal) redirect('/zhiban/login');
  return <AdminGlobalShell principalName={principal.displayName}>{children}</AdminGlobalShell>;
}
