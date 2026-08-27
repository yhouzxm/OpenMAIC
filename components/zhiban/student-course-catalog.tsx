'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ZhibanCourseClassroom } from '@/lib/zhiban/classroom';
import { MECHATRONICS_COURSE_CODE } from '@/lib/zhiban/mechatronics-course.constants';

type FilterKey = 'academicYear' | 'termName' | 'offeringStatus' | 'department' | 'learningCenter';
const emptyFilters: Record<FilterKey, string> = {
  academicYear: '',
  termName: '',
  offeringStatus: '',
  department: '',
  learningCenter: '',
};

export function StudentCourseCatalog({ courseId = '' }: { courseId?: string }) {
  const [classrooms, setClassrooms] = useState<ZhibanCourseClassroom[]>([]);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  useEffect(() => {
    void fetch('/api/zhiban/classrooms')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '课程加载失败');
        setClassrooms(body.classrooms);
      })
      .catch((error) => toast.error(error.message));
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return classrooms.filter(
      (item) =>
        (!courseId || item.courseId === courseId) &&
        (!keyword || `${item.courseName} ${item.courseCode}`.toLowerCase().includes(keyword)) &&
        Object.entries(filters).every(
          ([key, value]) => !value || String(item[key as FilterKey] ?? '') === value,
        ),
    );
  }, [classrooms, courseId, filters, query]);
  const courses = useMemo(() => {
    const grouped = new Map<string, ZhibanCourseClassroom[]>();
    for (const item of filtered)
      grouped.set(item.courseId, [...(grouped.get(item.courseId) ?? []), item]);
    return [...grouped.values()];
  }, [filtered]);
  const allOptions = (key: FilterKey) =>
    [...new Set(classrooms.map((item) => String(item[key] ?? '')).filter(Boolean))].sort();

  if (courseId) {
    const first = filtered[0] ?? classrooms.find((item) => item.courseId === courseId);
    return (
      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b bg-white p-5">
          <div>
            <h1 className="text-xl font-semibold">{first?.courseName ?? '课程学习工作区'}</h1>
            <p className="mt-1 text-sm text-slate-500">
              课程代码：{first?.courseCode ?? '—'} · 学期：{first?.termName || '未设置'}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/zhiban/student/classrooms">
              <ArrowLeft className="mr-2 size-4" />
              返回我的课程
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-8">
      <section className="mb-3 flex flex-wrap items-center justify-between gap-4 border bg-white p-5">
        <div>
          <h1 className="text-xl font-semibold">我的课程</h1>
          <p className="mt-1 text-sm text-slate-500">选择课程进入学习工作区</p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
          <Input
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="课程名称 / 课程代码"
          />
        </div>
      </section>
      <section className="mb-6 grid gap-4 border bg-white p-5 sm:grid-cols-2 xl:grid-cols-5">
        <Filter
          label="学年"
          value={filters.academicYear}
          options={allOptions('academicYear')}
          onChange={(value) => setFilters({ ...filters, academicYear: value })}
        />
        <Filter
          label="学期"
          value={filters.termName}
          options={allOptions('termName')}
          onChange={(value) => setFilters({ ...filters, termName: value })}
        />
        <Filter
          label="课程状态"
          value={filters.offeringStatus}
          options={allOptions('offeringStatus')}
          onChange={(value) => setFilters({ ...filters, offeringStatus: value })}
        />
        <Filter
          label="学院"
          value={filters.department}
          options={allOptions('department')}
          onChange={(value) => setFilters({ ...filters, department: value })}
        />
        <Filter
          label="学习中心"
          value={filters.learningCenter}
          options={allOptions('learningCenter')}
          onChange={(value) => setFilters({ ...filters, learningCenter: value })}
        />
      </section>
      <section className="space-y-3">
        {courses.map((items) => {
          const course = items[0];
          const progress = course.progressPercent;
          return (
            <Link
              key={course.courseId}
              href={`/zhiban/student/courses/${course.courseId}`}
              className="group flex flex-col gap-4 border bg-white p-5 transition hover:border-blue-300 hover:shadow-sm sm:flex-row sm:items-center"
            >
              <div className="hidden h-24 w-36 shrink-0 items-center justify-center rounded bg-gradient-to-br from-blue-500 to-indigo-700 text-white sm:flex">
                <BookOpen className="size-10" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-medium text-[#0868db] group-hover:underline">
                    {course.courseName}
                  </h2>
                  <Badge
                    className={
                      course.courseCode === MECHATRONICS_COURSE_CODE
                        ? 'bg-cyan-700'
                        : course.pblEnabled === null
                          ? 'bg-slate-500'
                          : 'bg-[#1677e8]'
                    }
                  >
                    {course.courseCode === MECHATRONICS_COURSE_CODE
                      ? '智能诊断学习中心'
                      : course.pblEnabled === null
                        ? '未配置'
                        : course.pblEnabled
                          ? 'PBL'
                          : '开放课堂'}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-slate-500">课程代码：{course.courseCode}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {course.academicYear || '未设置学年'} · {course.termName || '未设置学期'}
                </p>
              </div>
              <div className="w-full shrink-0 sm:w-48">
                <div className="h-2 overflow-hidden rounded bg-slate-200">
                  <div className="h-full bg-[#1677e8]" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-2 text-sm">完成度：{progress}%</p>
              </div>
              <span className="shrink-0 text-sm text-[#1677e8]">进入学生工作区 →</span>
            </Link>
          );
        })}
        {!courses.length && (
          <div className="border bg-white p-16 text-center text-slate-500">
            没有符合条件的课程。
          </div>
        )}
      </section>
    </main>
  );
}

function Filter({
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
    ((
      {
        planned: '未开始',
        open: '开放选课',
        in_progress: '进行中',
        completed: '已结束',
        cancelled: '已取消',
      } as Record<string, string>
    )[value] ??
      value) ||
    '进行中'
  );
}
