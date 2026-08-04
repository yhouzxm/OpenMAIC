'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Plus, RefreshCw, ShieldCheck, UserRoundCog, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthorizedPrincipal, ManagedAccount } from '@/lib/zhiban/rbac';

interface RoleOption {
  id: string;
  code: string;
  name: string;
  roleType: string;
}
type AccountType = 'student' | 'teacher' | 'admin';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? '操作失败');
  return result as T;
}

export function AdminConsole({ principal }: { principal: AuthorizedPrincipal }) {
  const router = useRouter();
  const canManage = principal.permissions.includes('account:manage');
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountResult, roleResult] = await Promise.all([
        api<{ accounts: ManagedAccount[] }>('/api/zhiban/admin/accounts'),
        api<{ roles: RoleOption[] }>('/api/zhiban/admin/roles'),
      ]);
      setAccounts(accountResult.accounts);
      setRoles(roleResult.roles);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await fetch('/api/zhiban/auth/logout', { method: 'POST' });
    router.replace('/zhiban/login');
    router.refresh();
  }

  const activeCount = useMemo(
    () => accounts.filter((account) => account.status === 'active').length,
    [accounts],
  );

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 rounded-2xl bg-slate-950 px-6 py-5 text-white shadow-xl sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-teal-300">智伴·创学管理中心</p>
          <h1 className="mt-1 text-2xl font-semibold">账号与 RBAC 授权</h1>
          <p className="mt-1 text-sm text-slate-300">
            {principal.displayName} · {principal.roles.join('、')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button
            variant="outline"
            className="border-slate-600 bg-transparent text-white hover:bg-slate-800 hover:text-white"
            onClick={() => void logout()}
          >
            <LogOut className="mr-2 size-4" />
            退出
          </Button>
        </div>
      </header>

      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <Summary icon={<Users />} label="账号总数" value={accounts.length} />
        <Summary icon={<ShieldCheck />} label="正常账号" value={activeCount} />
        <Summary icon={<UserRoundCog />} label="可分配角色" value={roles.length} />
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>账号列表</CardTitle>
          {canManage && (
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => setShowCreate((value) => !value)}
            >
              <Plus className="mr-2 size-4" />
              新建账号
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {showCreate && (
            <CreateAccountForm
              roles={roles}
              onCancel={() => setShowCreate(false)}
              onCreated={async () => {
                setShowCreate(false);
                await load();
              }}
            />
          )}
          {loading ? (
            <p className="py-12 text-center text-slate-500">正在加载…</p>
          ) : accounts.length === 0 ? (
            <p className="py-12 text-center text-slate-500">暂无账号</p>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  roles={roles}
                  canManage={canManage}
                  isSelf={account.id === principal.id}
                  onChanged={load}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className="rounded-xl bg-teal-50 p-3 text-teal-700">{icon}</div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateAccountForm({
  roles,
  onCancel,
  onCreated,
}: {
  roles: RoleOption[];
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const [type, setType] = useState<AccountType>('student');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const body: Record<string, FormDataEntryValue | AccountType> = {
      ...values,
      accountType: type,
      ...(type === 'student'
        ? { studentNo: values.identifier }
        : type === 'teacher'
          ? { employeeNo: values.identifier }
          : { adminLevel: 'institution' }),
    };
    delete body.identifier;
    try {
      await api('/api/zhiban/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast.success('账号创建成功');
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败');
    } finally {
      setSaving(false);
    }
  }
  const roleOptions = roles.filter((role) => type !== 'student' || role.code === 'student');
  return (
    <form onSubmit={submit} className="grid gap-4 rounded-xl border bg-slate-50 p-4 md:grid-cols-3">
      <Field label="账号类型">
        <select
          className={selectClass}
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
        >
          <option value="student">学生</option>
          <option value="teacher">教师</option>
          <option value="admin">管理员</option>
        </select>
      </Field>
      <Field label="登录账号">
        <Input name="loginName" required />
      </Field>
      <Field label="显示名称">
        <Input name="displayName" required />
      </Field>
      <Field label="真实姓名">
        <Input name="realName" required />
      </Field>
      {type !== 'admin' && (
        <Field label={type === 'student' ? '学号' : '工号'}>
          <Input name="identifier" required />
        </Field>
      )}
      <Field label="手机号（可选）">
        <Input name="mobile" />
      </Field>
      <Field label="初始密码（至少12位，含字母和数字）">
        <Input name="password" type="password" minLength={12} required />
      </Field>
      <Field label="初始角色">
        <select
          className={selectClass}
          name="initialRoleCode"
          required
          defaultValue={type === 'student' ? 'student' : ''}
        >
          <option value="" disabled>
            请选择
          </option>
          {roleOptions.map((role) => (
            <option key={role.id} value={role.code}>
              {role.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end gap-2 md:col-span-3">
        <Button disabled={saving} type="submit">
          {saving ? '保存中…' : '创建账号'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function AccountRow({
  account,
  roles,
  canManage,
  isSelf,
  onChanged,
}: {
  account: ManagedAccount;
  roles: RoleOption[];
  canManage: boolean;
  isSelf: boolean;
  onChanged: () => Promise<void>;
}) {
  const [roleCode, setRoleCode] = useState('');
  const [busy, setBusy] = useState(false);
  const available = roles.filter(
    (role) => !account.roles.some((assigned) => assigned.roleCode === role.code),
  );
  async function mutate(url: string, init: RequestInit, success: string) {
    setBusy(true);
    try {
      await api(url, init);
      toast.success(success);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="rounded-xl border p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{account.displayName}</h3>
            <Badge variant={account.status === 'active' ? 'default' : 'secondary'}>
              {account.status === 'active' ? '正常' : '已停用'}
            </Badge>
            <Badge variant="outline">{account.accountType}</Badge>
            {isSelf && <Badge variant="outline">当前账号</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {account.loginName}
            {account.identifier ? ` · ${account.identifier}` : ''}
            {account.mobileLast4 ? ` · 手机尾号 ${account.mobileLast4}` : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {account.roles.length ? (
              account.roles.map((assignment) => (
                <span
                  key={assignment.id}
                  className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs text-teal-800"
                >
                  {assignment.roleName}
                  {canManage && !isSelf && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          `/api/zhiban/admin/role-assignments/${assignment.id}`,
                          { method: 'DELETE' },
                          '角色已撤销',
                        )
                      }
                      className="ml-1 font-bold text-teal-600 hover:text-red-600"
                      aria-label={`撤销${assignment.roleName}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))
            ) : (
              <span className="text-xs text-amber-700">尚未分配角色</span>
            )}
          </div>
        </div>
        {canManage && (
          <div className="flex min-w-72 flex-col gap-2 sm:flex-row">
            <select
              className={selectClass}
              value={roleCode}
              onChange={(e) => setRoleCode(e.target.value)}
            >
              <option value="">添加角色</option>
              {available.map((role) => (
                <option key={role.id} value={role.code}>
                  {role.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={!roleCode || busy}
              onClick={() =>
                void mutate(
                  '/api/zhiban/admin/role-assignments',
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accountId: account.id, roleCode }),
                  },
                  '角色已授予',
                ).then(() => setRoleCode(''))
              }
            >
              授权
            </Button>
            <Button
              variant="outline"
              disabled={isSelf || busy}
              onClick={() =>
                void mutate(
                  `/api/zhiban/admin/accounts/${account.id}`,
                  {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      status: account.status === 'active' ? 'disabled' : 'active',
                    }),
                  },
                  account.status === 'active' ? '账号已停用' : '账号已启用',
                )
              }
            >
              {account.status === 'active' ? '停用' : '启用'}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
