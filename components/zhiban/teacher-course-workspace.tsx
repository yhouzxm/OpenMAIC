'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bot,
  ClipboardCheck,
  FolderOpen,
  LayoutDashboard,
  Settings,
  UserRound,
  Users,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { TeacherCourse } from '@/lib/zhiban/teacher-courses';
import type { CourseActivityType, CourseModule } from '@/lib/zhiban/curriculum';
import { TeacherTopbar } from './teacher-portal';

const activityTypeLabels: Record<CourseActivityType, string> = {
  content: '图文内容',
  resource: '课程资源',
  classroom: 'OpenMAIC 课堂',
  pbl: 'PBL 项目',
  assignment: '作业',
  quiz: '测验',
  discussion: '讨论',
  ema: 'EMA 问卷',
  practice: '实训',
  summary: '章节总结',
  ai_support: 'AI 辅导',
  openmaic_slide: '幻灯片',
  openmaic_quiz: 'Quiz',
  openmaic_interactive: '互动网页',
  openmaic_pbl: 'PBL 互动',
  openmaic_3d: '3D 互动',
};

export function TeacherCourseShell({
  principalName,
  course,
  children,
}: {
  principalName: string;
  course: TeacherCourse;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = `/zhiban/teacher/courses/${course.id}`;
  const query = `?courseId=${encodeURIComponent(course.id)}`;
  return (
    <div className="min-h-screen bg-[#f1f5fb] text-slate-800">
      <TeacherTopbar principalName={principalName} />
      <header className="border-b bg-white px-5 py-4 md:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-5">
            <Link
              href="/zhiban/teacher/courses"
              className="flex shrink-0 items-center gap-1 border-r pr-5 text-sm hover:text-blue-600"
            >
              <ArrowLeft className="size-4" />
              返回
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold">{course.name}</h1>
                <Badge variant="outline">
                  {course.publicationStatus === 'published' ? '进行中' : '草稿'}
                </Badge>
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">授课教师</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                课程代码：{course.code}　学分：{course.credits ?? '未设置'}　教学模式：
                {deliveryLabel(course.deliveryMode)}
              </p>
            </div>
          </div>
          <Link
            href={`${base}/settings${query}`}
            className="rounded border px-4 py-2 text-sm hover:border-blue-400 hover:text-blue-600"
          >
            课程设置
          </Link>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1580px] items-stretch">
        <aside className="sticky top-[52px] hidden h-[calc(100vh-52px)] w-60 shrink-0 self-start overflow-y-auto border-r bg-white py-4 lg:block">
          <WorkspaceNav href={base} icon={LayoutDashboard} active={pathname === base}>
            章节
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/classrooms${query}`}
            icon={BookOpen}
            active={pathname.startsWith(`${base}/classrooms`)}
          >
            课堂与互动
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/pbl${query}`}
            icon={Workflow}
            active={pathname.startsWith(`${base}/pbl`)}
          >
            PBL 项目
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/teachers${query}`}
            icon={UserRound}
            active={pathname.startsWith(`${base}/teachers`)}
          >
            课程教师
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/students${query}`}
            icon={Users}
            active={pathname.startsWith(`${base}/students`)}
          >
            选课学生
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/grades${query}`}
            icon={ClipboardCheck}
            active={pathname.startsWith(`${base}/grades`)}
          >
            学生成绩
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/analytics${query}`}
            icon={BarChart3}
            active={pathname.startsWith(`${base}/analytics`) || pathname.startsWith(`${base}/profiles`)}
          >
            教学分析
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/risks${query}`}
            icon={AlertTriangle}
            active={pathname.startsWith(`${base}/risks`)}
          >
            风险预警
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/agents${query}`}
            icon={Bot}
            active={pathname.startsWith(`${base}/agents`)}
          >
            智能体中心
          </WorkspaceNav>
          <div className="my-3 border-t" />
          <WorkspaceNav
            href={`${base}/settings${query}`}
            icon={Settings}
            active={pathname.startsWith(`${base}/settings`)}
          >
            课程设置
          </WorkspaceNav>
        </aside>
        <main className="min-w-0 flex-1 p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}

export function TeacherCourseOverview({
  course,
  modules,
  publishedVersion,
}: {
  course: TeacherCourse;
  modules: CourseModule[];
  publishedVersion: number | null;
}) {
  const base = `/zhiban/teacher/courses/${course.id}`;
  const query = `?courseId=${encodeURIComponent(course.id)}`;
  const activityCount = modules.reduce(
    (moduleTotal, moduleItem) =>
      moduleTotal +
      moduleItem.chapters.reduce(
        (chapterTotal, chapter) => chapterTotal + chapter.activities.length,
        0,
      ),
    0,
  );
  return (
    <>
      <section className="mb-5 grid gap-4 md:grid-cols-4">
        <Summary
          icon={BookOpen}
          label="课堂与场景"
          value={course.sceneRules.length}
          suffix="项规则"
        />
        <Summary
          icon={Workflow}
          label="PBL 项目"
          value={course.pblProjects.length}
          suffix="个项目"
        />
        <Summary
          icon={FolderOpen}
          label="课程资源"
          value={course.courseResources.length}
          suffix="项资源"
        />
        <Summary
          icon={Bot}
          label="启用智能体"
          value={Object.values(course.agentSettings).filter(Boolean).length}
          suffix="个角色"
        />
      </section>
      <section className="border bg-white p-5">
        <div className="mb-5 flex items-center justify-between border-b pb-4">
          <div>
            <h2 className="text-lg font-semibold">课程结构</h2>
            <p className="mt-1 text-sm text-slate-500">
              {publishedVersion ? `当前已发布 v${publishedVersion}` : '当前结构尚未发布'} ·{' '}
              {modules.length} 个模块 ·{' '}
              {modules.reduce((sum, moduleItem) => sum + moduleItem.chapters.length, 0)} 个章节 ·{' '}
              {activityCount} 个活动
            </p>
          </div>
          <Link
            href={`${base}/classrooms${query}`}
            className="rounded bg-[#1677e8] px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            编辑课程结构
          </Link>
        </div>
        {modules.length ? (
          <div className="space-y-3">
            {modules.map((moduleItem, moduleIndex) => (
              <article key={moduleItem.id} className="rounded border bg-slate-50/60">
                <div className="flex items-center gap-3 border-b px-4 py-3">
                  <span className="flex size-7 items-center justify-center rounded bg-blue-100 text-sm font-semibold text-blue-700">
                    {moduleIndex + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium">{moduleItem.title}</h3>
                    {moduleItem.description && (
                      <p className="truncate text-xs text-slate-500">{moduleItem.description}</p>
                    )}
                  </div>
                  <span className="text-xs text-slate-500">
                    {moduleItem.chapters.length} 个章节
                  </span>
                </div>
                <div className="divide-y bg-white">
                  {moduleItem.chapters.map((chapter, chapterIndex) => (
                    <div key={chapter.id}>
                      <div className="flex items-center gap-3 px-5 py-3 text-sm">
                        <span className="text-slate-400">
                          {moduleIndex + 1}.{chapterIndex + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {chapter.title}
                        </span>
                        <span className="text-xs text-slate-500">
                          {chapter.activities.length} 个活动 · {chapter.estimatedMinutes} 分钟
                        </span>
                      </div>
                      {chapter.activities.length ? (
                        <div className="border-t bg-slate-50/50 px-5 py-2 pl-12">
                          {chapter.activities.map((activity, activityIndex) => (
                            <div
                              key={activity.id}
                              className="flex min-h-9 items-center gap-3 border-b border-dashed py-2 text-sm last:border-b-0"
                            >
                              <span className="w-7 shrink-0 text-xs text-slate-400">
                                {activityIndex + 1}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{activity.title}</span>
                              <Badge variant="outline" className="shrink-0 font-normal">
                                {activityTypeLabels[activity.activityType]}
                              </Badge>
                              {activity.required && (
                                <span className="shrink-0 text-xs text-blue-600">必修</span>
                              )}
                              <span className="w-16 shrink-0 text-right text-xs text-slate-500">
                                {activity.estimatedMinutes} 分钟
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="border-t bg-slate-50/50 px-12 py-3 text-xs text-slate-400">
                          本章节尚未添加活动
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded border border-dashed py-12 text-center text-sm text-slate-500">
            尚未建立课程结构。点击右上角“编辑课程结构”开始创建模块、章节和活动。
          </div>
        )}
      </section>
      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="border bg-white p-5">
          <h2 className="font-semibold">课程说明</h2>
          <p className="mt-3 min-h-16 whitespace-pre-wrap text-sm leading-6 text-slate-600">
            {course.description || '尚未填写课程说明。'}
          </p>
        </div>
        <div className="border bg-white p-5">
          <h2 className="font-semibold">成绩权重</h2>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <Weight label="过程性" value={course.gradingPolicy.formativeWeight} />
            <Weight label="PBL 项目" value={course.gradingPolicy.projectWeight} />
            <Weight label="期末" value={course.gradingPolicy.finalWeight} />
          </div>
        </div>
      </section>
    </>
  );
}

function WorkspaceNav({
  href,
  icon: Icon,
  active,
  children,
}: {
  href: string;
  icon: typeof BookOpen;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 border-l-4 px-6 py-3.5 text-sm ${active ? 'border-[#1677e8] bg-blue-50 font-medium text-[#1677e8]' : 'border-transparent hover:bg-slate-50'}`}
    >
      <Icon className="size-4" />
      {children}
    </Link>
  );
}
function Summary({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: typeof BookOpen;
  label: string;
  value: number;
  suffix: string;
}) {
  return (
    <div className="flex items-center gap-4 border bg-white p-5">
      <span className="flex size-11 items-center justify-center rounded bg-blue-50 text-[#1677e8]">
        <Icon className="size-6" />
      </span>
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-xl font-semibold">
          {value}
          <span className="ml-1 text-xs font-normal text-slate-400">{suffix}</span>
        </p>
      </div>
    </div>
  );
}
function Weight({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-slate-50 p-3">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[#1677e8]">{value}%</p>
    </div>
  );
}
function deliveryLabel(mode: TeacherCourse['deliveryMode']) {
  return mode === 'online' ? '在线教学' : mode === 'face_to_face' ? '面授教学' : '混合教学';
}
