'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, BookOpen, FolderKanban, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ZhibanCourseClassroom } from '@/lib/zhiban/classroom';
import { ZhibanLogoutButton } from './logout-button';

export function StudentClassroomConsole() {
  const [classrooms, setClassrooms] = useState<ZhibanCourseClassroom[]>([]);
  useEffect(() => {
    void fetch('/api/zhiban/classrooms')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setClassrooms(body.classrooms);
      })
      .catch((error) => toast.error(error.message));
  }, []);
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex items-center justify-between rounded-2xl bg-slate-950 p-6 text-white">
        <div>
          <p className="text-sm text-teal-300">智伴·创学</p>
          <h1 className="text-2xl font-semibold">我的课程课堂</h1>
        </div>
        <div className="flex gap-2">
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
      <div className="grid gap-4 md:grid-cols-2">
        {classrooms.map((item) => (
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
        {!classrooms.length && <p className="text-slate-500">当前没有已开放的课堂。</p>}
      </div>
    </main>
  );
}
