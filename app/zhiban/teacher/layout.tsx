import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TeacherGlobalShell } from '@/components/zhiban/teacher-global-shell';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal) redirect('/zhiban/login');
  if (principal.accountType !== 'teacher' && !principal.permissions.includes('course:manage'))
    redirect('/zhiban');
  return <TeacherGlobalShell principalName={principal.displayName}>{children}</TeacherGlobalShell>;
}
