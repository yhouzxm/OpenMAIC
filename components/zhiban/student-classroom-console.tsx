'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, BookOpen, FolderKanban, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ZhibanCourseClassroom } from '@/lib/zhiban/classroom';
import { ZhibanLogoutButton } from './logout-button';

export function StudentClassroomConsole({ hideHeader = false }: { hideHeader?: boolean }) {
  const [classrooms, setClassrooms] = useState<ZhibanCourseClassroom[]>([]);
  const [filters, setFilters] = useState({
    academicYear: '',
    termName: '',
    offeringStatus: '',
    department: '',
    learningCenter: '',
  });
  useEffect(() => {
    void fetch('/api/zhiban/classrooms')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setClassrooms(body.classrooms);
      })
      .catch((error) => toast.error(error.message));
  }, []);
  const visible = useMemo(
    () =>
      classrooms.filter((item) =>
        Object.entries(filters).every(
          ([key, value]) => !value || String(item[key as keyof ZhibanCourseClassroom]) === value,
        ),
      ),
    [classrooms, filters],
  );
  const options = (key: keyof typeof filters) =>
    [...new Set(classrooms.map((item) => String(item[key] ?? '')).filter(Boolean))].sort();
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      {!hideHeader && (
        <header className="mb-6 flex items-center justify-between rounded-2xl bg-slate-950 p-6 text-white">
          <div>
            <p className="text-sm text-teal-300">智伴·创学</p>
            <h1 className="text-2xl font-semibold">我的课程课堂</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link href="/zhiban/student/risks">学习支持</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/zhiban/student/grades">测评与成绩</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/zhiban/student/profile">
                <BarChart3 className="mr-2 size-4" />
                学习画像
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/zhiban/student/pbl">
                <FolderKanban className="mr-2 size-4" />
                PBL 项目
              </Link>
            </Button>
            <ZhibanLogoutButton />
          </div>
        </header>
      )}
      <section className="mb-6 grid gap-4 border bg-white p-5 sm:grid-cols-2 xl:grid-cols-5">
        <CourseFilter
          label="学年"
          value={filters.academicYear}
          options={options('academicYear')}
          onChange={(value) => setFilters({ ...filters, academicYear: value })}
        />
        <CourseFilter
          label="学期"
          value={filters.termName}
          options={options('termName')}
          onChange={(value) => setFilters({ ...filters, termName: value })}
        />
        <CourseFilter
          label="课程状态"
          value={filters.offeringStatus}
          options={options('offeringStatus')}
          onChange={(value) => setFilters({ ...filters, offeringStatus: value })}
        />
        <CourseFilter
          label="学院"
          value={filters.department}
          options={options('department')}
          onChange={(value) => setFilters({ ...filters, department: value })}
        />
        <CourseFilter
          label="学习中心"
          value={filters.learningCenter}
          options={options('learningCenter')}
          onChange={(value) => setFilters({ ...filters, learningCenter: value })}
        />
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        {visible.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen />
                {item.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-500">
                {item.courseName}（{item.courseCode}）
              </p>
              <p className="mt-3">{item.description || 'OpenMAIC 互动课堂'}</p>
              <div className="mt-4 h-2 overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-teal-500" style={{ width: `${item.progressPercent}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm">学习进度 {item.progressPercent}%</span>
                <Button asChild>
                  <Link href={`/zhiban/student/classroom/${item.id}`}>
                    <Play className="mr-2 size-4" />
                    {item.sessionId ? '继续课堂' : '进入课堂'}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {classrooms.length > 0 && visible.length === 0 && (
          <p className="text-slate-500">没有符合当前筛选条件的课程课堂。</p>
        )}
        {!classrooms.length && <p className="text-slate-500">当前没有已开放的课堂。</p>}
      </div>
    </main>
  );
}

function CourseFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="shrink-0">{label}</span>
      <select
        className="h-9 min-w-0 flex-1 rounded border bg-white px-3"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">全部</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {statusLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function statusLabel(value: string) {
  return (
    (
      {
        planned: '未开始',
        open: '开放选课',
        in_progress: '进行中',
        completed: '已结束',
        cancelled: '已取消',
      } as Record<string, string>
    )[value] ?? value
  );
}
