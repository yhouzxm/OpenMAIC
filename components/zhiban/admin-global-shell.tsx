'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  Database,
  GraduationCap,
  School,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { ZhibanLogoutButton } from './logout-button';

const navigation = [
  { label: '账号与权限', href: '/zhiban/admin', icon: ShieldCheck, exact: true },
  { label: '用户信息管理', href: '/zhiban/admin/users', icon: Users },
  { label: '学生信息管理', href: '/zhiban/admin/students', icon: GraduationCap },
  { label: '班级与课程', href: '/zhiban/admin/academic', icon: School },
  { label: '课程注册导入', href: '/zhiban/admin/import/registrations', icon: BookOpen },
] as const;

export function AdminGlobalShell({
  principalName,
  children,
}: {
  principalName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-[#f1f5fb] text-slate-800">
      <header className="sticky top-0 z-40 flex h-[52px] items-center justify-between bg-[#176fda] px-4 text-white shadow-sm md:px-8">
        <Link href="/zhiban/admin" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-full border-2 border-white">
            <Database className="size-5" />
          </span>
          <span className="text-lg">智伴·创学管理后台</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="hidden items-center gap-2 sm:flex">
            <UserRound className="size-5" />
            {principalName}
          </span>
          <ZhibanLogoutButton
            variant="outline"
            className="border-white/70 bg-transparent text-white hover:bg-white/15 hover:text-white"
          />
        </div>
      </header>
      <aside className="fixed bottom-0 left-0 top-[52px] z-30 hidden w-60 overflow-y-auto border-r bg-white lg:block">
        <div className="border-b px-6 py-7 text-center">
          <span className="mx-auto flex size-20 items-center justify-center rounded-full border-2 border-[#1677e8] bg-blue-50">
            <ShieldCheck className="size-10 text-[#1677e8]" />
          </span>
          <p className="mt-4 font-medium">{principalName}</p>
          <p className="mt-2 text-sm text-slate-500">机构管理员</p>
          <p className="mt-3 text-sm text-slate-500">智伴·创学</p>
        </div>
        <nav className="space-y-1 py-5">
          {navigation.map(({ label, href, icon: Icon, ...item }) => {
            const active =
              ('exact' in item && item.exact ? pathname === href : pathname.startsWith(href)) ||
              (href === '/zhiban/admin/users' && pathname === '/zhiban/admin/import/users') ||
              (href === '/zhiban/admin/students' && pathname === '/zhiban/admin/import/students');
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 border-l-4 px-7 py-3.5 text-sm ${active ? 'border-[#1677e8] bg-blue-50 font-medium text-[#1677e8]' : 'border-transparent hover:bg-slate-50'}`}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 lg:ml-60">{children}</main>
    </div>
  );
}
