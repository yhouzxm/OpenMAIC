'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TeacherCourse } from '@/lib/zhiban/teacher-courses';
type Row = Record<string, unknown>;
async function api<T>(u: string, i?: RequestInit) {
  const r = await fetch(u, i),
    b = await r.json();
  if (!r.ok) throw new Error(b.error ?? '请求失败');
  return b as T;
}
export function TeacherRiskConsole() {
  const [courses, setCourses] = useState<TeacherCourse[]>([]),
    [courseId, setCourseId] = useState(''),
    [data, setData] = useState<{
      cases: Row[];
      heatmap: Row[];
      control?: Row;
      requests?: Row[];
      metrics?: Row;
      notifications?: Row[];
    }>({ cases: [], heatmap: [] }),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const load = useCallback(async () => {
    if (courseId) setData(await api(`/api/zhiban/teacher/courses/${courseId}/risks`));
  }, [courseId]);
  useEffect(() => {
    void api<{ courses: TeacherCourse[] }>('/api/zhiban/teacher/courses')
      .then((r) => {
        setCourses(r.courses);
        const requested = new URLSearchParams(window.location.search).get('courseId');
        setCourseId(
          r.courses.some((course) => course.id === requested)
            ? requested!
            : (r.courses[0]?.id ?? ''),
        );
      })
      .catch((e) => toast.error(e.message));
  }, []);
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, [load]);
  async function action(body: unknown, msg: string) {
    setBusy(true);
    try {
      await api(`/api/zhiban/teacher/courses/${courseId}/risks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast.success(msg);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  const active = data.cases.filter((c) => !['resolved', 'dismissed'].includes(String(c.status))),
    level3 = active.filter((c) => Number(c.severity) === 3),
    overdue = active.filter((c) => new Date(String(c.sla_due_at)) < new Date());
  return (
    <main className="min-h-screen bg-slate-100 p-5">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-950 p-6 text-white">
          <div>
            <h1 className="text-2xl font-semibold">风险预警与教学干预</h1>
            <p className="text-sm text-slate-300">
              学习支持风险，不用于心理诊断；三级预警必须由教师处置
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <a href={`/api/zhiban/teacher/courses/${courseId}/risks/export`}>去标识化导出</a>
            </Button>
            <Button asChild className="bg-white text-slate-900">
              <Link href="/zhiban/teacher/courses">返回课程</Link>
            </Button>
          </div>
        </header>
        <Card>
          <CardContent className="flex flex-wrap gap-3 pt-5">
            <select
              className="h-10 min-w-72 rounded border bg-white px-3"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button
              disabled={busy}
              onClick={() => void action({ action: 'evaluate' }, '全班风险评估已完成')}
            >
              立即评估全班
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>风险运行控制</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">模式：{String(data.control?.mode ?? 'active')}</Badge>
            <Badge variant="outline">
              自动干预：{data.control?.automatic_intervention_enabled ? '开启' : '关闭'}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void action(
                  { action: 'control', mode: 'shadow', automatic: false, emergencyStop: false },
                  '已切换影子模式',
                )
              }
            >
              影子模式
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void action(
                  { action: 'control', mode: 'active', automatic: true, emergencyStop: false },
                  '已启用受控自动干预',
                )
              }
            >
              启用自动干预
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                void action(
                  { action: 'control', mode: 'off', automatic: false, emergencyStop: true },
                  '紧急停用已生效',
                )
              }
            >
              紧急停用
            </Button>
          </CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['待处理', active.length, 'text-amber-700'],
            ['三级预警', level3.length, 'text-red-700'],
            ['SLA超时', overdue.length, 'text-orange-700'],
          ].map(([n, v, c]) => (
            <Card key={n}>
              <CardHeader>
                <CardTitle className="text-sm text-slate-600">{n}</CardTitle>
              </CardHeader>
              <CardContent className={`text-3xl font-semibold ${c}`}>{v}</CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>风险通知</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.notifications?.slice(0, 10).map((notification) => (
              <div key={String(notification.id)} className="rounded border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{String(notification.title ?? '风险处置提醒')}</b>
                  <Badge variant={notification.read_at ? 'outline' : 'destructive'}>
                    {notification.read_at ? '已读' : '待处理'}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-slate-600">{String(notification.message ?? '')}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {notification.created_at
                    ? new Date(String(notification.created_at)).toLocaleString()
                    : ''}
                </p>
              </div>
            ))}
            {!data.notifications?.length && (
              <p className="text-sm text-slate-500">暂无风险通知。</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>30天风险热力图</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.heatmap.map((h, i) => (
                <div
                  key={i}
                  title={`${String(h.risk_type)} ${String(h.score)}`}
                  className={`rounded px-2 py-1 text-xs ${Number(h.level) === 3 ? 'bg-red-600 text-white' : Number(h.level) === 2 ? 'bg-orange-400' : Number(h.level) === 1 ? 'bg-amber-200' : 'bg-emerald-100'}`}
                >
                  {new Date(String(h.snapshot_day)).toLocaleDateString()} · {String(h.risk_type)} ·{' '}
                  {String(h.score)}
                </div>
              ))}
              {!data.heatmap.length && <p className="text-sm text-slate-500">暂无风险快照。</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>处置效果统计</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['案例', data.metrics?.total],
              ['误报', data.metrics?.false_positives],
              ['已解决', data.metrics?.resolved],
              ['升级', data.metrics?.escalated],
              ['平均处置小时', data.metrics?.avg_resolution_hours],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded bg-slate-50 p-3 text-center">
                <div className="text-xs text-slate-500">{String(label)}</div>
                <b>{String(value ?? 0)}</b>
              </div>
            ))}
          </CardContent>
        </Card>
        {selected.length > 0 && (
          <Card>
            <CardContent className="flex gap-2 pt-5">
              <span className="text-sm">已选择 {selected.length} 项</span>
              <Button
                size="sm"
                onClick={() =>
                  void action(
                    { action: 'batch', caseIds: selected, batchAction: 'assign', note: '批量分配' },
                    '已批量分配',
                  )
                }
              >
                批量分配
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const note = prompt('请输入批量关闭说明');
                  if (note)
                    void action(
                      { action: 'batch', caseIds: selected, batchAction: 'resolve', note },
                      '已批量关闭',
                    );
                }}
              >
                批量关闭
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  const note = prompt('请输入批量误报原因');
                  if (note)
                    void action(
                      { action: 'batch', caseIds: selected, batchAction: 'dismiss', note },
                      '已批量驳回',
                    );
                }}
              >
                批量误报
              </Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>学生求助、解释与更正请求</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.requests?.map((r) => (
              <div key={String(r.id)} className="rounded border p-3">
                <b>
                  {String(r.display_name || r.login_name)} · {String(r.request_type)}
                </b>
                <p className="text-sm">{String(r.content)}</p>
                <Badge variant="outline">{String(r.status)}</Badge>
                {r.status === 'pending' && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        const response = prompt('请输入回复');
                        if (response)
                          void action(
                            { action: 'request', requestId: r.id, status: 'handled', response },
                            '请求已处理',
                          );
                      }}
                    >
                      处理
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const response = prompt('请输入驳回原因');
                        if (response)
                          void action(
                            { action: 'request', requestId: r.id, status: 'rejected', response },
                            '请求已驳回',
                          );
                      }}
                    >
                      驳回
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {!data.requests?.length && <p className="text-sm text-slate-500">暂无学生请求。</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>教师预警队列</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.cases.map((c) => (
              <article
                key={String(c.id)}
                className={`rounded-lg border-l-4 p-4 shadow-sm ${Number(c.severity) === 3 ? 'border-l-red-600 bg-red-50' : Number(c.severity) === 2 ? 'border-l-orange-500 bg-orange-50' : 'border-l-amber-400 bg-white'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(String(c.id))}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, String(c.id)]
                          : ids.filter((id) => id !== String(c.id)),
                      )
                    }
                  />
                  <b>{String(c.display_name || c.login_name)}</b>
                  <Badge>等级 {String(c.severity)}</Badge>
                  <Badge variant="outline">{String(c.status)}</Badge>
                  <span className="text-xs text-slate-500">
                    分数 {String(c.score)} · 置信度 {(Number(c.confidence) * 100).toFixed(0)}% · SLA{' '}
                    {new Date(String(c.sla_due_at)).toLocaleString()}
                  </span>
                </div>
                <p className="my-2 text-sm">
                  类型：{String(c.risk_type)}；证据：{JSON.stringify(c.evidence)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {c.status === 'new' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void action({ caseId: c.id, action: 'acknowledge' }, '已确认预警')
                      }
                    >
                      确认
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void action({ caseId: c.id, action: 'assign' }, '已分配给我')}
                  >
                    分配给我
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      void action(
                        { caseId: c.id, action: 'takeover' },
                        '教师已接管，智能体干预已停止',
                      )
                    }
                  >
                    教师接管
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void action({ caseId: c.id, action: 'escalate' }, '已升级')}
                  >
                    升级
                  </Button>
                  <Button
                    size="sm"
                    className="bg-teal-700"
                    onClick={() => {
                      const note = prompt('请输入处置结果');
                      if (note)
                        void action({ caseId: c.id, action: 'resolve', note }, '风险案例已关闭');
                    }}
                  >
                    解决并关闭
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      const note = prompt('请输入误报原因');
                      if (note)
                        void action({ caseId: c.id, action: 'dismiss', note }, '已标记误报');
                    }}
                  >
                    误报驳回
                  </Button>
                </div>
              </article>
            ))}
            {!data.cases.length && <p className="text-sm text-slate-500">暂无预警案例。</p>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
