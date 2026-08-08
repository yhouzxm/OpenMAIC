'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bot,
  ChevronDown,
  ClipboardCheck,
  FolderOpen,
  LayoutDashboard,
  Settings,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { TeacherCourse } from '@/lib/zhiban/teacher-courses';
import { TeacherTopbar } from './teacher-portal';

const features = [
  {
    label: '章节与课堂',
    description: '创建、绑定和管理 OpenMAIC 互动课堂',
    icon: BookOpen,
    route: 'classrooms',
  },
  {
    label: 'PBL 项目',
    description: '项目任务、分组、成果提交与评价',
    icon: Workflow,
    route: 'pbl',
  },
  {
    label: '学生成绩',
    description: '测评、成绩项、总评和成绩发布',
    icon: ClipboardCheck,
    route: 'grades',
  },
  {
    label: '学习分析',
    description: '学习事件、学习画像和 EMA 数据',
    icon: BarChart3,
    route: 'profiles',
  },
  {
    label: '风险预警',
    description: '风险识别、教师干预和效果追踪',
    icon: AlertTriangle,
    route: 'risks',
  },
  {
    label: '智能体中心',
    description: 'Tutor、Peer、Monitor 与干预审计',
    icon: Bot,
    route: 'agents',
  },
] as const;

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
            课程首页
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/classrooms${query}`}
            icon={BookOpen}
            active={pathname.startsWith(`${base}/classrooms`)}
          >
            章节与课堂
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/pbl${query}`}
            icon={Workflow}
            active={pathname.startsWith(`${base}/pbl`)}
          >
            PBL 项目
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/grades${query}`}
            icon={ClipboardCheck}
            active={pathname.startsWith(`${base}/grades`)}
          >
            学生成绩
          </WorkspaceNav>
          <WorkspaceNav
            href={`${base}/profiles${query}`}
            icon={BarChart3}
            active={pathname.startsWith(`${base}/profiles`)}
          >
            学习分析
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

export function TeacherCourseOverview({ course }: { course: TeacherCourse }) {
  const base = `/zhiban/teacher/courses/${course.id}`;
  const query = `?courseId=${encodeURIComponent(course.id)}`;
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
            <h2 className="text-lg font-semibold">课程教学管理</h2>
            <p className="mt-1 text-sm text-slate-500">左侧栏目保持不变，仅在右侧切换课程功能</p>
          </div>
          <span className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
            全部
            <ChevronDown className="size-4" />
          </span>
        </div>
        <div className="space-y-3">
          {features.map(({ label, description, icon: Icon, route }) => (
            <Link
              key={route}
              href={`${base}/${route}${query}`}
              className="group flex items-center gap-4 rounded bg-[#f6f7f9] px-5 py-4 hover:bg-blue-50"
            >
              <ChevronDown className="size-4 -rotate-90 text-slate-500" />
              <Icon className="size-5 text-[#1677e8]" />
              <div className="min-w-0 flex-1">
                <h3 className="font-medium group-hover:text-[#1677e8]">{label}</h3>
                <p className="mt-1 text-sm text-slate-500">{description}</p>
              </div>
              <span className="hidden text-sm text-[#1677e8] sm:inline">进入管理 →</span>
            </Link>
          ))}
        </div>
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
