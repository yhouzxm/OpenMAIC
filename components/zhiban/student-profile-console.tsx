'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Eye, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ZhibanLogoutButton } from './logout-button';
type Row = Record<string, unknown>;
const labels: Record<string, string> = {
  engagement: '学习投入',
  completion: '学习完成',
  achievement: '学习表现',
  collaboration: '协作参与',
  selfDirection: '自主学习',
};
export function StudentProfileConsole() {
  const [rows, setRows] = useState<Row[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [reason, setReason] = useState('');
  const load = () =>
    fetch('/api/zhiban/profile').then(async (r) => {
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setRows(b.profiles);
    });
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, []);
  async function rebuild(courseId: unknown) {
    try {
      const r = await fetch('/api/zhiban/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseId }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      toast.success('学习画像已更新');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新失败');
    }
  }
  async function openDetail(courseId: unknown) {
    try {
      const id = String(courseId);
      const r = await fetch(`/api/zhiban/profile/${id}`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setSelectedCourseId(id);
      setDetail(b);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载证据失败');
    }
  }
  async function updatePreference(collectionEnabled: boolean, retentionDays: number) {
    const r = await fetch(`/api/zhiban/profile/${selectedCourseId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ collectionEnabled, retentionDays }),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    toast.success(collectionEnabled ? '已恢复画像采集' : '已暂停画像采集');
    await openDetail(selectedCourseId);
  }
  async function requestCorrection() {
    try {
      const r = await fetch(`/api/zhiban/profile/${selectedCourseId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setReason('');
      toast.success('更正申请已提交');
      await openDetail(selectedCourseId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '提交失败');
    }
  }
  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex justify-between rounded-2xl bg-slate-950 p-6 text-white">
        <div>
          <p className="text-teal-300">阶段 8 · 可解释学习画像</p>
          <h1 className="text-2xl font-semibold">我的学习画像</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link href="/zhiban/student/classrooms">
              <ArrowLeft className="mr-2 size-4" />
              课程课堂
            </Link>
          </Button>
          <ZhibanLogoutButton />
        </div>
      </header>
      <p className="mb-5 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
        画像基于课堂与 PBL 学习证据计算，仅用于学习支持，不是心理或能力诊断。
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((row) => (
          <Card key={String(row.course_id)}>
            <CardHeader>
              <CardTitle className="flex justify-between">
                {String(row.course_name)}
                <Button size="sm" variant="outline" onClick={() => void rebuild(row.course_id)}>
                  <RefreshCw className="mr-1 size-3" />
                  重算
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Dimensions value={row.dimensions} />
              <p className="mt-3 text-xs text-slate-500">
                证据事件 {String(row.event_count)} 条 · 算法 {String(row.algorithm_version)} · 版本{' '}
                {String(row.profile_version)}
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() => void openDetail(row.course_id)}
              >
                <Eye className="mr-1 size-3" />
                证据与历史
              </Button>
            </CardContent>
          </Card>
        ))}
        {!rows.length && (
          <p className="text-slate-500">
            画像尚未生成。进入课程学习后，可由教师批量生成或在课程入口触发生成。
          </p>
        )}
      </div>
      {detail && (
        <section
          className="mt-6 space-y-4 rounded-2xl border bg-white p-5"
          data-testid="profile-detail"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">画像证据、历史与数据控制</h2>
            <Button variant="outline" asChild>
              <a href={`/api/zhiban/profile/${selectedCourseId}/export`}>
                <Download className="mr-2 size-4" />
                导出我的数据
              </a>
            </Button>
          </div>
          <PreferencePanel
            key={String(((detail.preference ?? {}) as Row).changed_at ?? selectedCourseId)}
            value={detail.preference}
            onSave={updatePreference}
          />
          <div>
            <h3 className="mb-2 font-medium">历史版本</h3>
            <div className="flex gap-2 overflow-x-auto">
              {asRows(detail.snapshots).map((snapshot) => (
                <div
                  key={String(snapshot.profile_version)}
                  className="min-w-36 rounded border p-2 text-sm"
                >
                  v{String(snapshot.profile_version)}
                  <br />
                  事件 {String(snapshot.event_count)}
                  <br />
                  {formatTime(snapshot.computed_at)}
                </div>
              ))}
              {!asRows(detail.snapshots).length && (
                <span className="text-sm text-slate-500">暂无历史版本</span>
              )}
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-medium">最近学习证据</h3>
            <div className="max-h-72 overflow-auto rounded border">
              {asRows(detail.events).map((event) => (
                <div key={String(event.id)} className="border-b p-3 text-sm">
                  <b>{String(event.event_type)}</b> · {String(event.source_kind)}
                  <span className="float-right text-slate-500">
                    {formatTime(event.occurred_at)}
                  </span>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                    {JSON.stringify(event.payload)}
                  </pre>
                </div>
              ))}
              {!asRows(detail.events).length && (
                <p className="p-3 text-sm text-slate-500">暂无可用证据</p>
              )}
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-medium">申请数据更正</h3>
            <textarea
              className="min-h-20 w-full rounded border p-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="说明哪条证据或画像结果需要复核（至少5个字）"
            />
            <Button
              className="mt-2"
              disabled={reason.trim().length < 5}
              onClick={() => void requestCorrection()}
            >
              提交更正申请
            </Button>
            <div className="mt-3 space-y-1 text-sm">
              {asRows(detail.corrections).map((item) => (
                <p key={String(item.id)}>
                  {String(item.reason)} · <b>{String(item.status)}</b>
                  {item.resolution ? ` · ${String(item.resolution)}` : ''}
                </p>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}
function formatTime(value: unknown) {
  return value ? new Date(String(value)).toLocaleString('zh-CN') : '-';
}
function PreferencePanel({
  value,
  onSave,
}: {
  value: unknown;
  onSave: (enabled: boolean, days: number) => Promise<void>;
}) {
  const row = (value ?? {}) as Row;
  const [days, setDays] = useState(Number(row.retention_days ?? 730));
  const enabled = row.collection_enabled !== false;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded bg-slate-50 p-3 text-sm">
      <b>数据采集：{enabled ? '已启用' : '已暂停'}</b>
      <Button size="sm" variant="outline" onClick={() => void onSave(!enabled, days)}>
        {enabled ? '暂停采集' : '恢复采集'}
      </Button>
      <label>
        保留天数{' '}
        <input
          className="ml-1 w-24 rounded border p-1"
          type="number"
          min={30}
          max={3650}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
      </label>
      <Button size="sm" variant="outline" onClick={() => void onSave(enabled, days)}>
        保存保留期
      </Button>
      <span className="text-slate-500">暂停不会删除既有证据，可通过保留期管理。</span>
    </div>
  );
}
export function Dimensions({ value }: { value: unknown }) {
  const d = (value ?? {}) as Record<string, unknown>;
  return (
    <div className="space-y-3">
      {Object.entries(labels).map(([key, label]) => (
        <div key={key}>
          <div className="flex justify-between text-sm">
            <span>{label}</span>
            <b>{Number(d[key] ?? 0)}</b>
          </div>
          <div className="h-2 rounded bg-slate-200">
            <div
              className="h-full rounded bg-teal-500"
              style={{ width: `${Number(d[key] ?? 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
