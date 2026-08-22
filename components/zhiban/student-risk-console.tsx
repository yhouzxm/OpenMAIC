'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
type Row = Record<string, unknown>;
export function StudentRiskConsole({ hideHeader = false, courseId }: { hideHeader?: boolean; courseId?: string }) {
  const [data, setData] = useState<{ risks: Row[]; preferences: Row[]; requests: Row[] }>({
    risks: [],
    preferences: [],
    requests: [],
  });
  const load = useCallback(() =>
    fetch('/api/zhiban/student/risks').then(async (r) => {
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setData(b);
    }), []);
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, [load]);
  async function preference(courseId: unknown, enabled: boolean, pauseDays = 0) {
    const r = await fetch('/api/zhiban/student/risks', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ courseId, enabled, pauseDays }),
    });
    const b = await r.json();
    if (!r.ok) {
      toast.error(b.error);
      return;
    }
    toast.success('学习支持偏好已更新');
    await load();
  }
  async function request(
    courseId: unknown,
    caseId: unknown,
    type: 'help' | 'explanation' | 'correction',
  ) {
    const content = prompt(
      type === 'help'
        ? '请描述你需要的学习帮助'
        : type === 'explanation'
          ? '请填写希望解释的内容'
          : '请说明需要更正的信息',
    );
    if (!content) return;
    const r = await fetch('/api/zhiban/student/risks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ courseId, caseId, type, content }),
    });
    const b = await r.json();
    if (!r.ok) {
      toast.error(b.error);
      return;
    }
    toast.success('请求已提交');
    await load();
  }
  return (
    <main className="min-h-screen bg-slate-100 p-2 sm:p-5">
      <div className="mx-auto max-w-4xl space-y-5">
        {!hideHeader && (
          <header className="flex items-center justify-between rounded-2xl bg-slate-950 p-6 text-white">
            <div>
              <h1 className="text-2xl font-semibold">我的学习支持</h1>
              <p className="text-sm text-slate-300">
                提示仅用于提供学习帮助，不是心理诊断，也不直接影响成绩
              </p>
            </div>
            <Button asChild className="bg-white text-slate-900">
              <Link href="/zhiban/student/classrooms">返回学习</Link>
            </Button>
          </header>
        )}
        {courseId && <h2 className="text-xl font-semibold">本课程学习支持</h2>}
        {data.risks.filter((r) => !courseId || String(r.course_id) === courseId).map((r) => (
          <Card key={`${String(r.course_id)}:${String(r.risk_type)}`}>
            <CardHeader>
              <div className="flex justify-between">
                <CardTitle>{String(r.course_name)}</CardTitle>
                <Badge variant="outline">支持等级 {String(r.level)}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm">系统观察到可能需要学习支持的方面：{String(r.risk_type)}。</p>
              <p className="mt-2 text-xs text-slate-500">
                有效至 {new Date(String(r.expires_at)).toLocaleString()}
                。你可以忽略或暂停主动支持，不会影响课程成绩。
              </p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={() => void request(r.course_id, r.case_id, 'help')}>
                  主动求助
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void request(r.course_id, r.case_id, 'explanation')}
                >
                  申请解释
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void request(r.course_id, r.case_id, 'correction')}
                >
                  申请更正
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void preference(r.course_id, false, 7)}
                >
                  暂停7天
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void preference(r.course_id, false, 30)}
                >
                  暂停30天
                </Button>
                <Button size="sm" onClick={() => void preference(r.course_id, true, 0)}>
                  恢复主动支持
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {!data.risks.filter((r) => !courseId || String(r.course_id) === courseId).length && (
          <Card>
            <CardContent className="p-8 text-center text-slate-500">
              当前没有需要展示的学习支持提示。
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>我的请求</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.requests.filter((r) => !courseId || String(r.course_id) === courseId).map((r) => (
              <div key={String(r.id)} className="rounded border p-3 text-sm">
                <p>{String(r.content)}</p>
                <Badge variant="outline">{String(r.status)}</Badge>
                {Boolean(r.response) && (
                  <p className="mt-1 text-slate-600">教师回复：{String(r.response)}</p>
                )}
              </div>
            ))}
            {!data.requests.filter((r) => !courseId || String(r.course_id) === courseId).length && <p className="text-sm text-slate-500">暂无请求。</p>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
