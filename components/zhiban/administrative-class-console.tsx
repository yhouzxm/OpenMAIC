'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AdministrativeClassRecord, AdministrativeClassTeacher } from '@/lib/zhiban/academic';

type Result = { rows: AdministrativeClassRecord[]; total: number; page: number; pageSize: number };
type TeacherResult = {
  rows: AdministrativeClassTeacher[];
  total: number;
  page: number;
  pageSize: number;
};
export function AdministrativeClassConsole() {
  const [result, setResult] = useState<Result | null>(null),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [teacherId, setTeacherId] = useState(''),
    [teacherEmployeeNo, setTeacherEmployeeNo] = useState(''),
    [teacherName, setTeacherName] = useState(''),
    [submittedEmployeeNo, setSubmittedEmployeeNo] = useState(''),
    [submittedTeacherName, setSubmittedTeacherName] = useState(''),
    [sameSchool, setSameSchool] = useState(true),
    [teacherResult, setTeacherResult] = useState<TeacherResult | null>(null),
    [jumpPage, setJumpPage] = useState(''),
    [editOpen, setEditOpen] = useState(false),
    [editingClass, setEditingClass] = useState<AdministrativeClassRecord | null>(null),
    [assignOpen, setAssignOpen] = useState(false),
    [removeOpen, setRemoveOpen] = useState(false);
  async function load(page = 1, form?: HTMLFormElement) {
    setBusy(true);
    try {
      const data = new FormData(form),
        params = new URLSearchParams({ page: String(page) });
      for (const key of ['keyword', 'admissionTerm', 'major', 'organization', 'headTeacher']) {
        const value = String(data.get(key) || '').trim();
        if (value) params.set(key, value);
      }
      const response = await fetch(`/api/zhiban/academic/administrative-classes?${params}`),
        body = await response.json();
      if (!response.ok) throw new Error(body.error || '查询失败');
      setResult(body);
      setQuery(params.toString());
      setSelected([]);
      setAssignOpen(false);
      setRemoveOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '查询失败');
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await load(1, event.currentTarget);
  }
  async function assign(remove = false) {
    if (!selected.length) return toast.error('请先选择行政班');
    if (!remove && !teacherId) return toast.error('请选择班主任');
    setBusy(true);
    try {
      for (const id of selected) {
        const response = await fetch(
            `/api/zhiban/academic/administrative-classes/${id}/head-teacher`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ teacherId: remove ? null : teacherId }),
            },
          ),
          body = await response.json();
        if (!response.ok) throw new Error(body.error || '操作失败');
      }
      toast.success(remove ? '班主任已移除' : '班主任安排成功');
      const params = new URLSearchParams(query);
      const response = await fetch(`/api/zhiban/academic/administrative-classes?${params}`);
      setResult(await response.json());
      setSelected([]);
      if (remove) setRemoveOpen(false);
      else setAssignOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  async function loadTeachers(
    page = 1,
    employeeNo = submittedEmployeeNo,
    name = submittedTeacherName,
    local = sameSchool,
  ) {
    setBusy(true);
    try {
      const params = new URLSearchParams({
        classIds: selected.join(','),
        page: String(page),
        sameSchool: String(local),
      });
      if (employeeNo) params.set('employeeNo', employeeNo);
      if (name) params.set('teacherName', name);
      const response = await fetch(
          `/api/zhiban/academic/administrative-classes/teachers?${params}`,
        ),
        body = await response.json();
      if (!response.ok) throw new Error(body.error || '教师查询失败');
      setTeacherResult(body);
      setSubmittedEmployeeNo(employeeNo);
      setSubmittedTeacherName(name);
      setJumpPage('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '教师查询失败');
    } finally {
      setBusy(false);
    }
  }
  async function openAssign() {
    if (!selected.length) return toast.error('请先选择行政班');
    setTeacherId('');
    setTeacherEmployeeNo('');
    setTeacherName('');
    setSubmittedEmployeeNo('');
    setSubmittedTeacherName('');
    setSameSchool(true);
    setAssignOpen(true);
    await loadTeachers(1, '', '', true);
  }
  async function saveClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch(
          editingClass
            ? `/api/zhiban/academic/administrative-classes/${editingClass.id}/details`
            : '/api/zhiban/academic/administrative-classes/manage',
          {
            method: editingClass ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        ),
        body = await response.json();
      if (!response.ok) throw new Error(body.error || '保存失败');
      toast.success(editingClass ? '修改成功' : '新建成功');
      setEditOpen(false);
      if (result) {
        const params = new URLSearchParams(query),
          refresh = await fetch(`/api/zhiban/academic/administrative-classes?${params}`);
        setResult(await refresh.json());
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  async function deleteClasses() {
    if (!selected.length) return toast.error('请先选择要删除的行政班');
    if (
      !window.confirm(
        `确认删除选中的 ${selected.length} 个行政班吗？\n\n系统将解除这些行政班的学生成员关系、课程班关联和班主任权限，但不会删除学生账号、课程或课程班。此操作不可恢复。`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch('/api/zhiban/academic/administrative-classes/manage', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: selected, confirmed: true }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error || '删除失败');
      toast.success(`已删除 ${body.result.deleted} 个行政班`);
      setSelected([]);
      const params = new URLSearchParams(query),
        refresh = await fetch(`/api/zhiban/academic/administrative-classes?${params}`);
      setResult(await refresh.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <form
        onSubmit={submit}
        className="grid gap-3 rounded-lg border bg-slate-50 p-4 md:grid-cols-3"
      >
        <Input name="keyword" placeholder="班级编码 / 班级名称" />
        <Input name="admissionTerm" placeholder="入学年度学期，如 2026春" />
        <Input name="major" placeholder="专业代码 / 专业名称" />
        <Input name="organization" placeholder="分校 / 学习中心代码" />
        <Input name="headTeacher" placeholder="班主任名称" />
        <div className="flex gap-2">
          <Button disabled={busy}>查询</Button>
          <Button type="reset" variant="outline">
            重置
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            setEditingClass(null);
            setEditOpen(true);
          }}
        >
          新建
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            if (selected.length !== 1) return toast.error('请选择一个行政班进行修改');
            setBusy(true);
            try {
              const response = await fetch(
                  `/api/zhiban/academic/administrative-classes/${selected[0]}/details`,
                ),
                body = await response.json();
              if (!response.ok) throw new Error(body.error || '读取失败');
              setEditingClass(body.record);
              setEditOpen(true);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : '读取失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          修改
        </Button>
        <Button disabled={busy} variant="destructive" onClick={() => void deleteClasses()}>
          删除
        </Button>
        <Button asChild variant="outline">
          <a
            href={
              result ? `/api/zhiban/academic/administrative-classes/export?${query}` : undefined
            }
            aria-disabled={!result}
          >
            导出
          </a>
        </Button>
        <Button disabled={busy} onClick={() => void openAssign()}>
          安排班主任
        </Button>
        <Button
          disabled={busy}
          variant="destructive"
          onClick={() => (selected.length ? setRemoveOpen(true) : toast.error('请先选择行政班'))}
        >
          移除班主任
        </Button>
        <Button asChild variant="outline">
          <Link href="/zhiban/admin/import/classes">导入行政班</Link>
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3">
                <input
                  type="checkbox"
                  checked={!!result?.rows.length && selected.length === result.rows.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? result?.rows.map((r) => r.id) || [] : [])
                  }
                />
              </th>
              {[
                '序号',
                '入学年度学期',
                '班级编码',
                '班级名称',
                '班主任',
                '班级人数',
                '学生类别',
                '所属学院',
                '所属学习中心',
                '专业代码',
                '专业名称',
              ].map((x) => (
                <th key={x} className="p-3 text-left">
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result?.rows.map((r, i) => (
              <tr key={r.id} className="border-t">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id),
                      )
                    }
                  />
                </td>
                <td>{(result.page - 1) * 10 + i + 1}</td>
                <td>{r.admissionTerm}</td>
                <td>{r.code}</td>
                <td>{r.name}</td>
                <td>{r.headTeacherName || '未安排'}</td>
                <td>{r.expectedSize ?? r.memberCount}</td>
                <td>{r.studentCategory}</td>
                <td>{r.branchName}</td>
                <td>{r.studyCenterName}</td>
                <td>{r.majorCode}</td>
                <td>{r.majorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!result ? (
          <p className="p-12 text-center text-slate-500">请设置条件后点击查询</p>
        ) : !result.rows.length ? (
          <p className="p-12 text-center text-slate-500">暂无符合条件的行政班</p>
        ) : null}
      </div>
      {result && (
        <div className="flex items-center justify-between text-sm">
          <span>共 {result.total} 条，每页 10 条</span>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
            <Button
              variant="outline"
              disabled={result.page <= 1 || busy}
              onClick={() => {
                const p = new URLSearchParams(query);
                p.set('page', String(result.page - 1));
                fetch(`/api/zhiban/academic/administrative-classes?${p}`)
                  .then((r) => r.json())
                  .then(setResult);
              }}
            >
              上一页
            </Button>
            <span className="px-2 py-2">{result.page}</span>
            <Button
              variant="outline"
              disabled={result.page * 10 >= result.total || busy}
              onClick={() => {
                const p = new URLSearchParams(query);
                p.set('page', String(result.page + 1));
                fetch(`/api/zhiban/academic/administrative-classes?${p}`)
                  .then((r) => r.json())
                  .then(setResult);
              }}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>安排班主任</DialogTitle>
            <DialogDescription>
              已选择 {selected.length} 个行政班，请选择一名教师作为班主任。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_110px_auto_auto] md:items-center">
            <Input
              value={teacherEmployeeNo}
              onChange={(e) => setTeacherEmployeeNo(e.target.value)}
              placeholder="工号"
            />
            <Input
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              placeholder="姓名"
            />
            <span className="whitespace-nowrap text-sm">是否本校：</span>
            <select
              value={sameSchool ? 'true' : 'false'}
              onChange={(e) => setSameSchool(e.target.value === 'true')}
              className="h-9 rounded-md border bg-white px-3 text-sm"
            >
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
            <Button
              onClick={() => void loadTeachers(1, teacherEmployeeNo, teacherName, sameSchool)}
            >
              查询
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setTeacherEmployeeNo('');
                setTeacherName('');
                setSameSchool(true);
                void loadTeachers(1, '', '', true);
              }}
            >
              重置
            </Button>
          </div>
          <div className="max-h-80 overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="p-3"></th>
                  <th className="text-left">工号</th>
                  <th className="text-left">姓名</th>
                  <th className="text-left">学习中心</th>
                </tr>
              </thead>
              <tbody>
                {teacherResult?.rows.map((t) => (
                  <tr key={t.id} className="border-t hover:bg-blue-50">
                    <td className="p-3">
                      <input
                        type="radio"
                        name="headTeacher"
                        checked={teacherId === t.id}
                        onChange={() => setTeacherId(t.id)}
                      />
                    </td>
                    <td>{t.identifier}</td>
                    <td>{t.displayName}</td>
                    <td>
                      {t.organizationName || '未设置'}
                      {t.organizationCode ? `（${t.organizationCode}）` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>每页 10 条记录，共 {teacherResult?.total ?? 0} 条记录</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!teacherResult || teacherResult.page <= 1 || busy}
                onClick={() => void loadTeachers((teacherResult?.page || 1) - 1)}
              >
                上一页
              </Button>
              <span>
                第 {teacherResult?.page ?? 1} /{' '}
                {Math.max(1, Math.ceil((teacherResult?.total ?? 0) / 10))} 页
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!teacherResult || teacherResult.page * 10 >= teacherResult.total || busy}
                onClick={() => void loadTeachers((teacherResult?.page || 1) + 1)}
              >
                下一页
              </Button>
              <Input
                className="h-8 w-20"
                value={jumpPage}
                onChange={(e) => setJumpPage(e.target.value)}
                placeholder="页码"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const page = Number(jumpPage),
                    max = Math.max(1, Math.ceil((teacherResult?.total ?? 0) / 10));
                  if (!Number.isInteger(page) || page < 1 || page > max)
                    return toast.error('请输入有效页码');
                  void loadTeachers(page);
                }}
              >
                跳转
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              取消
            </Button>
            <Button disabled={busy || !teacherId} onClick={() => void assign(false)}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingClass ? '修改行政班' : '新建行政班'}</DialogTitle>
            <DialogDescription>
              填写行政班基本信息，学习中心代码必须存在于机构树。
            </DialogDescription>
          </DialogHeader>
          <form
            key={editingClass?.id ?? 'new-class'}
            onSubmit={saveClass}
            className="grid gap-3 md:grid-cols-2"
          >
            <Input
              name="code"
              defaultValue={editingClass?.code || ''}
              placeholder="班级编码"
              required
            />
            <Input
              name="name"
              defaultValue={editingClass?.name || ''}
              placeholder="班级名称"
              required
            />
            <Input
              name="admissionTerm"
              defaultValue={editingClass?.admissionTerm || ''}
              placeholder="入学年度学期，如2026春"
              required
            />
            <Input
              name="studyCenterCode"
              defaultValue={editingClass?.studyCenterCode || ''}
              placeholder="学习中心代码"
              required
            />
            {editingClass && (
              <label className="space-y-1 text-sm">
                <span>当前学生人数</span>
                <Input type="number" value={editingClass.memberCount} readOnly />
              </label>
            )}
            <label className="space-y-1 text-sm">
              <span>最大人数</span>
              <Input
                name="expectedSize"
                type="number"
                min="0"
                defaultValue={editingClass?.expectedSize ?? ''}
                placeholder="最大人数"
              />
            </label>
            <Input
              name="studentCategory"
              defaultValue={editingClass?.studentCategory || ''}
              placeholder="学生类别"
            />
            <Input
              name="majorCode"
              defaultValue={editingClass?.majorCode || ''}
              placeholder="专业代码"
            />
            <Input
              name="majorName"
              defaultValue={editingClass?.majorName || ''}
              placeholder="专业名称"
            />
            <Input
              name="trainingPlanNo"
              defaultValue={editingClass?.trainingPlanNo || ''}
              placeholder="培养方案号"
              className="md:col-span-2"
            />
            <DialogFooter className="md:col-span-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                取消
              </Button>
              <Button disabled={busy}>确定</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>提示</DialogTitle>
            <DialogDescription>
              确认要移除选中 {selected.length} 个行政班的班主任吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>
              取消
            </Button>
            <Button disabled={busy} onClick={() => void assign(true)}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
