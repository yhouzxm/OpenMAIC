'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GraduationCap, Loader2, LockKeyhole } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ZhibanLoginPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState(process.env.NEXT_PUBLIC_ZHIBAN_TENANT_ID ?? '');
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/zhiban/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, loginName, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '登录失败');
      router.replace('/zhiban/admin');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_#ccfbf1,_transparent_42%),radial-gradient(circle_at_bottom_right,_#dbeafe,_transparent_38%)]" />
      <Card className="relative w-full max-w-md border-white/80 bg-white/90 shadow-2xl backdrop-blur">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-lg shadow-teal-600/20">
            <GraduationCap className="size-8" />
          </div>
          <div>
            <CardTitle className="text-2xl">智伴·创学</CardTitle>
            <CardDescription className="mt-2">登录账号与权限管理平台</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="tenantId">机构 ID</Label>
              <Input
                id="tenantId"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="UUID"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loginName">账号</Label>
              <Input
                id="loginName"
                autoComplete="username"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                placeholder="学号、工号或管理员账号"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <LockKeyhole className="absolute left-3 top-2.5 size-4 text-slate-400" />
                <Input
                  id="password"
                  className="pl-9"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <Button
              className="w-full bg-teal-600 hover:bg-teal-700"
              disabled={loading}
              type="submit"
            >
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}登录
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
