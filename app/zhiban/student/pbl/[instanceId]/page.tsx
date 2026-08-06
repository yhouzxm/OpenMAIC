import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PblInstanceRunner } from '@/components/zhiban/pbl-instance-runner';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { getStudentPblInstance } from '@/lib/zhiban/pbl';
export default async function StudentPblInstancePage({ params }: { params: Promise<{ instanceId: string }> }) {
  const value = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value; if (!value) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), value); if (!principal?.permissions.includes('course:read')) redirect('/zhiban');
  const { instanceId } = await params;
  const instance = await getStudentPblInstance(getZhibanPool(), principal, instanceId).catch(() => null);
  if (!instance) notFound();
  return <PblInstanceRunner instance={instance} />;
}
