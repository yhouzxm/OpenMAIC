'use client';
/* eslint-disable react-hooks/set-state-in-effect -- the async dashboard loader synchronizes remote state */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CoursePeerConfig } from '@/lib/zhiban/peer';
type Dashboard = {
  config: CoursePeerConfig;
  usage: Record<string, number>;
  issues: Array<Record<string, unknown>>;
};
export function TeacherCoursePeer({ courseId }: { courseId: string }) {
  const [data, setData] = useState<Dashboard | null>(null),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/zhiban/teacher/courses/${courseId}/peer`),
      body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Peer 配置加载失败');
    setData(body);
  }, [courseId]);
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, [load]);
  if (!data)
    return (
      <section className="border bg-white p-5 text-sm text-slate-500">正在加载课程 Peer……</section>
    );
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    void fetch(`/api/zhiban/teacher/courses/${courseId}/peer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: form.get('enabled') === 'on',
        displayName: form.get('displayName'),
        welcomeMessage: form.get('welcomeMessage'),
        systemPrompt: form.get('systemPrompt'),
        proactiveEnabled: form.get('proactiveEnabled') === 'on',
        emotionCheckEnabled: form.get('emotionCheckEnabled') === 'on',
        cooldownMinutes: Number(form.get('cooldownMinutes')),
        maxTurns: Number(form.get('maxTurns')),
        status: form.get('status'),
      }),
    })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? '保存失败');
        toast.success('课程 Peer 配置已保存');
        await load();
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setBusy(false));
  };
  const c = data.config;
  return (
    <section className="space-y-5 border bg-white p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h2 className="text-lg font-semibold">课程级 Peer 陪伴</h2>
          <p className="text-sm text-slate-500">
            共情、鼓励和微行动建议；危机表达固定升级给教师，不由模型自由处置
          </p>
        </div>
        <div className="ml-auto flex gap-4 text-xs text-slate-600">
          <span>会话 {data.usage.session_count ?? 0}</span>
          <span>回应 {data.usage.reply_count ?? 0}</span>
          <span>升级 {data.usage.escalated_count ?? 0}</span>
          <span>失败 {data.usage.failure_count ?? 0}</span>
        </div>
      </div>
      <form onSubmit={save} className="grid gap-3 rounded border p-4 md:grid-cols-3">
        <label className="text-sm">
          显示名称
          <Input name="displayName" defaultValue={c.displayName} required />
        </label>
        <label className="text-sm">
          冷却时间（分钟）
          <Input
            name="cooldownMinutes"
            type="number"
            min="10"
            max="10080"
            defaultValue={c.cooldownMinutes}
          />
        </label>
        <label className="text-sm">
          单次最多轮数
          <Input name="maxTurns" type="number" min="2" max="30" defaultValue={c.maxTurns} />
        </label>
        <label className="text-sm md:col-span-3">
          欢迎语
          <textarea
            name="welcomeMessage"
            defaultValue={c.welcomeMessage}
            className="mt-1 min-h-20 w-full rounded border p-3"
          />
        </label>
        <label className="text-sm md:col-span-3">
          课程补充边界与语气
          <textarea
            name="systemPrompt"
            defaultValue={c.systemPrompt}
            className="mt-1 min-h-24 w-full rounded border p-3"
            placeholder="例如：避免催促；使用成人学习者熟悉的表达"
          />
        </label>
        <select name="status" defaultValue={c.status} className="h-10 rounded border px-3 text-sm">
          <option value="draft">草稿</option>
          <option value="published">发布给学生</option>
          <option value="disabled">停用</option>
        </select>
        <div className="flex flex-wrap items-center gap-4 text-sm md:col-span-2">
          <label>
            <input name="enabled" type="checkbox" defaultChecked={c.enabled} /> 启用
          </label>
          <label>
            <input name="proactiveEnabled" type="checkbox" defaultChecked={c.proactiveEnabled} />{' '}
            允许 Monitor 触发
          </label>
          <label>
            <input
              name="emotionCheckEnabled"
              type="checkbox"
              defaultChecked={c.emotionCheckEnabled}
            />{' '}
            情绪与危机词检查
          </label>
        </div>
        <Button disabled={busy}>保存 Peer 配置</Button>
      </form>
      <div className="rounded border p-4">
        <h3 className="font-semibold">需要教师关注</h3>
        {data.issues.length ? (
          <div className="mt-3 max-h-64 divide-y overflow-y-auto">
            {data.issues.map((issue) => (
              <div key={String(issue.id)} className="py-2 text-sm">
                <p className="line-clamp-2">{String(issue.content)}</p>
                <p className="text-xs text-slate-500">
                  {String(issue.student_name)} · {String(issue.emotion_label)} ·{' '}
                  {String(issue.status)}
                  {issue.comment ? ` · ${String(issue.comment)}` : ''}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">暂无危机升级、失败或负面反馈。</p>
        )}
      </div>
    </section>
  );
}
