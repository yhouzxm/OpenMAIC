'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Save, Sparkles, Trash2, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { TeacherCourse } from '@/lib/zhiban/teacher-courses';
import { ZhibanLogoutButton } from './logout-button';
type Binding = Record<string, unknown>;
async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? '操作失败');
  return body as T;
}
const iso = (value: FormDataEntryValue | null) =>
  value ? new Date(String(value)).toISOString() : null;
export function TeacherClassroomConsole({
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
  const [items, setItems] = useState<Binding[]>([]);
  const [progress, setProgress] = useState<Binding[]>([]);
  const [events, setEvents] = useState<Binding[]>([]);
  const [progressFilter, setProgressFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState<Binding | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ courses: TeacherCourse[] }>('/api/zhiban/teacher/courses')
      .then((data) => {
        setCourses(data.courses);
        const requested =
          fixedCourseId || new URLSearchParams(window.location.search).get('courseId');
        setCourseId(
          data.courses.some((course) => course.id === requested)
            ? requested!
            : (data.courses[0]?.id ?? ''),
        );
      })
      .catch((e) => toast.error(e.message));
  }, [fixedCourseId]);
  const load = useCallback(async () => {
    if (!courseId) return;
    const data = await api<{ classrooms: Binding[]; progress: Binding[]; events: Binding[] }>(
      `/api/zhiban/teacher/courses/${courseId}/classrooms`,
    );
    setItems(data.classrooms);
    setProgress(data.progress);
    setEvents(data.events);
  }, [courseId]);
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setBusy(true);
    try {
      await api(
        editing
          ? `/api/zhiban/teacher/classrooms/${editing.id}`
          : `/api/zhiban/teacher/courses/${courseId}/classrooms`,
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classroomId: form.get('classroomId'),
            title: form.get('title'),
            description: form.get('description'),
            displayOrder: Number(form.get('displayOrder')),
            opensAt: iso(form.get('opensAt')),
            closesAt: iso(form.get('closesAt')),
            status: form.get('status'),
          }),
        },
      );
      toast.success(editing ? '课堂绑定已更新' : '课堂已绑定到课程');
      element.reset();
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  const course = courses.find((item) => item.id === courseId);
  const createUrl = course
    ? `/?zhibanCourseId=${encodeURIComponent(course.id)}&zhibanCourseName=${encodeURIComponent(course.name)}`
    : '/';
  const filteredProgress = progress.filter(
    (row) =>
      (statusFilter === 'all' || row.status === statusFilter) &&
      (!progressFilter ||
        `${String(row.title)} ${String(row.display_name)} ${String(row.login_name)}`
          .toLowerCase()
          .includes(progressFilter.toLowerCase())),
  );
  function exportProgress() {
    const columns = [
      '课堂',
      '学生',
      '账号',
      '状态',
      '进度',
      '访问场景',
      '互动次数',
      '最高成绩',
      '最后活动',
    ];
    const lines = filteredProgress.map((row) =>
      [
        row.title,
        row.display_name,
        row.login_name,
        row.status,
        row.progress_percent,
        row.visited_count,
        row.interaction_count,
        row.max_score ?? '',
        row.last_activity_at ?? '',
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    );
    const blob = new Blob([`\ufeff${[columns.join(','), ...lines].join('\r\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${course?.code ?? 'course'}-classroom-progress.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function remove(item: Binding, mode: 'unbind' | 'delete') {
    const title = String(item.title);
    const confirmed = window.confirm(
      mode === 'unbind'
        ? `确认解除“${title}”与当前课程的绑定吗？\n学生入口将隐藏，但学习进度和审计记录会保留。`
        : `确认彻底删除“${title}”吗？\n这会删除 OpenMAIC 课堂文件、课程绑定及课堂学习会话，且无法撤销。`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await api(`/api/zhiban/teacher/classrooms/${String(item.id)}?mode=${mode}`, {
        method: 'DELETE',
      });
      toast.success(mode === 'unbind' ? '课堂已解绑，学习记录已保留' : '课堂及其绑定已删除');
      if (editing?.id === item.id) setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className={
        embedded
          ? 'mx-auto max-w-6xl [&>label:first-of-type]:hidden [&>select:first-of-type]:hidden'
          : 'mx-auto max-w-6xl px-5 py-8'
      }
    >
      {!embedded && !hideHeader && (
        <header className="mb-6 flex items-center justify-between rounded-2xl bg-slate-950 p-6 text-white">
          <div>
            <p className="text-sm text-teal-300">阶段 7 · OpenMAIC 课堂适配</p>
            <h1 className="text-2xl font-semibold">课程课堂绑定</h1>
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
      )}
      <Label>课程</Label>
      <select
        className="mb-5 mt-2 h-10 w-full rounded-md border px-3"
        value={courseId}
        onChange={(e) => {
          setCourseId(e.target.value);
          setEditing(null);
        }}
      >
        {courses.map((course) => (
          <option key={course.id} value={course.id}>
            {course.name}（{course.code}）
          </option>
        ))}
      </select>
      <div className="mb-5 rounded-xl border border-teal-200 bg-teal-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <b>创建新的 OpenMAIC 课堂</b>
            <p className="text-sm text-slate-600">
              进入生成器后，生成完成会自动绑定到当前课程并保存为草稿。
            </p>
          </div>
          <Button asChild disabled={!course}>
            <Link href={createUrl}>
              <Sparkles className="mr-2 size-4" />
              创建 OpenMAIC 课堂
            </Link>
          </Button>
        </div>
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>学生课堂学习进度</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              value={progressFilter}
              onChange={(event) => setProgressFilter(event.target.value)}
              placeholder="筛选课堂、学生或账号"
            />
            <select
              className="h-9 rounded-md border px-3"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">全部状态</option>
              <option value="not_started">未开始</option>
              <option value="in_progress">学习中</option>
              <option value="completed">已完成</option>
            </select>
            <Button variant="outline" onClick={exportProgress}>
              <Download className="mr-2 size-4" />
              导出 CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">课堂</th>
                  <th className="p-2">学生</th>
                  <th className="p-2">状态</th>
                  <th className="p-2">进度</th>
                  <th className="p-2">访问场景</th>
                  <th className="p-2">互动次数</th>
                  <th className="p-2">最高成绩</th>
                  <th className="p-2">Quiz 答案</th>
                  <th className="p-2">最后活动</th>
                </tr>
              </thead>
              <tbody>
                {filteredProgress.map((row) => (
                  <tr key={`${row.binding_id}:${row.student_id}`} className="border-b">
                    <td className="p-2">{String(row.title)}</td>
                    <td className="p-2">
                      {String(row.display_name)}
                      <span className="ml-1 text-xs text-slate-500">{String(row.login_name)}</span>
                    </td>
                    <td className="p-2">{String(row.status)}</td>
                    <td className="p-2">{Number(row.progress_percent)}%</td>
                    <td className="p-2">{Number(row.visited_count)}</td>
                    <td className="p-2">{Number(row.interaction_count)}</td>
                    <td className="p-2">{row.max_score == null ? '—' : String(row.max_score)}</td>
                    <td className="p-2">
                      <QuizAnswers attempts={row.quiz_attempts} />
                    </td>
                    <td className="p-2">
                      {row.last_activity_at
                        ? new Date(String(row.last_activity_at)).toLocaleString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredProgress.length && (
              <p className="py-4 text-slate-500">没有符合条件的课堂学习记录。</p>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{editing ? '编辑课堂' : '绑定 OpenMAIC 课堂'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form key={String(editing?.id ?? 'new')} className="space-y-3" onSubmit={submit}>
              <Field label="OpenMAIC 课堂 ID">
                <Input
                  name="classroomId"
                  defaultValue={String(editing?.classroom_id ?? '')}
                  required
                />
              </Field>
              <Field label="课堂标题">
                <Input name="title" defaultValue={String(editing?.title ?? '')} required />
              </Field>
              <Field label="课堂说明">
                <Textarea name="description" defaultValue={String(editing?.description ?? '')} />
              </Field>
              <Field label="显示顺序">
                <Input
                  name="displayOrder"
                  type="number"
                  min={0}
                  defaultValue={Number(editing?.display_order ?? 0)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="开放时间">
                  <Input name="opensAt" type="datetime-local" />
                </Field>
                <Field label="关闭时间">
                  <Input name="closesAt" type="datetime-local" />
                </Field>
              </div>
              <Field label="发布状态">
                <select
                  name="status"
                  className="h-9 w-full rounded-md border px-3"
                  defaultValue={String(editing?.status ?? 'draft')}
                >
                  <option value="draft">草稿</option>
                  <option value="published">发布</option>
                </select>
              </Field>
              <div className="flex gap-2">
                <Button disabled={busy || !courseId}>
                  <Save className="mr-2 size-4" />
                  保存
                </Button>
                {editing && (
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                    取消
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>课堂绑定记录</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item) => (
              <div key={String(item.id)} className="rounded-md border p-3">
                <button
                  className="w-full text-left hover:text-teal-700 disabled:cursor-default disabled:hover:text-inherit"
                  disabled={item.status === 'archived'}
                  onClick={() => setEditing(item)}
                >
                  <b>{String(item.title)}</b>
                  <p className="text-sm text-slate-500">
                    {String(item.classroom_id)} ·{' '}
                    {item.status === 'archived' ? '已解绑' : String(item.status)}
                  </p>
                </button>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.status !== 'archived' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void remove(item, 'unbind')}
                    >
                      <Unlink className="mr-1 size-3" />
                      解绑
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void remove(item, 'delete')}
                  >
                    <Trash2 className="mr-1 size-3" />
                    删除课堂
                  </Button>
                </div>
              </div>
            ))}
            {!items.length && <p className="text-sm text-slate-500">尚未绑定课堂。</p>}
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>课堂互动审计（最近 1000 条）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">时间</th>
                  <th className="p-2">课堂</th>
                  <th className="p-2">学生</th>
                  <th className="p-2">事件</th>
                  <th className="p-2">场景</th>
                  <th className="p-2">详情</th>
                </tr>
              </thead>
              <tbody>
                {events.map((row) => (
                  <tr key={String(row.id)} className="border-b align-top">
                    <td className="p-2">{new Date(String(row.occurred_at)).toLocaleString()}</td>
                    <td className="p-2">{String(row.title)}</td>
                    <td className="p-2">{String(row.display_name)}</td>
                    <td className="p-2">{String(row.event_type)}</td>
                    <td className="p-2">{String(row.scene_id ?? '—')}</td>
                    <td className="max-w-sm break-all p-2">
                      <code className="text-xs">{JSON.stringify(row.payload)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!events.length && <p className="py-4 text-slate-500">暂无互动事件。</p>}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function QuizAnswers({ attempts }: { attempts: unknown }) {
  const rows = Array.isArray(attempts) ? (attempts as Binding[]) : [];
  if (!rows.length) return <span>—</span>;
  return (
    <details>
      <summary className="cursor-pointer text-teal-700">{rows.length} 次作答</summary>
      <div className="mt-2 min-w-72 space-y-2">
        {rows.map((attempt, index) => (
          <div
            key={`${String(attempt.sceneId)}:${String(attempt.occurredAt)}:${index}`}
            className="rounded border p-2"
          >
            <b>成绩 {String(attempt.score ?? '—')}</b>
            <p className="text-xs text-slate-500">
              {new Date(String(attempt.occurredAt)).toLocaleString()}
            </p>
            <div className="mt-1 space-y-1">
              {(Array.isArray(attempt.answers) ? (attempt.answers as Binding[]) : []).map(
                (answer) => (
                  <p key={String(answer.questionId)} className="break-all text-xs">
                    <b>{String(answer.questionId)}：</b>
                    {Array.isArray(answer.answer)
                      ? answer.answer.map(String).join('、')
                      : String(answer.answer ?? '未作答')}
                    （{String(answer.earned)}/{String(answer.maxScore)}）
                  </p>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
