'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Binding = Record<string, unknown>;
type Scene = { id: string; title: string; stationId: string; sceneType: string };
type ResponseData = {
  session: null | { id: string; activeSceneId: string | null; dispatchType: string; status: string; version: number; scene: Scene | null };
  analytics: null | { participants: number; completed: number; completionRate: number; correctRate: number | null; averageDurationMs: number | null; firstChoice: Array<{ value: string; count: number }>; conceptErrors: Array<{ code: string; count: number; percentage: number }> };
  scenes: Scene[];
};

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? '操作失败');
  return body as T;
}

export function TeacherClassroomSceneControl({ courseId, bindings }: { courseId: string; bindings: Binding[] }) {
  const available = useMemo(() => bindings.filter((item) => item.status !== 'archived'), [bindings]);
  const [bindingId, setBindingId] = useState('');
  const [sceneId, setSceneId] = useState('S05-04');
  const [data, setData] = useState<ResponseData>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!available.some((item) => String(item.id) === bindingId)) setBindingId(String(available[0]?.id ?? ''));
  }, [available, bindingId]);
  const endpoint = bindingId ? `/api/zhiban/teacher/courses/${courseId}/classrooms/${bindingId}/scene-session` : '';
  const load = useCallback(async () => {
    if (!endpoint) return;
    setData(await request<ResponseData>(endpoint));
  }, [endpoint]);
  useEffect(() => { void load().catch((error) => toast.error(error.message)); }, [load]);

  async function act(action: 'dispatch' | 'remediate' | 'challenge' | 'virtual_lab' | 'end') {
    if (!endpoint) return;
    setBusy(true);
    try {
      setData(await request<ResponseData>(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'virtual_lab' || action === 'end' ? { action } : { action, sceneId: action === 'challenge' ? (data?.session?.activeSceneId ?? sceneId) : sceneId }),
      }));
      toast.success(action === 'end' ? '本次课堂任务已结束' : '课堂任务已发布');
    } catch (error) { toast.error(error instanceof Error ? error.message : '课堂调度失败'); }
    finally { setBusy(false); }
  }
  const stats = data?.analytics;
  return (
    <Card className="mt-6 border-blue-200">
      <CardHeader><CardTitle>课堂 Scene 调度</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!available.length ? <p className="text-sm text-slate-500">请先绑定并发布一个 OpenMAIC 课堂。</p> : <>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">课堂绑定
              <select className="mt-1 h-10 w-full rounded-md border px-3" value={bindingId} onChange={(e) => setBindingId(e.target.value)}>
                {available.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.title)}</option>)}
              </select>
            </label>
            <label className="text-sm">Scene
              <select className="mt-1 h-10 w-full rounded-md border px-3" value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
                {(data?.scenes ?? []).map((scene) => <option key={scene.id} value={scene.id}>{scene.id} · {scene.title} · {scene.stationId}</option>)}
              </select>
            </label>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            当前：{data?.session ? `${data.session.scene?.title ?? data.session.activeSceneId} · ${data.session.status} · v${data.session.version}` : '尚未发起'}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void act('dispatch')}>发起 Scene</Button>
            <Button disabled={busy} variant="outline" onClick={() => void act('challenge')}>再次挑战</Button>
            <Button disabled={busy} variant="outline" onClick={() => void act('remediate')}>调度补救 Scene</Button>
            <Button disabled={busy} variant="outline" onClick={() => void act('virtual_lab')}>进入综合实训</Button>
            <Button disabled={busy} variant="destructive" onClick={() => void act('end')}>结束当前 Scene</Button>
            <Button disabled={busy} variant="ghost" onClick={() => void load()}>刷新统计</Button>
          </div>
          {stats && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label="参与人数" value={stats.participants} /><Metric label="完成人数" value={stats.completed} />
            <Metric label="完成率" value={`${stats.completionRate}%`} />
            <Metric label="正确率" value={stats.correctRate === null ? '不适用' : `${stats.correctRate}%`} />
            <Metric label="平均用时" value={stats.averageDurationMs === null ? '暂无' : `${Math.round(stats.averageDurationMs / 1000)}秒`} />
          </div>}
          <div>
            <h3 className="text-sm font-semibold">首次选择分布</h3>
            {!stats?.firstChoice.length ? <p className="mt-1 text-sm text-slate-500">当前 Scene 不适用或暂无数据</p> : <div className="mt-2 flex flex-wrap gap-2">{stats.firstChoice.map((item) => <span key={item.value} className="rounded-full border bg-white px-3 py-1 text-sm">{item.value}：{item.count}</span>)}</div>}
          </div>
          <div>
            <h3 className="text-sm font-semibold">高频 Concept Error</h3>
            {!stats?.conceptErrors.length ? <p className="mt-1 text-sm text-slate-500">暂无数据</p> : <ul className="mt-2 grid gap-2 sm:grid-cols-2">{stats.conceptErrors.map((item) => <li key={item.code} className="rounded-md border px-3 py-2 text-sm">{item.code}：{item.count}人（{item.percentage}%）</li>)}</ul>}
          </div>
        </>}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>;
}
