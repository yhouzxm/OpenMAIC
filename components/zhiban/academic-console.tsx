'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BookOpen, GraduationCap, Pencil, School, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AcademicOverview } from '@/lib/zhiban/academic';
import { CourseClassTeacherConsole } from '@/components/zhiban/course-class-teacher-console';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50';

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/zhiban/academic', init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? '操作失败');
  return body as T;
}

export function AcademicConsole() {
  const searchParams = useSearchParams();
  const initialTab = ['terms', 'courses', 'offerings'].includes(searchParams.get('tab') || '')
    ? searchParams.get('tab')!
    : 'terms';
  const [data, setData] = useState<AcademicOverview | null>(null);
  const [editingTerm, setEditingTerm] = useState<AcademicOverview['terms'][number] | null>(null);
  const [editingCourse, setEditingCourse] = useState<AcademicOverview['courses'][number] | null>(
    null,
  );
  const load = useCallback(async () => {
    try {
      setData((await request<{ overview: AcademicOverview }>()).overview);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败');
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>, action: string, afterSave?: () => void) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...Object.fromEntries(new FormData(form)) }),
      });
      form.reset();
      afterSave?.();
      toast.success('保存成功');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function deleteTerm(term: AcademicOverview['terms'][number]) {
    if (!window.confirm(`确认删除学期“${term.name}”吗？`)) return;
    try {
      await request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_term', termId: term.id }),
      });
      toast.success('学期已删除');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  async function deleteCourse(course: AcademicOverview['courses'][number]) {
    if (
      !window.confirm(
        `确认彻底删除课程“${course.name}”吗？\n\n该课程的开课班、学生选课、任课教师关系、课程设置、OpenMAIC 课堂、PBL 项目、成绩、学习画像、智能体及风险干预数据将一并永久删除。此操作不可恢复。`,
      )
    )
      return;
    try {
      await request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_course', courseId: course.id, confirmed: true }),
      });
      toast.success('课程已删除');
      if (editingCourse?.id === course.id) setEditingCourse(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {!data ? (
        <p className="py-20 text-center text-slate-500">正在加载…</p>
      ) : (
        <>
          <section className="mb-6 grid gap-4 sm:grid-cols-3">
            <Summary icon={<School />} label="班级" value={data.classes.length} />
            <Summary icon={<BookOpen />} label="课程" value={data.courses.length} />
            <Summary icon={<GraduationCap />} label="开课班" value={data.offerings.length} />
          </section>
          <Tabs defaultValue={initialTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="terms">学期</TabsTrigger>
              <TabsTrigger value="courses">课程</TabsTrigger>
              <TabsTrigger value="offerings">开课与选课</TabsTrigger>
            </TabsList>
            <TabsContent value="terms">
              <Panel title="学期管理">
                <ActionForm
                  key={editingTerm?.id ?? 'new-term'}
                  onSubmit={(e) =>
                    void submit(e, editingTerm ? 'update_term' : 'create_term', () =>
                      setEditingTerm(null),
                    )
                  }
                >
                  {editingTerm && <input type="hidden" name="termId" value={editingTerm.id} />}
                  <Field label="编码">
                    <Input name="code" defaultValue={editingTerm?.code} required />
                  </Field>
                  <Field label="名称">
                    <Input name="name" defaultValue={editingTerm?.name} required />
                  </Field>
                  <Field label="开始日期">
                    <Input
                      name="startsOn"
                      type="date"
                      defaultValue={editingTerm?.startsOn}
                      required
                    />
                  </Field>
                  <Field label="结束日期">
                    <Input name="endsOn" type="date" defaultValue={editingTerm?.endsOn} required />
                  </Field>
                  <Save label={editingTerm ? '保存修改' : '保存'} />
                  {editingTerm && (
                    <div className="flex items-end">
                      <Button type="button" variant="outline" onClick={() => setEditingTerm(null)}>
                        取消
                      </Button>
                    </div>
                  )}
                </ActionForm>
                <Items>
                  {data.terms.map((term) => (
                    <Item
                      key={term.id}
                      title={term.name}
                      detail={`${term.code} · ${term.startsOn} 至 ${term.endsOn}`}
                      action={
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setEditingTerm(term)}
                          >
                            <Pencil className="mr-2 size-4" />
                            修改
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => void deleteTerm(term)}
                          >
                            <Trash2 className="mr-2 size-4" />
                            删除
                          </Button>
                        </>
                      }
                    />
                  ))}
                </Items>
              </Panel>
            </TabsContent>
            <TabsContent value="courses">
              <Panel title="课程管理">
                <div className="flex justify-end">
                  <Button asChild variant="outline">
                    <Link href="/zhiban/admin/import/registrations">导入课程注册数据</Link>
                  </Button>
                </div>
                <ActionForm
                  key={editingCourse?.id ?? 'new-course'}
                  onSubmit={(e) =>
                    void submit(e, editingCourse ? 'update_course' : 'create_course', () =>
                      setEditingCourse(null),
                    )
                  }
                >
                  {editingCourse && (
                    <input type="hidden" name="courseId" value={editingCourse.id} />
                  )}
                  <Field label="课程编码">
                    <Input name="code" defaultValue={editingCourse?.code} required />
                  </Field>
                  <Field label="课程名称">
                    <Input name="name" defaultValue={editingCourse?.name} required />
                  </Field>
                  <Field label="学分">
                    <Input
                      name="credits"
                      type="number"
                      min={0}
                      step="0.5"
                      defaultValue={editingCourse?.credits ?? ''}
                    />
                  </Field>
                  <Field label="课程负责人">
                    <Select
                      name="ownerTeacherId"
                      optional
                      defaultValue={editingCourse?.ownerTeacherId ?? ''}
                      options={[
                        ...data.teachers.map((x): [string, string] => [x.id, x.displayName]),
                        ...(editingCourse?.ownerTeacherId &&
                        !data.teachers.some(
                          (teacher) => teacher.id === editingCourse.ownerTeacherId,
                        )
                          ? [
                              [
                                editingCourse.ownerTeacherId,
                                editingCourse.ownerTeacherName ?? '原课程负责人',
                              ] as [string, string],
                            ]
                          : []),
                      ]}
                    />
                  </Field>
                  <Save label={editingCourse ? '保存修改' : '保存'} />
                  {editingCourse && (
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEditingCourse(null)}
                      >
                        取消
                      </Button>
                    </div>
                  )}
                </ActionForm>
                <Items>
                  {data.courses.map((x) => (
                    <Item
                      key={x.id}
                      title={x.name}
                      detail={`${x.code} · ${x.credits ?? 0}学分 · 负责人：${x.ownerTeacherName ?? '未设置'}`}
                      action={
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setEditingCourse(x)}
                          >
                            <Pencil className="mr-2 size-4" />
                            修改
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => void deleteCourse(x)}
                          >
                            <Trash2 className="mr-2 size-4" />
                            删除
                          </Button>
                        </>
                      }
                    />
                  ))}
                </Items>
              </Panel>
            </TabsContent>
            <TabsContent value="offerings">
              <Panel title="开课与选课">
                <CourseClassTeacherConsole offerings={data.offerings} />
                <ActionForm onSubmit={(e) => void submit(e, 'create_offering')}>
                  <Field label="课程">
                    <Select name="courseId" options={data.courses.map((x) => [x.id, x.name])} />
                  </Field>
                  <Field label="学期">
                    <Select name="termId" options={data.terms.map((x) => [x.id, x.name])} />
                  </Field>
                  <Field label="关联班级">
                    <Select
                      name="classId"
                      optional
                      options={data.classes.map((x) => [x.id, x.name])}
                    />
                  </Field>
                  <Field label="开课编码">
                    <Input name="code" required />
                  </Field>
                  <Field label="任课教师">
                    <Select
                      name="teacherId"
                      optional
                      options={data.teachers.map((x) => [x.id, x.displayName])}
                    />
                  </Field>
                  <Field label="容量">
                    <Input name="capacity" type="number" min={1} />
                  </Field>
                  <Save />
                </ActionForm>
                <Items>
                  {data.offerings.map((x) => (
                    <Item
                      key={x.id}
                      title={`${x.courseName} · ${x.code}`}
                      detail={`${x.termName} · ${x.className ?? '不限定班级'} · ${x.enrolledCount}/${x.capacity ?? '不限'}`}
                    />
                  ))}
                </Items>
              </Panel>
            </TabsContent>
          </Tabs>
        </>
      )}
    </main>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <span className="rounded-lg bg-teal-50 p-2 text-teal-700">{icon}</span>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}
function ActionForm({
  children,
  onSubmit,
}: {
  children: React.ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-6">
      {children}
    </form>
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
function Select({
  name,
  options,
  optional = false,
  defaultValue,
}: {
  name: string;
  options: [string, string][];
  optional?: boolean;
  defaultValue?: string;
}) {
  return (
    <select className={selectClass} name={name} required={!optional} defaultValue={defaultValue}>
      <option value="">{optional ? '不设置' : '请选择'}</option>
      {options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
function Save({ label = '保存' }: { label?: string }) {
  return (
    <div className="flex items-end">
      <Button type="submit">{label}</Button>
    </div>
  );
}
function Items({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2">{children}</div>;
}
function Item({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">{title}</p>
        <div className="flex items-center gap-2">
          <Badge variant="outline">有效</Badge>
          {action}
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}
