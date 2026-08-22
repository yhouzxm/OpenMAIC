'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Archive, CheckCircle2, Download, Lightbulb, RefreshCw, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
type Row = Record<string, unknown>;
type Data = {
  summary: Row;
  activities: Row[];
  trend: Row[];
  effectiveness: Row;
  recommendations: Array<{ level: string; title: string; evidence: string; actionType: string }>;
  actions: Row[];
  snapshots: Row[];
  learners: Row[];
  modules: Row[];
  activityTypes: Row[];
  comparison: Row[] | null;
  dataQuality: { sampleSize: number; updatedAt: string; warnings: string[] };
};
export function TeacherTeachingAnalytics({ courseId }: { courseId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      fetch(`/api/zhiban/teacher/courses/${courseId}/analytics`).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        setData(b);
      }),
    [courseId],
  );
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, [load]);
  async function post(body: Row, message: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/zhiban/teacher/courses/${courseId}/analytics`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      toast.success(message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await post(
      {
        action: 'create_action',
        title: f.get('title'),
        evidence: f.get('evidence'),
        hypothesis: f.get('hypothesis'),
        actionType: f.get('actionType'),
        priority: f.get('priority'),
        targetMetric: f.get('targetMetric'),
        targetValue: f.get('targetValue') ? Number(f.get('targetValue')) : undefined,
      },
      '改进任务已建立',
    );
    e.currentTarget.reset();
  }
  if (!data)
    return <div className="border bg-white p-10 text-center text-slate-500">正在生成教学分析…</div>;
  const s = data.summary,
    max = Math.max(...data.trend.map((x) => Number(x.event_count)), 1);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">教学分析与持续优化</h2>
          <p className="text-sm text-slate-500">
            数据更新：{new Date(data.dataQuality.updatedAt).toLocaleString('zh-CN')} · 样本{' '}
            {data.dataQuality.sampleSize} 人
          </p>
          {data.dataQuality.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-700">
              ⚠ {w}
            </p>
          ))}
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href={`/api/zhiban/teacher/courses/${courseId}/analytics/export`}>
              <Download className="mr-2 size-4" />
              导出
            </a>
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            <RefreshCw className="mr-2 size-4" />
            刷新
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void post({ action: 'schedule' }, '已启用每周异步分析快照')}
          >
            <Archive className="mr-2 size-4" />
            每周快照
          </Button>
          <Button
            disabled={busy}
            onClick={() => void post({ action: 'snapshot' }, '分析快照已保存')}
          >
            <Archive className="mr-2 size-4" />
            保存快照
          </Button>
        </div>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <K label="选课学生" value={s.enrolled_students} />
        <K label="7日活跃" value={s.active_students_7d} />
        <K label="30日事件" value={s.events_30d} />
        <K label="活动完成率" value={`${s.completion_rate}%`} />
        <K label="平均总评" value={s.average_score} />
        <K label="风险学生" value={s.at_risk_students} />
      </section>
      <details className="rounded border bg-white p-4 text-sm">
        <summary className="cursor-pointer font-medium">指标口径说明</summary>
        <div className="mt-3 grid gap-2 text-slate-600 md:grid-cols-2">
          <p>7日活跃：近7日产生至少一条有效学习事件的去重学生数。</p>
          <p>活动完成率：学生已完成活动记录数占全部活动进度记录数的比例。</p>
          <p>平均总评：当前课程已发布课程总评的算术平均值。</p>
          <p>风险学生：存在未关闭风险案例的去重学生数。</p>
          <p>活动漏斗：开始和完成人数均按学生去重；低于50%标记为瓶颈。</p>
          <p>干预有效率：已复评干预中风险分数下降并被判定有效的比例。</p>
        </div>
      </details>
      <section className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-5 text-blue-600" />
              近14日学习趋势
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-1">
              {data.trend.map((x) => (
                <div
                  key={String(x.day)}
                  className="group flex min-w-0 flex-1 flex-col items-center"
                >
                  <div
                    className="w-full rounded-t bg-blue-500"
                    style={{ height: `${Math.max(3, (Number(x.event_count) / max) * 150)}px` }}
                  />
                  <span className="mt-1 text-[9px]">{new Date(String(x.day)).getDate()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>智能体干预效果</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            <K label="已复评" value={data.effectiveness.measured} />
            <K label="有效率" value={`${data.effectiveness.effective_rate}%`} />
            <K label="风险下降" value={data.effectiveness.average_risk_reduction} />
          </CardContent>
        </Card>
      </section>
      <Diag
        title="模块质量诊断"
        rows={data.modules}
        columns={['title', 'activity_count', 'completion_rate']}
      />
      <Diag
        title="活动类型对比"
        rows={data.activityTypes}
        columns={[
          'activity_type',
          'activity_count',
          'started_students',
          'completed_students',
          'average_score',
        ]}
      />
      <Diag
        title="活动完成漏斗"
        rows={data.activities}
        columns={[
          'module_title',
          'chapter_title',
          'title',
          'activity_type',
          'started_count',
          'completed_count',
          'completion_rate',
        ]}
      />
      <Diag
        title="学生学习状态分群（可按名单下钻）"
        rows={data.learners}
        columns={[
          'learner_name',
          'student_no',
          'segment',
          'events_30d',
          'completed_activities',
          'total_score',
          'active_risks',
        ]}
      />
      {data.comparison && (
        <Diag
          title="最近快照与当前指标对比"
          rows={data.comparison}
          columns={['metric', 'before', 'after', 'change']}
        />
      )}
      <section className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <Lightbulb className="mr-2 inline size-5" />
              系统改进建议
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recommendations.map((r, i) => (
              <div key={i} className="rounded border p-3">
                <b>{r.title}</b>
                <p className="text-sm">{r.evidence}</p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void post(
                      {
                        action: 'create_action',
                        title: r.title,
                        evidence: r.evidence,
                        actionType: r.actionType,
                        priority: r.level,
                      },
                      '已转为任务',
                    )
                  }
                >
                  转为任务
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>新建改进任务</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void create(e)} className="space-y-2">
              <input
                name="title"
                required
                className="w-full rounded border p-2"
                placeholder="改进目标"
              />
              <textarea name="evidence" className="w-full rounded border p-2" placeholder="证据" />
              <textarea
                name="hypothesis"
                className="w-full rounded border p-2"
                placeholder="假设"
              />
              <div className="grid grid-cols-2 gap-2">
                <select name="actionType" className="rounded border p-2">
                  <option value="content">内容</option>
                  <option value="activity">活动</option>
                  <option value="assessment">测评</option>
                  <option value="agent">智能体</option>
                  <option value="intervention">干预</option>
                </select>
                <select name="priority" className="rounded border p-2">
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
                <input name="targetMetric" className="rounded border p-2" placeholder="目标指标" />
                <input
                  name="targetValue"
                  type="number"
                  className="rounded border p-2"
                  placeholder="目标值"
                />
              </div>
              <Button disabled={busy}>建立任务</Button>
            </form>
          </CardContent>
        </Card>
      </section>
      <Card>
        <CardHeader>
          <CardTitle>
            <CheckCircle2 className="mr-2 inline size-5" />
            持续改进任务
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.actions.map((a) => (
            <div
              key={String(a.id)}
              className="flex flex-wrap items-center gap-3 rounded border p-3"
            >
              <div className="flex-1">
                <b>{String(a.title)}</b>
                <p className="text-xs">
                  {String(a.status)} · 达标：{String(a.attainment)}
                </p>
              </div>
              {a.status !== 'completed' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void post(
                        { action: 'update_action', id: a.id, status: 'in_progress' },
                        '已开始',
                      )
                    }
                  >
                    开始
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      void post(
                        { action: 'update_action', id: a.id, status: 'completed' },
                        '已完成',
                      )
                    }
                  >
                    完成
                  </Button>
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
function Diag({ title, rows, columns }: { title: string; rows: Row[]; columns: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="border-b p-2 text-left">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r.id ?? i)}>
                {columns.map((c) => (
                  <td key={c} className="border-b p-2">
                    {String(r[c] ?? '—')}
                    {c.includes('rate') ? '%' : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-4 text-center text-slate-500">暂无数据</p>}
      </CardContent>
    </Card>
  );
}
function K({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded border bg-white p-4 text-center">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-blue-700">{String(value ?? 0)}</p>
    </div>
  );
}
