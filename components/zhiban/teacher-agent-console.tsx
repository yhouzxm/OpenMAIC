'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TeacherCourse } from '@/lib/zhiban/teacher-courses';

type Item = {
  id: string;
  learner_name: string;
  learner_username: string;
  target_role: string;
  objective: string;
  status: string;
  created_at: string;
  last_error?: string;
  metrics?: { calls?: number; failures?: number; avgLatencyMs?: number };
};
type Template = {
  id: string;
  role_type: 'tutor' | 'peer' | 'monitor';
  version: string;
  name: string;
  persona: string;
  status: string;
};
type MonitorData = {
  policy: { enabled:boolean; mode:'shadow'|'active'|'paused'; tutorThreshold:number; peerThreshold:number; teacherThreshold:number; cooldownMinutes:number; dailyLimit:number; followupHours:number; policyVersion:string };
  decisions: Array<{id:string;learner_name:string;risk_score:string;risk_level:string;signal_type:string;target_role?:string;disposition:string;reason:string;created_at:string}>;
  effectiveness: { measured?:number; effective_count?:number; average_reduction?:string };
};

const fieldClass =
  'min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100';
const statusClass: Record<string, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  failed: 'border-red-200 bg-red-50 text-red-700',
  escalated: 'border-orange-200 bg-orange-50 text-orange-800',
  running: 'border-blue-200 bg-blue-50 text-blue-700',
  delivered: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  resolved: 'border-slate-200 bg-slate-100 text-slate-700',
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? '请求失败');
  return body;
}

export function TeacherAgentConsole({
  embedded = false,
  fixedCourseId = '',
  hideHeader = false,
}: {
  embedded?: boolean;
  fixedCourseId?: string;
  hideHeader?: boolean;
}) {
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [courseId, setCourseId] = useState(fixedCourseId);
  const [items, setItems] = useState<Item[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [monitor, setMonitor] = useState<MonitorData | null>(null);

  const load = useCallback(async () => {
    if (!courseId) return;
    setItems(
      (
        await api<{ interventions: Item[] }>(
          `/api/zhiban/teacher/courses/${courseId}/interventions`,
        )
      ).interventions,
    );
  }, [courseId]);

  useEffect(() => {
    if (fixedCourseId) return;
    void api<{ courses: TeacherCourse[] }>('/api/zhiban/teacher/courses')
      .then((result) => {
        setCourses(result.courses);
        const requested = new URLSearchParams(window.location.search).get('courseId');
        setCourseId(
          (id) =>
            id ||
            (result.courses.some((course) => course.id === requested)
              ? requested!
              : result.courses[0]?.id) ||
            '',
        );
      })
      .catch((error) => toast.error(error.message));
  }, [fixedCourseId]);
  useEffect(() => {
    if (!courseId) return;
    void Promise.all([
      api<{ interventions: Item[] }>(`/api/zhiban/teacher/courses/${courseId}/interventions`),
      api<{ templates: Template[] }>(`/api/zhiban/teacher/courses/${courseId}/agent-templates`),
      api<MonitorData>(`/api/zhiban/teacher/courses/${courseId}/monitor`),
    ])
      .then(([a, b, c]) => {
        setItems(a.interventions);
        setTemplates(b.templates);
        setMonitor(c);
      })
      .catch((error) => toast.error(error.message));
  }, [courseId]);

  async function act(id: string, action: 'escalate' | 'resolve' | 'retry' | 'assign') {
    const note = action === 'resolve' ? (window.prompt('请输入结案说明') ?? undefined) : undefined;
    if (action === 'resolve' && !note) return;
    const effective = action === 'resolve' ? window.confirm('本次干预是否有效？\n“确定”表示有效，“取消”表示未见明显效果。') : undefined;
    try {
      await api(`/api/zhiban/teacher/courses/${courseId}/interventions`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ briefId: id, action, note, effective }),
      });
      toast.success('处理成功');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '处理失败');
    }
  }

  async function saveTemplate(form: FormData) {
    try {
      await api(`/api/zhiban/teacher/courses/${courseId}/agent-templates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roleType: form.get('roleType'),
          version: form.get('version'),
          name: form.get('name'),
          persona: form.get('persona'),
          publish: form.get('publish') === 'on',
        }),
      });
      toast.success('模板已保存');
      setTemplates(
        (
          await api<{ templates: Template[] }>(
            `/api/zhiban/teacher/courses/${courseId}/agent-templates`,
          )
        ).templates,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function publishTemplate(templateId: string) {
    try {
      await api(`/api/zhiban/teacher/courses/${courseId}/agent-templates`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });
      toast.success('版本已发布');
      setTemplates(
        (
          await api<{ templates: Template[] }>(
            `/api/zhiban/teacher/courses/${courseId}/agent-templates`,
          )
        ).templates,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发布失败');
    }
  }
  async function saveMonitor(form:FormData){
    try{
      const number=(name:string)=>Number(form.get(name));
      await api(`/api/zhiban/teacher/courses/${courseId}/monitor`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:form.get('enabled')==='on',mode:form.get('mode'),tutorThreshold:number('tutorThreshold'),peerThreshold:number('peerThreshold'),teacherThreshold:number('teacherThreshold'),cooldownMinutes:number('cooldownMinutes'),dailyLimit:number('dailyLimit'),followupHours:number('followupHours'),policyVersion:form.get('policyVersion')})});
      setMonitor(await api<MonitorData>(`/api/zhiban/teacher/courses/${courseId}/monitor`));toast.success('Monitor 策略已保存');
    }catch(error){toast.error(error instanceof Error?error.message:'保存失败');}
  }

  const pending = items.filter((item) =>
    ['pending', 'failed', 'escalated'].includes(item.status),
  ).length;
  const failed = items.reduce((total, item) => total + Number(item.metrics?.failures ?? 0), 0);
  const summaries = [
    { label: '干预总数', value: items.length, color: 'text-teal-700' },
    { label: '待人工处理', value: pending, color: 'text-amber-700' },
    { label: '调用失败', value: failed, color: 'text-red-700' },
  ];

  return (
    <main
      className={embedded ? 'text-slate-900' : 'min-h-screen bg-slate-100 px-4 py-6 text-slate-900'}
    >
      <div className="mx-auto max-w-7xl space-y-5">
        {!embedded && !hideHeader && (
          <header className="flex flex-col gap-4 rounded-2xl bg-slate-950 px-6 py-5 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">多智能体干预中心</h1>
              <p className="mt-1 text-sm text-slate-300">Tutor、Peer 与教师干预的审计和处置闭环</p>
            </div>
            <Button asChild className="bg-white text-slate-900 hover:bg-slate-100">
              <Link href="/zhiban/teacher/courses">返回课程设置</Link>
            </Button>
          </header>
        )}
        {!embedded && (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="mb-2 block text-sm font-medium text-slate-700">当前课程</label>
            <select
              className={`${fieldClass} w-full md:max-w-md`}
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </section>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          {summaries.map((summary) => (
            <Card key={summary.label} className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">
                  {summary.label}
                </CardTitle>
              </CardHeader>
              <CardContent className={`text-3xl font-semibold ${summary.color}`}>
                {summary.value}
              </CardContent>
            </Card>
          ))}
        </div>
        {monitor && <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100"><CardTitle>Monitor 协同策略</CardTitle></CardHeader>
          <CardContent className="space-y-5 pt-5">
            <form action={saveMonitor} className="grid gap-3 md:grid-cols-4">
              <label className="flex items-center gap-2 text-sm"><input name="enabled" type="checkbox" defaultChecked={monitor.policy.enabled}/>启用 Monitor</label>
              <label className="text-sm">运行模式<select name="mode" defaultValue={monitor.policy.mode} className={`${fieldClass} mt-1 w-full`}><option value="shadow">影子模式</option><option value="active">主动模式</option><option value="paused">暂停</option></select></label>
              <Field name="policyVersion" label="策略版本" value={monitor.policy.policyVersion}/><Field name="cooldownMinutes" label="冷却（分钟）" value={monitor.policy.cooldownMinutes} type="number"/>
              <Field name="tutorThreshold" label="Tutor 成绩阈值" value={monitor.policy.tutorThreshold} type="number"/><Field name="peerThreshold" label="Peer 协作阈值" value={monitor.policy.peerThreshold} type="number"/><Field name="teacherThreshold" label="教师升级风险阈值" value={monitor.policy.teacherThreshold} type="number"/><Field name="dailyLimit" label="每日自动干预上限" value={monitor.policy.dailyLimit} type="number"/>
              <Field name="followupHours" label="复评间隔（小时）" value={monitor.policy.followupHours} type="number"/>
              <div className="flex items-end"><Button className="bg-teal-700 text-white hover:bg-teal-800">保存 Monitor 策略</Button></div>
            </form>
            <div className="grid gap-3 md:grid-cols-3 text-sm"><Stat label="已复评" value={monitor.effectiveness.measured??0}/><Stat label="判定有效" value={monitor.effectiveness.effective_count??0}/><Stat label="平均风险下降" value={monitor.effectiveness.average_reduction??'—'}/></div>
            <div><h3 className="mb-2 font-semibold">最近 Monitor 决策</h3>{monitor.decisions.length?<div className="max-h-80 divide-y overflow-y-auto rounded border">{monitor.decisions.map(d=><div key={d.id} className="p-3 text-sm"><div className="flex flex-wrap gap-2"><b>{d.learner_name}</b><Badge variant="outline">{d.signal_type}</Badge><Badge variant="outline">风险 {d.risk_score}</Badge><Badge>{d.disposition}</Badge>{d.target_role&&<span>→ {d.target_role}</span>}</div><p className="mt-1 text-slate-600">{d.reason}</p><p className="mt-1 text-xs text-slate-400">{new Date(d.created_at).toLocaleString()}</p></div>)}</div>:<p className="text-sm text-slate-500">暂无决策记录。影子模式运行后也会在此留痕。</p>}</div>
          </CardContent>
        </Card>}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-slate-900">角色提示词版本</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <form action={saveTemplate} className="grid gap-3 lg:grid-cols-5">
              <select name="roleType" className={fieldClass}>
                <option value="tutor">Tutor</option>
                <option value="peer">Peer</option>
                <option value="monitor">Monitor</option>
              </select>
              <input required name="version" placeholder="版本，如 v2" className={fieldClass} />
              <input required name="name" placeholder="显示名称" className={fieldClass} />
              <textarea
                required
                name="persona"
                placeholder="角色提示词"
                className={`${fieldClass} min-h-24 lg:col-span-2`}
              />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="publish" className="size-4 accent-teal-700" />
                立即发布
              </label>
              <Button type="submit" className="bg-teal-700 text-white hover:bg-teal-800">
                保存模板
              </Button>
            </form>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {templates.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">暂无自定义模板，将使用系统默认配置。</p>
              ) : (
                templates.map((template) => (
                  <div key={template.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <Badge className="bg-teal-50 text-teal-800 hover:bg-teal-50">
                      {template.role_type}
                    </Badge>
                    <span className="font-medium text-slate-800">
                      {template.version} · {template.name}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        template.status === 'active'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 text-slate-600'
                      }
                    >
                      {template.status}
                    </Badge>
                    {template.status !== 'active' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void publishTemplate(template.id)}
                      >
                        发布/回滚到此版本
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-slate-900">干预记录</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {items.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-6 text-center text-slate-500">暂无干预记录</p>
            ) : (
              items.map((item) => (
                <article
                  key={item.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {item.learner_name || item.learner_username}
                    </span>
                    <Badge className="bg-indigo-50 text-indigo-700 hover:bg-indigo-50">
                      {item.target_role}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        statusClass[item.status] ?? 'border-slate-200 bg-slate-50 text-slate-700'
                      }
                    >
                      {item.status}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="my-3 text-sm leading-6 text-slate-700">{item.objective}</p>
                  {item.last_error && (
                    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                      失败原因：{item.last_error}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    调用 {item.metrics?.calls ?? 0} 次 · 失败 {item.metrics?.failures ?? 0} 次 ·
                    平均耗时 {item.metrics?.avgLatencyMs ?? '-'} ms
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void act(item.id, 'assign')}>
                      分配给我
                    </Button>
                    <Button
                      size="sm"
                      className="bg-orange-600 text-white hover:bg-orange-700"
                      onClick={() => void act(item.id, 'escalate')}
                    >
                      升级人工
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void act(item.id, 'retry')}>
                      重试
                    </Button>
                    <Button
                      size="sm"
                      className="bg-teal-700 text-white hover:bg-teal-800"
                      onClick={() => void act(item.id, 'resolve')}
                    >
                      结案
                    </Button>
                  </div>
                </article>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Field({name,label,value,type='text'}:{name:string;label:string;value:string|number;type?:string}){return <label className="text-sm">{label}<input required name={name} type={type} min={type==='number'?0:undefined} max={type==='number'?10080:undefined} defaultValue={value} className={`${fieldClass} mt-1 w-full`}/></label>;}
function Stat({label,value}:{label:string;value:string|number}){return <div className="rounded bg-slate-50 p-3"><p className="text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>;}
