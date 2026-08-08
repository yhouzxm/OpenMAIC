'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, BookOpen, ChevronDown, GraduationCap, Menu, Search, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { TeacherCourse } from '@/lib/zhiban/teacher-courses';
import { ZhibanLogoutButton } from './logout-button';

export function TeacherPortal({
  principalName,
  courses,
  embedded = false,
}: {
  principalName: string;
  courses: TeacherCourse[];
  embedded?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return courses.filter(
      (course) =>
        (status === 'all' || course.publicationStatus === status) &&
        (!keyword || `${course.name} ${course.code}`.toLowerCase().includes(keyword)),
    );
  }, [courses, query, status]);

  return (
    <div className={embedded ? 'contents' : 'min-h-screen bg-[#f1f5fb] text-slate-800'}>
      {!embedded && <TeacherTopbar principalName={principalName} />}
      <div className={embedded ? 'contents' : 'flex min-h-[calc(100vh-52px)]'}>
        {!embedded && (
          <aside className="hidden w-60 shrink-0 border-r bg-white lg:block">
            <div className="border-b px-6 py-7 text-center">
              <Link href="/zhiban/teacher/profile" className="group block" title="进入个人设置">
                <TeacherAvatar className="mx-auto size-20" fallbackClassName="size-11" />
                <p className="mt-4 font-medium group-hover:text-[#1677e8]">{principalName}</p>
              </Link>
              <p className="mt-2 text-sm text-slate-500">授课教师</p>
              <p className="mt-3 text-sm text-slate-500">智伴·创学</p>
            </div>
            <nav className="space-y-1 py-5 text-[16px]">
              <PortalNav href="/zhiban/teacher/courses">首页</PortalNav>
              <PortalNav href="/zhiban/teacher/courses" active>
                我的课程
              </PortalNav>
              <PortalNav href="/zhiban/teacher/classrooms">课堂教学</PortalNav>
              <PortalNav href="/zhiban/teacher/pbl">PBL 项目</PortalNav>
              <PortalNav href="/zhiban/teacher/grades">学生成绩</PortalNav>
              <PortalNav href="/zhiban/teacher/profiles">学习分析</PortalNav>
              <PortalNav href="/zhiban/teacher/agents">智能体中心</PortalNav>
              <PortalNav href="/zhiban/teacher/risks">风险预警</PortalNav>
            </nav>
          </aside>
        )}

        <main className="min-w-0 flex-1">
          <div className="border-b bg-white px-5 py-4 md:px-8">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold">我的课程</h1>
                <p className="mt-1 text-sm text-slate-500">选择课程进入教学工作区</p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <div className="relative min-w-0 flex-1 sm:w-72">
                  <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
                  <Input
                    className="pl-9"
                    placeholder="课程名称 / 课程代码"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-7xl p-5 md:p-8">
            <section className="mb-5 grid gap-3 rounded-sm border bg-white p-5 md:grid-cols-4">
              <Filter label="课程状态" value={status} onChange={setStatus}>
                <option value="all">全部</option>
                <option value="published">进行中</option>
                <option value="draft">草稿</option>
              </Filter>
              <Filter label="教学模式">
                <option>全部</option>
                <option>在线教学</option>
                <option>混合教学</option>
              </Filter>
              <Filter label="课程角色">
                <option>授课教师</option>
              </Filter>
              <Filter label="课程来源">
                <option>智伴·创学</option>
              </Filter>
            </section>

            <section className="space-y-3">
              {visible.map((course, index) => (
                <Link
                  key={course.id}
                  href={`/zhiban/teacher/courses/${course.id}`}
                  className="group flex flex-col gap-4 border bg-white p-5 transition hover:border-blue-300 hover:shadow-sm sm:flex-row sm:items-center"
                >
                  <div
                    className={`flex h-24 w-full shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${index % 2 ? 'from-cyan-500 to-blue-700' : 'from-blue-500 to-indigo-700'} text-white sm:w-36`}
                  >
                    <BookOpen className="size-10 opacity-90" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-medium text-[#0868db] group-hover:underline">
                        {course.name}
                      </h2>
                      <Badge className="bg-[#1677e8] hover:bg-[#1677e8]">
                        {course.publicationStatus === 'published' ? '进行中' : '草稿'}
                      </Badge>
                      {course.pblEnabled && <Badge variant="outline">PBL</Badge>}
                    </div>
                    <p className="mt-2 text-sm text-slate-500">课程代码：{course.code}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      教学模式：{deliveryLabel(course.deliveryMode)} · 学分：
                      {course.credits ?? '未设置'}
                    </p>
                  </div>
                  <span className="text-sm text-[#1677e8]">进入课程工作区 →</span>
                </Link>
              ))}
              {!visible.length && (
                <div className="border bg-white px-6 py-16 text-center text-slate-500">
                  没有符合条件的课程
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

export function TeacherTopbar({ principalName }: { principalName: string }) {
  return (
    <header className="sticky top-0 z-40 flex h-[52px] items-center justify-between bg-[#176fda] px-4 text-white shadow-sm md:px-8">
      <div className="flex items-center gap-8">
        <Link href="/zhiban/teacher/courses" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-full border-2 border-white">
            <GraduationCap className="size-5" />
          </span>
          <span className="text-lg">智伴·创学</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm md:flex">
          <Link href="/zhiban/teacher/courses">教学工作台</Link>
          <Link href="/zhiban/teacher/classrooms">OpenMAIC 课堂</Link>
          <Link href="/zhiban/teacher/pbl">项目式学习</Link>
        </nav>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <Bell className="hidden size-5 sm:block" />
        <Link
          href="/zhiban/teacher/profile"
          className="hidden items-center gap-2 hover:text-blue-100 sm:flex"
          title="进入个人设置"
        >
          <TeacherAvatar className="size-7 border-white" fallbackClassName="size-4" />
          <span>{principalName}</span>
        </Link>
        <ZhibanLogoutButton
          variant="outline"
          className="border-white/70 bg-transparent text-white hover:bg-white/15 hover:text-white"
        />
        <Menu className="size-5 md:hidden" />
      </div>
    </header>
  );
}

export function TeacherAvatar({
  className,
  fallbackClassName,
}: {
  className: string;
  fallbackClassName: string;
}) {
  const [avatar, setAvatar] = useState('');
  useEffect(() => {
    void fetch('/api/zhiban/teacher/profile')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setAvatar(String(body?.profile?.avatarDataUrl ?? '')))
      .catch(() => undefined);
  }, []);
  return (
    <span
      className={`flex items-center justify-center overflow-hidden rounded-full border-2 border-[#1677e8] bg-blue-50 text-[#1677e8] ${className}`}
    >
      {avatar ? (
        <img src={avatar} alt="教师头像" className="size-full object-cover" />
      ) : (
        <UserRound className={fallbackClassName} />
      )}
    </span>
  );
}

function PortalNav({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`block border-l-4 px-8 py-3 ${active ? 'border-[#1677e8] bg-blue-50 font-medium text-[#1677e8]' : 'border-transparent hover:bg-slate-50'}`}
    >
      {children}
    </Link>
  );
}

function Filter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="shrink-0">{label}</span>
      <span className="relative flex-1">
        <select
          className="h-9 w-full appearance-none rounded border bg-white px-3 pr-8"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-2.5 size-4 text-slate-400" />
      </span>
    </label>
  );
}

function deliveryLabel(mode: TeacherCourse['deliveryMode']) {
  return mode === 'online' ? '在线教学' : mode === 'face_to_face' ? '面授教学' : '混合教学';
}
