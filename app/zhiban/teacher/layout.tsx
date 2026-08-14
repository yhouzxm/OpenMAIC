import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TeacherGlobalShell } from '@/components/zhiban/teacher-global-shell';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal) redirect('/zhiban/login');
  if (principal.accountType !== 'teacher' && !principal.permissions.includes('course:manage'))
    redirect('/zhiban');
  const institutionName = await withZhibanTenant(
    getZhibanPool(),
    principal.tenantId,
    async (client) => {
      const result = await client.query<{ institution_name: string }>(
        `SELECT COALESCE(ou.name,t.name) institution_name
         FROM zhiban.accounts a
         JOIN zhiban.tenants t ON t.id=a.tenant_id
         LEFT JOIN zhiban.organization_units ou ON ou.id=a.primary_organization_id
         WHERE a.id=$1 AND a.tenant_id=$2`,
        [principal.id, principal.tenantId],
      );
      return result.rows[0]?.institution_name ?? '未设置机构';
    },
  );
  return (
    <TeacherGlobalShell principalName={principal.displayName} institutionName={institutionName}>
      {children}
    </TeacherGlobalShell>
  );
}
