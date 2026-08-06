import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal, hasScopedPermission } from '@/lib/zhiban/rbac';
export default async function ZhibanEntry() {
  const store = await cookies();
  const value = store.get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!value) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), value);
  if (!principal) redirect('/zhiban/login');
  if (hasScopedPermission(principal, 'account:read')) redirect('/zhiban/admin');
  if (principal.permissions.includes('course:manage')) redirect('/zhiban/teacher/courses');
  if (principal.accountType === 'student' && principal.permissions.includes('course:read'))
    redirect('/zhiban/student/classrooms');
  return (
    <main className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">账号尚未配置工作台权限</h1>
      <p className="mt-3 text-slate-600">请联系管理员分配课程或管理角色。</p>
    </main>
  );
}
