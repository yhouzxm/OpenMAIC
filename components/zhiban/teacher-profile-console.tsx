'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TeacherCourse } from '@/lib/zhiban/teacher-courses';
import { Dimensions } from './student-profile-console';
import { ZhibanLogoutButton } from './logout-button';
type Row = Record<string, unknown>;
async function api<T>(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const b = await r.json();
  if (!r.ok) throw new Error(b.error);
  return b as T;
}
export function TeacherProfileConsole() {
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [courseId, setCourseId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const [selectedLearnerId, setSelectedLearnerId] = useState('');
  useEffect(() => {
    void api<{ courses: TeacherCourse[] }>('/api/zhiban/teacher/courses')
      .then((d) => {
        setCourses(d.courses);
        setCourseId(d.courses[0]?.id ?? '');
      })
      .catch((e) => toast.error(e.message));
  }, []);
  const load = useCallback(async () => {
    if (!courseId) return;
    setRows(
      (await api<{ profiles: Row[] }>(`/api/zhiban/teacher/courses/${courseId}/profiles`)).profiles,
    );
  }, [courseId]);
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, [load]);
  async function rebuild() {
    setBusy(true);
    try {
      const result = await api<{ rebuilt: number }>(
        `/api/zhiban/teacher/courses/${courseId}/profiles`,
        { method: 'POST' },
      );
      toast.success(`已重算 ${result.rebuilt} 名学生画像`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重算失败');
    } finally {
      setBusy(false);
    }
  }
  async function inspect(learnerId: unknown) {
    try {
      const id = String(learnerId);
      setSelectedLearnerId(id);
      setDetail(await api<Row>(`/api/zhiban/teacher/courses/${courseId}/profiles/${id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载证据失败');
    }
  }
  async function resolve(correctionId: unknown, status: 'accepted' | 'rejected') {
    const resolution = window.prompt(
      status === 'accepted' ? '请输入接受及处理说明' : '请输入驳回原因',
    );
    if (!resolution?.trim()) return;
    try {
      await api(
        `/api/zhiban/teacher/courses/${courseId}/profiles/corrections/${String(correctionId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status, resolution }),
        },
      );
      toast.success('更正申请已处理');
      await inspect(selectedLearnerId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '处理失败');
    }
  }
  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6 flex justify-between rounded-2xl bg-slate-950 p-6 text-white">
        <div>
          <p className="text-teal-300">阶段 8 · 学习画像</p>
          <h1 className="text-2xl font-semibold">课程学习画像</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link href="/zhiban/teacher/courses">
              <ArrowLeft className="mr-2 size-4" />
              课程设置
            </Link>
          </Button>
          <ZhibanLogoutButton />
        </div>
      </header>
      <div className="mb-5 flex gap-3">
        <select
          className="h-10 flex-1 rounded-md border px-3"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}（{c.code}）
            </option>
          ))}
        </select>
        <Button onClick={() => void rebuild()} disabled={busy || !courseId}>
          <RefreshCw className="mr-2 size-4" />
          批量重算
        </Button>
      </div>
      <p className="mb-5 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
        画像为规则化学习证据摘要，不用于心理诊断或自动处分；教师应结合原始证据解释。
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <Card key={String(row.learner_id)}>
            <CardHeader>
              <CardTitle>
                {String(row.display_name)}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {String(row.login_name)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {row.dimensions ? (
                <Dimensions value={row.dimensions} />
              ) : (
                <p className="text-sm text-slate-500">尚未生成画像</p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                事件 {String(row.event_count ?? 0)} · {String(row.algorithm_version ?? '待计算')} ·
                v{String(row.profile_version ?? 0)}
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() => void inspect(row.learner_id)}
              >
                <Eye className="mr-1 size-3" />
                查看证据与申请
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {detail && (
        <section
          className="mt-6 space-y-4 rounded-2xl border bg-white p-5"
          data-testid="teacher-profile-detail"
        >
          <h2 className="text-xl font-semibold">学生画像证据与治理记录</h2>
          <p className="text-sm text-slate-600">
            采集状态：
            {((detail.preference ?? {}) as Row).collection_enabled === false
              ? '已由学生暂停'
              : '启用'}
            ；保留期 {String(((detail.preference ?? {}) as Row).retention_days ?? 730)} 天
          </p>
          <div>
            <h3 className="mb-2 font-medium">版本趋势</h3>
            <div className="flex gap-2 overflow-x-auto">
              {rowsOf(detail.snapshots).map((item) => (
                <div
                  key={String(item.profile_version)}
                  className="min-w-36 rounded border p-2 text-sm"
                >
                  v{String(item.profile_version)} · {String(item.event_count)}条<br />
                  {time(item.computed_at)}
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-medium">最近证据</h3>
            <div className="max-h-64 overflow-auto rounded border">
              {rowsOf(detail.events).map((event) => (
                <div key={String(event.id)} className="border-b p-2 text-sm">
                  <b>{String(event.event_type)}</b> · {String(event.source_kind)}
                  <span className="float-right text-slate-500">{time(event.occurred_at)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-medium">待处理更正申请</h3>
            {rowsOf(detail.corrections).map((item) => (
              <div key={String(item.id)} className="mb-2 rounded border p-3 text-sm">
                <p>
                  {String(item.reason)} · <b>{String(item.status)}</b>
                </p>
                {item.status === 'pending' && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => void resolve(item.id, 'accepted')}>
                      接受
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void resolve(item.id, 'rejected')}
                    >
                      驳回
                    </Button>
                  </div>
                )}
                {item.resolution ? (
                  <p className="mt-1 text-slate-500">处理说明：{String(item.resolution)}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}
function time(value: unknown) {
  return value ? new Date(String(value)).toLocaleString('zh-CN') : '-';
}
