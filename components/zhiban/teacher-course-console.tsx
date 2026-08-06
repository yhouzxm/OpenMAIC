'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, RefreshCw, Save, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { TeacherCourse } from '@/lib/zhiban/teacher-courses';
import { ZhibanLogoutButton } from './logout-button';

const selectClass = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';
const text = (values: Record<string, FormDataEntryValue>, key: string) => String(values[key] ?? '');
const number = (values: Record<string, FormDataEntryValue>, key: string) => Number(values[key]);
const enabled = (values: Record<string, FormDataEntryValue>, key: string) => values[key] === 'on';
const rows = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
const localDate = (value: string | null) => value ? new Date(value).toISOString().slice(0, 16) : '';
const isoDate = (value: FormDataEntryValue | undefined) => value ? new Date(String(value)).toISOString() : null;

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`);
  return body as T;
}

export function TeacherCourseConsole({ principalName }: { principalName: string }) {
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await api<{ courses: TeacherCourse[] }>('/api/zhiban/teacher/courses');
      setCourses(result.courses);
      setSelectedId((id) => result.courses.some((course) => course.id === id) ? id : (result.courses[0]?.id ?? ''));
    } catch (error) { toast.error(error instanceof Error ? error.message : '加载失败'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const course = courses.find((item) => item.id === selectedId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!course) return;
    setBusy(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/api/zhiban/teacher/courses/${course.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: text(values, 'name'), description: text(values, 'description'),
          credits: text(values, 'credits') === '' ? null : number(values, 'credits'),
          startsAt: isoDate(values.startsAt), endsAt: isoDate(values.endsAt),
          deliveryMode: values.deliveryMode,
          learningObjectives: rows(text(values, 'learningObjectives')),
          teachingNotes: text(values, 'teachingNotes'), pblEnabled: enabled(values, 'pblEnabled'),
          pblProjects: rows(text(values, 'pblProjects')).map((line) => {
            const [name = '', deliverable = '', description = ''] = line.split('|').map((part) => part.trim());
            return { name, deliverable, description };
          }),
          sceneRules: rows(text(values, 'sceneRules')).map((line) => {
            const [sceneId = '', name = '', condition = 'always', value = ''] = line.split('|').map((part) => part.trim());
            return { sceneId, name, condition, value };
          }),
          courseResources: rows(text(values, 'courseResources')).map((line) => {
            const [title = '', type = 'link', url = ''] = line.split('|').map((part) => part.trim());
            return { title, type, url };
          }),
          agentSettings: {
            tutorEnabled: enabled(values, 'tutorEnabled'), peerEnabled: enabled(values, 'peerEnabled'),
            monitorEnabled: enabled(values, 'monitorEnabled'), strategyEnabled: enabled(values, 'strategyEnabled'),
          },
          promptStrategy: { version: text(values, 'promptVersion'), policy: text(values, 'promptPolicy') },
          gradingPolicy: {
            formativeWeight: number(values, 'formativeWeight'), projectWeight: number(values, 'projectWeight'),
            finalWeight: number(values, 'finalWeight'),
          },
          assignmentPolicy: { assignmentCount: number(values, 'assignmentCount'), maxAttempts: number(values, 'maxAttempts') },
          warningPolicy: {
            scoreThreshold: number(values, 'scoreThreshold'), inactivityDays: number(values, 'inactivityDays'),
            missedAssignments: number(values, 'missedAssignments'),
          },
          interventionPolicy: { strategy: values.interventionStrategy, message: text(values, 'interventionMessage') },
          publicationStatus: values.publicationStatus, expectedVersion: course.version,
        }),
      });
      toast.success('课程设置已保存');
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto min-h-screen max-w-7xl px-4 py-6">
    <header className="mb-6 flex items-center justify-between rounded-2xl bg-slate-950 px-6 py-5 text-white">
      <div><p className="text-sm text-teal-300">授课教师工作台 · {principalName}</p><h1 className="text-2xl font-semibold">课程设定</h1></div>
      <div className="flex gap-2"><Button variant="secondary" asChild><Link href="/zhiban/teacher/pbl"><Workflow className="mr-2 size-4" />PBL 项目</Link></Button><Button variant="secondary" asChild><Link href="/zhiban"><ArrowLeft className="mr-2 size-4" />返回</Link></Button><Button variant="secondary" onClick={() => void load()}><RefreshCw className="size-4" /></Button><ZhibanLogoutButton /></div>
    </header>
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Card><CardHeader><CardTitle>我的课程</CardTitle></CardHeader><CardContent className="space-y-2">
        {courses.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded-lg border p-3 text-left ${item.id === selectedId ? 'border-teal-600 bg-teal-50' : ''}`}><p className="font-medium">{item.name}</p><p className="text-sm text-slate-500">{item.code}</p><Badge variant="outline">{item.publicationStatus === 'published' ? '已发布' : '草稿'}</Badge></button>)}
        {!courses.length && <p className="text-sm text-slate-500">尚未分配课程范围</p>}
      </CardContent></Card>
      {course && <Card><CardHeader><CardTitle className="flex items-center gap-2"><BookOpen />编辑 {course.name}</CardTitle></CardHeader><CardContent>
        <form key={`${course.id}-${course.version}`} onSubmit={submit} className="grid gap-4 md:grid-cols-2">
          <Section title="课程基本信息" />
          <Field label="课程名称"><Input name="name" defaultValue={course.name} required /></Field>
          <Field label="学分"><Input name="credits" type="number" min={0} step="0.5" defaultValue={course.credits ?? ''} /></Field>
          <Field label="课程开始时间"><Input name="startsAt" type="datetime-local" defaultValue={localDate(course.startsAt)} /></Field>
          <Field label="课程结束时间"><Input name="endsAt" type="datetime-local" defaultValue={localDate(course.endsAt)} /></Field>
          <Field label="教学模式"><select className={selectClass} name="deliveryMode" defaultValue={course.deliveryMode}><option value="online">在线</option><option value="blended">混合式</option><option value="face_to_face">面授</option></select></Field>
          <Field label="发布状态"><select className={selectClass} name="publicationStatus" defaultValue={course.publicationStatus}><option value="draft">草稿</option><option value="published">发布</option></select></Field>
          <Wide label="课程简介"><Textarea name="description" defaultValue={course.description} /></Wide>
          <Wide label="学习目标（每行一个）"><Textarea name="learningObjectives" rows={4} defaultValue={course.learningObjectives.join('\n')} /></Wide>
          <Wide label="教学说明"><Textarea name="teachingNotes" rows={4} defaultValue={course.teachingNotes} /></Wide>

          <Section title="PBL、场景与资源" />
          <Toggle name="pblEnabled" label="启用 PBL" checked={course.pblEnabled} />
          <div />
          <Wide label="PBL 项目（每行：项目名称 | 成果要求 | 项目说明）"><Textarea name="pblProjects" rows={5} defaultValue={course.pblProjects.map((p) => `${p.name} | ${p.deliverable} | ${p.description}`).join('\n')} /></Wide>
          <Wide label="场景开放条件（每行：场景ID | 名称 | always/date/previous_completed/score | 条件值）"><Textarea name="sceneRules" rows={5} defaultValue={course.sceneRules.map((r) => `${r.sceneId} | ${r.name} | ${r.condition} | ${r.value}`).join('\n')} /></Wide>
          <Wide label="课程资源（每行：标题 | document/video/link/dataset/other | 地址）"><Textarea name="courseResources" rows={5} defaultValue={course.courseResources.map((r) => `${r.title} | ${r.type} | ${r.url}`).join('\n')} /></Wide>

          <Section title="智能体与提示词策略" />
          <Toggle name="tutorEnabled" label="Tutor 智能体" checked={course.agentSettings.tutorEnabled} />
          <Toggle name="peerEnabled" label="Peer 智能体" checked={course.agentSettings.peerEnabled} />
          <Toggle name="monitorEnabled" label="Monitor 智能体" checked={course.agentSettings.monitorEnabled} />
          <Toggle name="strategyEnabled" label="Strategy 智能体" checked={course.agentSettings.strategyEnabled} />
          <Field label="提示词策略版本"><Input name="promptVersion" defaultValue={course.promptStrategy.version} required /></Field>
          <Wide label="提示词策略"><Textarea name="promptPolicy" rows={6} defaultValue={course.promptStrategy.policy} /></Wide>

          <Section title="成绩与作业策略" />
          <NumberField label="过程性成绩权重（%）" name="formativeWeight" value={course.gradingPolicy.formativeWeight} min={0} max={100} />
          <NumberField label="项目成绩权重（%）" name="projectWeight" value={course.gradingPolicy.projectWeight} min={0} max={100} />
          <NumberField label="期末成绩权重（%）" name="finalWeight" value={course.gradingPolicy.finalWeight} min={0} max={100} />
          <NumberField label="作业次数" name="assignmentCount" value={course.assignmentPolicy.assignmentCount} min={0} max={200} />
          <NumberField label="每次作业最大尝试次数" name="maxAttempts" value={course.assignmentPolicy.maxAttempts} min={1} max={100} />

          <Section title="预警与干预策略" />
          <NumberField label="成绩预警阈值" name="scoreThreshold" value={course.warningPolicy.scoreThreshold} min={0} max={100} />
          <NumberField label="未学习天数阈值" name="inactivityDays" value={course.warningPolicy.inactivityDays} min={1} max={365} />
          <NumberField label="缺交作业次数阈值" name="missedAssignments" value={course.warningPolicy.missedAssignments} min={0} max={200} />
          <Field label="干预方式"><select className={selectClass} name="interventionStrategy" defaultValue={course.interventionPolicy.strategy}><option value="notify_student">通知学生</option><option value="notify_teacher">通知教师</option><option value="agent_coaching">智能体辅导</option><option value="manual_follow_up">人工跟进</option></select></Field>
          <Wide label="干预消息/执行说明"><Textarea name="interventionMessage" rows={4} defaultValue={course.interventionPolicy.message} /></Wide>
          <div className="md:col-span-2"><Button disabled={busy}><Save className="mr-2 size-4" />{busy ? '保存中…' : `保存设置（版本 ${course.version + 1}）`}</Button></div>
        </form>
      </CardContent></Card>}
    </div>
  </main>;
}

function Section({ title }: { title: string }) { return <h2 className="border-b pb-2 pt-4 text-lg font-semibold md:col-span-2">{title}</h2>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function Wide({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2 md:col-span-2"><Label>{label}</Label>{children}</div>; }
function NumberField({ label, name, value, min, max }: { label: string; name: string; value: number; min: number; max: number }) { return <Field label={label}><Input name={name} type="number" min={min} max={max} step="1" defaultValue={value} required /></Field>; }
function Toggle({ name, label, checked }: { name: string; label: string; checked: boolean }) { return <label className="flex items-center justify-between rounded-lg border p-3 text-sm">{label}<Switch name={name} defaultChecked={checked} /></label>; }
