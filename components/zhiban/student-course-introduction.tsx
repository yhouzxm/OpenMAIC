'use client';

import { useEffect, useState } from 'react';
import { Download, Printer, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type Teacher = { id: string; name: string; role: string };
type Overview = {
  code: string;
  name: string;
  description: string;
  course_type: string;
  term_name: string;
  starts_on: string;
  ends_on: string;
  teachers: Teacher[];
};

export function StudentCourseIntroduction({ courseId }: { courseId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  useEffect(() => {
    void fetch(`/api/zhiban/student/courses/${courseId}/overview`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '课程简介加载失败');
        setOverview(body.overview);
      })
      .catch((error) => toast.error(error.message));
  }, [courseId]);
  if (!overview) return <section className="border bg-white p-8 text-center text-slate-500">正在加载课程简介…</section>;
  const download = () => {
    const teacherText = overview.teachers.map((teacher) => `${teacher.name}（${teacher.role}）`).join('、') || '未设置';
    const content = `课程名称：${overview.name}\n课程代码：${overview.code}\n开始日期：${date(overview.starts_on)}\n结束日期：${date(overview.ends_on)}\n学年期：${overview.term_name}\n课程类型：${overview.course_type}\n授课教师：${teacherText}\n\n课程简介：\n${overview.description || '暂无课程简介'}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    link.download = `${overview.name}-课程简介.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <section className="mx-auto max-w-6xl border bg-white p-4 sm:p-6 print:border-0">
      <div className="mb-7 flex gap-3 print:hidden">
        <Button variant="outline" onClick={download}><Download className="mr-2 size-4" />下载</Button>
        <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 size-4" />打印</Button>
      </div>
      <dl className="grid gap-x-10 gap-y-5 text-sm md:grid-cols-2 xl:grid-cols-3">
        <Info label="课程名称" value={overview.name} />
        <Info label="开始日期" value={date(overview.starts_on)} />
        <Info label="课程类型" value={overview.course_type || '一般课程'} />
        <Info label="课程代码" value={overview.code} />
        <Info label="学年期" value={overview.term_name} />
        <Info label="结束日期" value={date(overview.ends_on)} />
      </dl>
      <div className="mt-9">
        <h3 className="mb-4 text-sm font-semibold">授课教师</h3>
        <div className="flex flex-wrap gap-6">
          {overview.teachers.map((teacher) => <div key={`${teacher.id}:${teacher.role}`} className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-full border-2 border-blue-600 bg-blue-50 text-blue-600"><UserRound className="size-6" /></span><span><b className="block text-sm">{teacher.name}</b><small className="text-slate-500">{teacher.role}</small></span></div>)}
          {!overview.teachers.length && <p className="text-sm text-slate-500">暂未设置授课教师</p>}
        </div>
      </div>
      <div className="mt-9 border-t pt-5"><h3 className="font-semibold">课程简介</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{overview.description || '暂无课程简介。'}</p></div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[5rem_1fr] gap-2"><dt className="font-semibold">{label}</dt><dd className="min-w-0 break-words">{value || '—'}</dd></div>;
}
function date(value: string) { return value ? new Date(value).toLocaleDateString('zh-CN') : '—'; }
