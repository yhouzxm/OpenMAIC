import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { StudentGlobalShell } from '@/components/zhiban/student-global-shell';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal) redirect('/zhiban/login');
  if (principal.accountType !== 'student' && !principal.permissions.includes('course:read'))
    redirect('/zhiban');
  const organizationName = await withZhibanTenant(
    getZhibanPool(),
    principal.tenantId,
    async (client) =>
      (
        await client.query<{ organization_name: string }>(
          `SELECT COALESCE(learning_center.name,primary_org.name,sp.learning_center,tenant.name) organization_name
           FROM zhiban.accounts account
           JOIN zhiban.tenants tenant ON tenant.id=account.tenant_id
           LEFT JOIN zhiban.student_profiles sp ON sp.account_id=account.id AND sp.tenant_id=account.tenant_id
           LEFT JOIN zhiban.organization_units learning_center ON learning_center.id=sp.learning_center_organization_id
           LEFT JOIN zhiban.organization_units primary_org ON primary_org.id=account.primary_organization_id
           WHERE account.id=$1::uuid`,
          [principal.id],
        )
      ).rows[0]?.organization_name ?? '所属机构',
  );
  return (
    <StudentGlobalShell principalName={principal.displayName} organizationName={organizationName}>
      {children}
    </StudentGlobalShell>
  );
}
