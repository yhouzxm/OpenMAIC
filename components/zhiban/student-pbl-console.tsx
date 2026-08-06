'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, GraduationCap, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { StudentPblProjectSummary, ZhibanPblInstance } from '@/lib/zhiban/pbl';
import { ZhibanLogoutButton } from './logout-button';

export function StudentPblConsole() {
  const [projects, setProjects] = useState<StudentPblProjectSummary[]>([]);
  const [busy, setBusy] = useState('');
  const router = useRouter();
  useEffect(() => {
    void fetch('/api/zhiban/pbl/learning')
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        setProjects(b.projects);
      })
      .catch((e) => toast.error(e.message));
  }, []);
  async function open(project: StudentPblProjectSummary) {
    if (project.instanceId) {
      router.push(`/zhiban/student/pbl/${project.instanceId}`);
      return;
    }
    setBusy(project.id);
    try {
      const response = await fetch('/api/zhiban/pbl/learning', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const instance = body.instance as ZhibanPblInstance;
      router.push(`/zhiban/student/pbl/${instance.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '项目启动失败');
    } finally {
      setBusy('');
    }
  }
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex items-center justify-between rounded-2xl bg-slate-950 p-6 text-white">
        <div>
          <p className="text-sm text-teal-300">智伴·创学</p>
          <h1 className="text-2xl font-semibold">我的 PBL 项目</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild><Link href="/zhiban/student/classrooms"><GraduationCap className="mr-2 size-4" />课程课堂</Link></Button>
          <ZhibanLogoutButton />
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen />
                {p.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-500">{p.courseName}</p>
              <p className="mt-3">{p.description}</p>
              <p className="mt-3 text-sm">
                <b>成果：</b>
                {p.deliverable || '按项目要求完成'}
              </p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm">进度 {p.progressPercent}%</span>
                <Button onClick={() => void open(p)} disabled={busy === p.id}>
                  <Play className="mr-2 size-4" />
                  {p.instanceId ? '继续学习' : busy === p.id ? '启动中…' : '开始项目'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {!projects.length && <p className="text-slate-500">当前没有已开放的 PBL 项目。</p>}
      </div>
    </main>
  );
}
