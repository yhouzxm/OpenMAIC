import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TeacherPersonalSettings } from '@/components/zhiban/teacher-personal-settings';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function TeacherProfilePage() {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal) redirect('/zhiban/login');
  if (principal.accountType !== 'teacher') redirect('/zhiban');
  return <TeacherPersonalSettings principalName={principal.displayName} />;
}
