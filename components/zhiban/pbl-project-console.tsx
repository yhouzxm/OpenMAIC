'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { TeacherCourse } from '@/lib/zhiban/teacher-courses';
import type { ZhibanPblProject } from '@/lib/zhiban/pbl';
import { ZhibanLogoutButton } from './logout-button';
import { PblCollaborationConsole } from './pbl-collaboration-console';

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init); const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`); return body as T;
}

export function PblProjectConsole() {
  const [courses, setCourses] = useState<TeacherCourse[]>([]); const [courseId, setCourseId] = useState('');
  const [projects, setProjects] = useState<ZhibanPblProject[]>([]); const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<ZhibanPblProject | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const loadCourses = useCallback(async () => { const data = await api<{ courses: TeacherCourse[] }>('/api/zhiban/teacher/courses'); setCourses(data.courses); setCourseId((id) => id || data.courses[0]?.id || ''); }, []);
  const loadProjects = useCallback(async () => { if (!courseId) return; const data = await api<{ projects: ZhibanPblProject[] }>(`/api/zhiban/pbl/projects?courseId=${courseId}`); setProjects(data.projects); }, [courseId]);
  useEffect(() => { void loadCourses().catch((e) => toast.error(e.message)); }, [loadCourses]);
  useEffect(() => { void api<{ templates: Array<{ id: string; code: string; name: string }> }>('/api/zhiban/pbl/templates').then((data) => setTemplates(data.templates)).catch(() => undefined); }, []);
  useEffect(() => { void loadProjects().catch((e) => toast.error(e.message)); }, [loadProjects]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(editing ? `edit-${editing.id}` : 'create');
    try {
      await api(editing ? `/api/zhiban/pbl/projects/${editing.id}` : '/api/zhiban/pbl/projects', { method: editing ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        courseId, code: String(values.code), title: String(values.title), description: String(values.description ?? ''),
        learningObjective: String(values.learningObjective ?? ''), targetSkills: String(values.targetSkills).split('\n').map((x) => x.trim()).filter(Boolean),
        deliverable: String(values.deliverable ?? ''), scenarioRoleplay: values.scenarioRoleplay === 'on', scenarioBrief: String(values.scenarioBrief ?? ''),
        opensAt: values.opensAt ? new Date(String(values.opensAt)).toISOString() : null, closesAt: values.closesAt ? new Date(String(values.closesAt)).toISOString() : null, status: 'draft',
      }) }); toast.success(editing ? 'PBL 项目已更新，请重新生成项目包' : 'PBL 项目已创建'); form.reset(); setEditing(null); await loadProjects();
    } catch (e) { toast.error(e instanceof Error ? e.message : editing ? '更新失败' : '创建失败'); } finally { setBusy(''); }
  }
  async function generate(id: string) {
    setBusy(id); try { await api(`/api/zhiban/pbl/projects/${id}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); toast.success('OpenMAIC PBL 项目包已生成'); await loadProjects(); }
    catch (e) { toast.error(e instanceof Error ? e.message : '生成失败'); } finally { setBusy(''); }
  }
  async function toggleStatus(project: ZhibanPblProject) {
    setBusy(`status-${project.id}`); try { await api(`/api/zhiban/pbl/projects/${project.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: project.status === 'published' ? 'draft' : 'published' }) }); toast.success(project.status === 'published' ? '项目已撤回' : '项目已发布'); await loadProjects(); }
    catch (e) { toast.error(e instanceof Error ? e.message : '状态更新失败'); } finally { setBusy(''); }
  }
  return <main className="mx-auto max-w-7xl px-4 py-6">
    <header className="mb-6 flex items-center justify-between rounded-2xl bg-slate-950 px-6 py-5 text-white"><div><p className="text-sm text-teal-300">阶段 6 · 复用 OpenMAIC PBL v2</p><h1 className="text-2xl font-semibold">PBL 项目管理</h1></div><div className="flex gap-2"><Button variant="secondary" asChild><Link href="/zhiban/teacher/courses"><ArrowLeft className="mr-2 size-4" />课程设置</Link></Button><ZhibanLogoutButton /></div></header>
    <div className="mb-5"><Label>课程</Label><select className="mt-2 h-10 w-full rounded-md border px-3" value={courseId} onChange={(e) => { setCourseId(e.target.value); setEditing(null); setManagingId(null); }}>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.code}）</option>)}</select>{templates.length > 0 && <form className="mt-3 flex gap-2" onSubmit={async (event) => { event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); try { await api('/api/zhiban/pbl/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ templateId: form.get('templateId'), courseId, code: form.get('code') }) }); toast.success('已从模板创建项目'); element.reset(); await loadProjects(); } catch (error) { toast.error(error instanceof Error ? error.message : '模板创建失败'); } }}><select name="templateId" className="h-9 flex-1 rounded-md border px-2">{templates.map((template) => <option key={template.id} value={template.id}>{template.name}（{template.code}）</option>)}</select><Input name="code" className="max-w-48" placeholder="新项目编码" required /><Button variant="outline">从模板创建</Button></form>}</div>
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card><CardHeader><CardTitle className="flex items-center justify-between"><span className="flex gap-2">{editing ? <Pencil /> : <Plus />}{editing ? '编辑项目' : '新建项目'}</span>{editing && <Button variant="ghost" size="sm" onClick={() => setEditing(null)}><X className="mr-2 size-4" />取消</Button>}</CardTitle></CardHeader><CardContent><form key={editing?.id ?? 'new'} onSubmit={create} className="space-y-4">
        <Field label="项目编码"><Input name="code" defaultValue={editing?.code ?? ''} required /></Field><Field label="项目名称"><Input name="title" defaultValue={editing?.title ?? ''} required /></Field>
        <Field label="项目说明"><Textarea name="description" rows={3} defaultValue={editing?.description ?? ''} /></Field><Field label="学习目标"><Textarea name="learningObjective" rows={3} defaultValue={editing?.learningObjective ?? ''} /></Field>
        <Field label="目标技能（每行一个）"><Textarea name="targetSkills" rows={4} defaultValue={editing?.targetSkills.join('\n') ?? ''} required /></Field><Field label="成果要求"><Textarea name="deliverable" rows={3} defaultValue={editing?.deliverable ?? ''} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="开放时间"><Input type="datetime-local" name="opensAt" defaultValue={toLocalDate(editing?.opensAt)} /></Field><Field label="截止时间"><Input type="datetime-local" name="closesAt" defaultValue={toLocalDate(editing?.closesAt)} /></Field></div>
        <label className="flex items-center justify-between rounded-md border p-3">情境角色扮演 <Switch name="scenarioRoleplay" defaultChecked={editing?.scenarioRoleplay ?? false} /></label><Field label="情境说明"><Textarea name="scenarioBrief" rows={3} defaultValue={editing?.scenarioBrief ?? ''} /></Field>
        <Button disabled={!courseId || busy === 'create' || busy.startsWith('edit-')}>{busy ? '保存中…' : editing ? '保存修改' : '创建项目'}</Button>
      </form></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center justify-between">项目列表<Button variant="ghost" onClick={() => void loadProjects()}><RefreshCw className="size-4" /></Button></CardTitle></CardHeader><CardContent className="space-y-3">
        {projects.map((p) => <div key={p.id} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-4"><div><p className="font-semibold">{p.title}</p><p className="text-sm text-slate-500">{p.code} · {p.status} · {p.openmaicPackage ? `项目包 v${p.packageVersion}` : '待生成项目包'}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setManagingId(p.id)}>协作与评价</Button><Button size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil className="mr-2 size-4" />编辑</Button><Button size="sm" variant="outline" onClick={() => void toggleStatus(p)} disabled={busy === `status-${p.id}`}>{p.status === 'published' ? '撤回' : '发布'}</Button><Button size="sm" onClick={() => void generate(p.id)} disabled={busy === p.id}><Bot className="mr-2 size-4" />{busy === p.id ? '生成中…' : p.openmaicPackage ? '重新生成' : '生成项目包'}</Button></div></div><p className="mt-2 text-sm">{p.description}</p><p className="mt-2 text-xs text-slate-500">技能：{p.targetSkills.join('、')}</p></div>)}
        {!projects.length && <p className="text-sm text-slate-500">当前课程暂无 PBL 项目。</p>}
      </CardContent></Card>
    </div>{managingId && <PblCollaborationConsole projectId={managingId} onClose={() => setManagingId(null)} />}
  </main>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function toLocalDate(value?: string | null) { return value ? new Date(value).toISOString().slice(0, 16) : ''; }
