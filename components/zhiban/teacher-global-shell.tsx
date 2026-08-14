'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, BarChart3, BookOpen, Bot, GraduationCap, Workflow } from 'lucide-react';
import { TeacherAvatar, TeacherTopbar } from './teacher-portal';

const navigation = [
  { label: '我的课程', href: '/zhiban/teacher/courses', icon: BookOpen },
  { label: '课堂教学', href: '/zhiban/teacher/classrooms', icon: GraduationCap },
  { label: 'PBL 项目', href: '/zhiban/teacher/pbl', icon: Workflow },
  { label: '学生成绩', href: '/zhiban/teacher/grades', icon: BarChart3 },
  { label: '学习分析', href: '/zhiban/teacher/profiles', icon: BarChart3 },
  { label: '智能体中心', href: '/zhiban/teacher/agents', icon: Bot },
  { label: '风险预警', href: '/zhiban/teacher/risks', icon: AlertTriangle },
] as const;

export function TeacherGlobalShell({
  principalName,
  institutionName,
  children,
}: {
  principalName: string;
  institutionName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (/^\/zhiban\/teacher\/courses\/[^/]+/.test(pathname) || pathname === '/zhiban/teacher/profile')
    return children;
  return (
    <div className="min-h-screen bg-[#f1f5fb] text-slate-800">
      <TeacherTopbar principalName={principalName} />
      <div className="flex min-h-[calc(100vh-52px)]">
        <aside className="sticky top-[52px] hidden h-[calc(100vh-52px)] w-60 shrink-0 overflow-y-auto border-r bg-white lg:block">
          <Link
            href="/zhiban/teacher/profile"
            className="group block border-b px-6 py-7 text-center"
          >
            <TeacherAvatar className="mx-auto size-20" fallbackClassName="size-11" />
            <p className="mt-4 font-medium group-hover:text-[#1677e8]">{principalName}</p>
            <p className="mt-2 text-sm text-slate-500">授课教师</p>
            <p className="mt-3 text-sm text-slate-500">{institutionName}</p>
          </Link>
          <nav className="space-y-1 py-5">
            {navigation.map(({ label, href, icon: Icon }) => {
              const active = pathname === href;
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
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
