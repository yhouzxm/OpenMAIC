'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, GraduationCap, RefreshCw, School, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AcademicOverview } from '@/lib/zhiban/academic';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50';

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/zhiban/academic', init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? '操作失败');
  return body as T;
}

export function AcademicConsole() {
  const [data, setData] = useState<AcademicOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData((await request<{ overview: AcademicOverview }>()).overview);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...Object.fromEntries(new FormData(form)) }),
      });
      form.reset();
      toast.success('保存成功');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-center justify-between rounded-2xl bg-slate-950 px-6 py-5 text-white shadow-xl">
        <div>
          <p className="text-sm text-teal-300">智伴·创学管理中心</p>
          <h1 className="mt-1 text-2xl font-semibold">班级、课程与选课</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link href="/zhiban/admin/import">批量导入</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/zhiban/admin">
              <ArrowLeft className="mr-2 size-4" />
              账号与权限
            </Link>
          </Button>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </header>
      {!data ? (
        <p className="py-20 text-center text-slate-500">正在加载…</p>
      ) : (
        <>
          <section className="mb-6 grid gap-4 sm:grid-cols-4">
            <Summary icon={<School />} label="班级" value={data.classes.length} />
            <Summary icon={<BookOpen />} label="课程" value={data.courses.length} />
            <Summary icon={<GraduationCap />} label="开课班" value={data.offerings.length} />
            <Summary icon={<Users />} label="选课记录" value={data.enrollments.length} />
          </section>
          <Tabs defaultValue="terms">
            <TabsList className="mb-4">
              <TabsTrigger value="terms">学期</TabsTrigger>
              <TabsTrigger value="classes">班级</TabsTrigger>
              <TabsTrigger value="courses">课程</TabsTrigger>
              <TabsTrigger value="offerings">开课与选课</TabsTrigger>
            </TabsList>
            <TabsContent value="terms">
              <Panel title="学期管理">
                <ActionForm onSubmit={(e) => void submit(e, 'create_term')}>
                  <Field label="编码">
                    <Input name="code" required />
                  </Field>
                  <Field label="名称">
                    <Input name="name" required />
                  </Field>
                  <Field label="开始日期">
                    <Input name="startsOn" type="date" required />
                  </Field>
                  <Field label="结束日期">
                    <Input name="endsOn" type="date" required />
                  </Field>
                  <Save />
                </ActionForm>
                <Items>
                  {data.terms.map((term) => (
                    <Item
                      key={term.id}
                      title={term.name}
                      detail={`${term.code} · ${term.startsOn} 至 ${term.endsOn}`}
                    />
                  ))}
                </Items>
              </Panel>
            </TabsContent>
            <TabsContent value="classes">
              <Panel title="班级管理">
                <ActionForm onSubmit={(e) => void submit(e, 'create_class')}>
                  <Field label="学期">
                    <Select name="termId" options={data.terms.map((x) => [x.id, x.name])} />
                  </Field>
                  <Field label="编码">
                    <Input name="code" required />
                  </Field>
                  <Field label="名称">
                    <Input name="name" required />
                  </Field>
                  <Field label="班主任">
                    <Select
                      name="headTeacherId"
                      optional
                      options={data.teachers.map((x) => [
                        x.id,
                        `${x.displayName}（${x.identifier}）`,
                      ])}
                    />
                  </Field>
                  <Field label="人数上限">
                    <Input name="capacity" type="number" min={1} />
                  </Field>
                  <Save />
                </ActionForm>
                <ActionForm onSubmit={(e) => void submit(e, 'add_class_member')}>
                  <Field label="加入班级">
                    <Select name="classId" options={data.classes.map((x) => [x.id, x.name])} />
                  </Field>
                  <Field label="学生">
                    <Select
                      name="studentId"
                      options={data.students.map((x) => [
                        x.id,
                        `${x.displayName}（${x.identifier}）`,
                      ])}
                    />
                  </Field>
                  <Save label="添加学生" />
                </ActionForm>
                <Items>
                  {data.classes.map((x) => (
                    <Item
                      key={x.id}
                      title={x.name}
                      detail={`${x.code} · 班主任：${x.headTeacherName ?? '未设置'} · ${x.memberCount}人`}
                    />
                  ))}
                </Items>
              </Panel>
            </TabsContent>
            <TabsContent value="courses">
              <Panel title="课程管理">
                <ActionForm onSubmit={(e) => void submit(e, 'create_course')}>
                  <Field label="课程编码">
                    <Input name="code" required />
                  </Field>
                  <Field label="课程名称">
                    <Input name="name" required />
                  </Field>
                  <Field label="学分">
                    <Input name="credits" type="number" min={0} step="0.5" />
                  </Field>
                  <Field label="课程负责人">
                    <Select
                      name="ownerTeacherId"
                      optional
                      options={data.teachers.map((x) => [x.id, x.displayName])}
                    />
                  </Field>
                  <Save />
                </ActionForm>
                <Items>
                  {data.courses.map((x) => (
                    <Item
                      key={x.id}
                      title={x.name}
                      detail={`${x.code} · ${x.credits ?? 0}学分 · 负责人：${x.ownerTeacherName ?? '未设置'}`}
                    />
                  ))}
                </Items>
              </Panel>
            </TabsContent>
            <TabsContent value="offerings">
              <Panel title="开课与选课">
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
                <ActionForm onSubmit={(e) => void submit(e, 'enroll_student')}>
                  <Field label="开课班">
                    <Select
                      name="offeringId"
                      options={data.offerings.map((x) => [x.id, `${x.courseName} / ${x.code}`])}
                    />
                  </Field>
                  <Field label="学生">
                    <Select
                      name="studentId"
                      options={data.students.map((x) => [
                        x.id,
                        `${x.displayName}（${x.identifier}）`,
                      ])}
                    />
                  </Field>
                  <Save label="登记选课" />
                </ActionForm>
                <Items>
                  {data.offerings.map((x) => (
                    <Item
                      key={x.id}
                      title={`${x.courseName} · ${x.code}`}
                      detail={`${x.termName} · ${x.className ?? '不限定班级'} · ${x.enrolledCount}/${x.capacity ?? '不限'}`}
                    />
                  ))}
                  {data.enrollments.map((x) => (
                    <Item
                      key={x.id}
                      title={`${x.studentName} → ${x.offeringCode}`}
                      detail={`${x.studentNo} · ${x.status}`}
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
}: {
  name: string;
  options: [string, string][];
  optional?: boolean;
}) {
  return (
    <select className={selectClass} name={name} required={!optional}>
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
function Item({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">{title}</p>
        <Badge variant="outline">有效</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}
