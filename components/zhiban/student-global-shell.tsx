'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  FolderKanban,
  FileText,
  GraduationCap,
  Menu,
  MessagesSquare,
  Bot,
  Settings,
  UserRound,
  X,
} from 'lucide-react';
import { ZhibanLogoutButton } from './logout-button';

const navigation = [
  { label: '我的课程', href: '/zhiban/student/classrooms', icon: BookOpen },
  { label: 'PBL 项目', href: '/zhiban/student/pbl', icon: FolderKanban },
  { label: '测评与成绩', href: '/zhiban/student/grades', icon: GraduationCap },
  { label: '学习档案', href: '/zhiban/student/profile', icon: BarChart3 },
  { label: '学习支持', href: '/zhiban/student/risks', icon: AlertTriangle },
  { label: '个人设置', href: '/zhiban/student/settings', icon: Settings },
] as const;

const mobileNavigation = navigation.filter(({ href }) =>
  [
    '/zhiban/student/classrooms',
    '/zhiban/student/grades',
    '/zhiban/student/profile',
    '/zhiban/student/risks',
    '/zhiban/student/settings',
  ].includes(href),
);

export function StudentGlobalShell({
  principalName,
  organizationName,
  children,
}: {
  principalName: string;
  organizationName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const immersive =
    /^\/zhiban\/student\/classroom\/[^/]+/.test(pathname) ||
    /^\/zhiban\/student\/pbl\/[^/]+/.test(pathname) ||
    /^\/zhiban\/student\/courses\/[^/]+\/activities\/[^/]+/.test(pathname);
  const courseWorkspace =
    /^\/zhiban\/student\/courses\/[^/]+(?:\/(?:introduction|tools|coursework|resources|analysis|grades|support))?\/?$/.test(
      pathname,
    );

  if (immersive) return children;

  if (courseWorkspace)
    return (
      <div className="min-h-screen bg-[#f1f5fb] text-slate-800">
        <StudentTopbar
          principalName={principalName}
          mobileOpen={mobileOpen}
          onMenuToggle={() => setMobileOpen((open) => !open)}
        />
        {mobileOpen && (
          <CourseMobileMenu
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
        )}
        <main className="min-w-0">{children}</main>
      </div>
    );

  return (
    <div className="min-h-screen bg-[#f1f5fb] text-slate-800">
      <StudentTopbar
        principalName={principalName}
        mobileOpen={mobileOpen}
        onMenuToggle={() => setMobileOpen((open) => !open)}
      />
      <aside className="fixed bottom-0 left-0 top-[52px] z-30 hidden w-60 overflow-y-auto border-r bg-white lg:block">
        <StudentSidebarContent
          principalName={principalName}
          organizationName={organizationName}
          pathname={pathname}
        />
      </aside>
      {mobileOpen && (
        <>
          <button
            type="button"
            aria-label="关闭菜单"
            className="fixed inset-0 z-[45] cursor-default bg-transparent lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <nav className="fixed right-2 top-[56px] z-50 w-52 overflow-hidden rounded-md border bg-white py-2 text-sm shadow-xl lg:hidden">
            {mobileNavigation.map(({ label, href, icon: Icon }) => {
              const active =
                pathname === href ||
                pathname.startsWith(`${href}/`) ||
                (href === '/zhiban/student/classrooms' &&
                  pathname.startsWith('/zhiban/student/courses/'));
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 ${active ? 'bg-blue-50 font-medium text-[#1677e8]' : 'hover:bg-slate-50'}`}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </>
      )}
      <main className="min-w-0 lg:ml-60">{children}</main>
    </div>
  );
}

function CourseMobileMenu({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const match = pathname.match(/^\/zhiban\/student\/courses\/([^/]+)/);
  const courseId = match?.[1] ?? '';
  const base = `/zhiban/student/courses/${courseId}`;
  const items = [
    { label: '目录', href: base, icon: BookOpen },
    { label: '简介', href: `${base}/introduction`, icon: FileText },
    { label: '学习工具', href: `${base}/tools`, icon: Bot },
    { label: '讨论与作业', href: `${base}/coursework`, icon: MessagesSquare },
    { label: '课程资源', href: `${base}/resources`, icon: FolderKanban },
    { label: '学习成绩', href: `${base}/grades`, icon: GraduationCap },
    { label: '学习分析', href: `${base}/analysis`, icon: BarChart3 },
    { label: '学习支持', href: `${base}/support`, icon: AlertTriangle },
  ];
  return (
    <>
      <button type="button" aria-label="关闭课程菜单" className="fixed inset-0 z-[45] cursor-default bg-black/5 lg:hidden" onClick={onNavigate} />
      <nav className="fixed right-2 top-[56px] z-50 max-h-[calc(100vh-64px)] w-52 overflow-y-auto rounded-md border bg-white py-2 text-sm shadow-xl lg:hidden">
        {items.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== base && pathname.startsWith(`${href}/`));
          return <Link key={href} href={href} onClick={onNavigate} className={`flex items-center gap-3 px-4 py-3 ${active ? 'bg-blue-50 font-medium text-[#1677e8]' : 'hover:bg-slate-50'}`}><Icon className="size-4" />{label}</Link>;
        })}
        <div className="my-1 border-t" />
        <Link href="/zhiban/student/classrooms" onClick={onNavigate} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"><BookOpen className="size-4" />返回我的课程</Link>
      </nav>
    </>
  );
}

function StudentTopbar({
  principalName,
  mobileOpen,
  onMenuToggle,
}: {
  principalName: string;
  mobileOpen: boolean;
  onMenuToggle: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 flex h-[52px] items-center justify-between bg-[#176fda] px-4 text-white shadow-sm md:px-8">
      <div className="flex items-center">
        <Link href="/zhiban/student/classrooms" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-full border-2 border-white">
            <GraduationCap className="size-5" />
          </span>
          <span className="text-lg">智伴·创学</span>
        </Link>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <Bell className="hidden size-5 sm:block" />
        <Link
          href="/zhiban/student/settings"
          className="hidden items-center gap-2 hover:text-blue-100 sm:flex"
        >
          <StudentAvatar className="size-7 border-white" fallbackClassName="size-4" />
          <span>{principalName}</span>
        </Link>
        <ZhibanLogoutButton
          variant="outline"
          className="border-white/70 bg-transparent text-white hover:bg-white/15 hover:text-white"
        />
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded hover:bg-white/15 lg:hidden"
          aria-label={mobileOpen ? '关闭菜单' : '打开菜单'}
          aria-expanded={mobileOpen}
          onClick={onMenuToggle}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
    </header>
  );
}

function StudentSidebarContent({
  principalName,
  organizationName,
  pathname,
  onNavigate,
}: {
  principalName: string;
  organizationName: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      <Link
        href="/zhiban/student/settings"
        className="group block border-b px-6 py-7 text-center"
        onClick={onNavigate}
      >
        <StudentAvatar className="mx-auto size-20" fallbackClassName="size-11" />
        <p className="mt-4 font-medium group-hover:text-[#1677e8]">{principalName}</p>
        <p className="mt-2 text-sm text-slate-500">学生</p>
        <p className="mt-3 text-sm text-slate-500">{organizationName}</p>
      </Link>
      <nav className="space-y-1 py-5">
        {navigation.map(({ label, href, icon: Icon }) => {
          const active =
            pathname === href ||
            pathname.startsWith(`${href}/`) ||
            (href === '/zhiban/student/classrooms' &&
              pathname.startsWith('/zhiban/student/courses/'));
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 border-l-4 px-7 py-3.5 text-sm ${active ? 'border-[#1677e8] bg-blue-50 font-medium text-[#1677e8]' : 'border-transparent hover:bg-slate-50'}`}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function StudentAvatar({
  className,
  fallbackClassName,
}: {
  className: string;
  fallbackClassName: string;
}) {
  const [avatar, setAvatar] = useState('');
  useEffect(() => {
    void fetch('/api/zhiban/student/profile')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setAvatar(String(body?.profile?.avatarDataUrl ?? '')))
      .catch(() => undefined);
  }, []);
  return (
    <span
      className={`flex items-center justify-center overflow-hidden rounded-full border-2 border-[#1677e8] bg-blue-50 text-[#1677e8] ${className}`}
    >
      {avatar ? (
        <img src={avatar} alt="学生头像" className="size-full object-cover" />
      ) : (
        <UserRound className={fallbackClassName} />
      )}
    </span>
  );
}
