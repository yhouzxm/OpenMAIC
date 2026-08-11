import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { StudentGlobalShell } from '@/components/zhiban/student-global-shell';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal) redirect('/zhiban/login');
  if (principal.accountType !== 'student' && !principal.permissions.includes('course:read'))
    redirect('/zhiban');
  return <StudentGlobalShell principalName={principal.displayName}>{children}</StudentGlobalShell>;
}
