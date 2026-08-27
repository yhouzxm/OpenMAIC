'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BookOpen,
  Bot,
  ClipboardCheck,
  FileText,
  GraduationCap,
  MessagesSquare,
  Route,
} from 'lucide-react';
import type { ZhibanCourseClassroom } from '@/lib/zhiban/classroom';
import { MECH_LAB_SAMPLE_COURSE_ID } from '@/lib/zhiban/virtual-lab/registry';
import { MECHATRONICS_COURSE_CODE } from '@/lib/zhiban/mechatronics-course.constants';

export function StudentCourseWorkspaceShell({
  courseId,
  children,
}: {
  courseId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [classrooms, setClassrooms] = useState<ZhibanCourseClassroom[]>([]);
  useEffect(() => {
    void fetch('/api/zhiban/classrooms')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '课程信息加载失败');
        setClassrooms(body.classrooms ?? []);
      })
      .catch(() => setClassrooms([]));
  }, []);

  if (pathname.includes('/activities/')) return children;
  if (/\/learning-center(?:\/|$)/.test(pathname)) return children;

  const courseClassrooms = classrooms.filter((item) => item.courseId === courseId);
  const course = courseClassrooms[0];
  const isMechLabSample =
    courseId === MECH_LAB_SAMPLE_COURSE_ID || course?.courseCode === MECHATRONICS_COURSE_CODE;
  const progress = courseClassrooms.length
    ? Math.round(
        courseClassrooms.reduce((sum, item) => sum + item.progressPercent, 0) /
          courseClassrooms.length,
      )
    : 0;
  const dates = dateRange(courseClassrooms);

  return (
    <div className="min-h-[calc(100vh-52px)] bg-[#f1f5fb]">
      <section className="bg-gradient-to-r from-[#071b48] via-[#102849] to-[#6d310b] px-4 py-5 text-white sm:px-5 sm:py-7 md:px-10">
        <div className="mx-auto max-w-[1500px]">
          <p className="mb-4 truncate text-xs text-blue-100 sm:mb-5 sm:text-sm">
            <Link href="/zhiban/student/classrooms" className="hover:underline">
              我的课程
            </Link>
            <span className="mx-2">/</span>
            {course?.courseName ?? (isMechLabSample ? '机电一体化系统' : '课程学习工作区')}
          </p>
          <div className="flex flex-col gap-7 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-5 sm:flex-row sm:items-center">
              <div className="hidden h-32 w-56 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-800 shadow-lg sm:flex">
                <BookOpen className="size-12 text-white/90 sm:size-16" />
              </div>
              <div className="min-w-0">
                <h1 className="break-words text-2xl font-semibold sm:text-3xl">
                  {course?.courseName ?? (isMechLabSample ? '机电一体化系统' : '课程学习工作区')}
                </h1>
                <p className="mt-3 text-sm text-blue-50 sm:mt-5">
                  课程代码：{course?.courseCode ?? (isMechLabSample ? 'MECH-101' : '—')}
                </p>
                <p className="mt-2 text-sm text-blue-50">
                  学习周期：{isMechLabSample ? '交互式课件示例' : dates}
                </p>
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-3 rounded-lg bg-white/35 p-3 backdrop-blur-sm sm:flex-nowrap sm:gap-4 sm:p-4 lg:w-[430px]">
              <span className="shrink-0 text-sm">已学 {progress}%</span>
              <div className="h-2 min-w-20 flex-1 overflow-hidden rounded bg-white/45">
                <div className="h-full bg-blue-400" style={{ width: `${progress}%` }} />
              </div>
              <Link
                href={`/zhiban/student/courses/${courseId}`}
                className="shrink-0 rounded bg-[#1677e8] px-4 py-2 text-sm hover:bg-blue-700"
              >
                {progress ? '继续学习' : '开始学习'}
              </Link>
            </div>
          </div>
        </div>
      </section>
      <div className="mx-auto flex max-w-[1580px] items-stretch">
        <aside className="sticky top-[52px] hidden h-[calc(100vh-52px)] w-60 shrink-0 self-start overflow-y-auto border-r bg-white py-4 lg:block">
          <CourseNav href={`/zhiban/student/courses/${courseId}`} icon={BookOpen}>
            目录
          </CourseNav>
          <CourseNav href={`/zhiban/student/courses/${courseId}/introduction`} icon={FileText}>
            简介
          </CourseNav>
          <CourseNav href={`/zhiban/student/courses/${courseId}/tools`} icon={Bot}>
            学习工具
          </CourseNav>
          <CourseNav href={`/zhiban/student/courses/${courseId}/coursework`} icon={MessagesSquare}>
            讨论与作业
          </CourseNav>
          <CourseNav href={`/zhiban/student/courses/${courseId}/resources`} icon={FileText}>
            课程资源
          </CourseNav>
          {isMechLabSample && (
            <CourseNav href={`/zhiban/student/courses/${courseId}/learning-center`} icon={Route}>
              学习中心
            </CourseNav>
          )}
          <div className="my-3 border-t" />
          <CourseNav href={`/zhiban/student/courses/${courseId}/grades`} icon={GraduationCap}>
            学习成绩
          </CourseNav>
          <CourseNav href={`/zhiban/student/courses/${courseId}/analysis`} icon={BarChart3}>
            学习分析
          </CourseNav>
          <CourseNav href={`/zhiban/student/courses/${courseId}/support`} icon={ClipboardCheck}>
            学习支持
          </CourseNav>
        </aside>
        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-2 sm:p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
function CourseNav({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof BookOpen;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-l-4 border-transparent px-7 py-3.5 text-sm hover:border-[#1677e8] hover:bg-blue-50 hover:text-[#1677e8]"
    >
      <Icon className="size-4" />
      {children}
    </Link>
  );
}

function dateRange(items: ZhibanCourseClassroom[]) {
  const starts = items
    .map((item) => item.opensAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const ends = items
    .map((item) => item.closesAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const format = (value?: string) =>
    value ? new Date(value).toLocaleDateString('zh-CN') : '未设置';
  return `${format(starts[0])} — ${format(ends.at(-1))}`;
}
