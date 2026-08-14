'use client';
import { useState } from 'react';
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
import type { CourseOffering, AdministrativeClassTeacher } from '@/lib/zhiban/academic';
export function CourseClassTeacherConsole({ offerings }: { offerings: CourseOffering[] }) {
  const [selected, setSelected] = useState<string[]>([]),
    [open, setOpen] = useState(false),
    [rows, setRows] = useState<AdministrativeClassTeacher[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [employeeNo, setEmployeeNo] = useState(''),
    [teacherName, setTeacherName] = useState(''),
    [sameSchool, setSameSchool] = useState(true),
    [teacherId, setTeacherId] = useState(''),
    [jumpPage, setJumpPage] = useState('');
  async function load(next = 1) {
    const q = new URLSearchParams({
        offeringIds: selected.join(','),
        page: String(next),
        employeeNo,
        teacherName,
        sameSchool: String(sameSchool),
      }),
      r = await fetch(`/api/zhiban/academic/course-classes/teachers?${q}`),
      b = await r.json();
    if (!r.ok) throw new Error(b.error || '查询失败');
    setRows(b.rows);
    setTotal(b.total);
    setPage(b.page);
  }
  async function show() {
    if (!selected.length) return toast.error('请先选择课程班');
    setOpen(true);
    try {
      await load(1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '查询失败');
    }
  }
  async function assign() {
    const r = await fetch('/api/zhiban/academic/course-classes/teachers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offeringIds: selected, teacherId }),
      }),
      b = await r.json();
    if (!r.ok) return toast.error(b.error || '安排失败');
    toast.success('教师安排成功');
    setOpen(false);
    setSelected([]);
  }
  return (
    <div className="space-y-3">
      <Button onClick={() => void show()}>安排教师</Button>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th></th>
              <th>教学班号</th>
              <th>课程班名称</th>
              <th>课程</th>
              <th>选课人数</th>
            </tr>
          </thead>
          <tbody>
            {offerings.map((o) => (
              <tr key={o.id} className="border-t">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(o.id)}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked ? [...s, o.id] : s.filter((id) => id !== o.id),
                      )
                    }
                  />
                </td>
                <td>{o.code}</td>
                <td>{o.name || '-'}</td>
                <td>{o.courseName}</td>
                <td>{o.enrolledCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>安排教师</DialogTitle>
            <DialogDescription>为已选择的课程班安排教师。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_100px_auto]">
            <Input
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              placeholder="工号"
            />
            <Input
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              placeholder="姓名"
            />
            <span className="py-2">是否本校：</span>
            <select
              value={String(sameSchool)}
              onChange={(e) => setSameSchool(e.target.value === 'true')}
              className="rounded border"
            >
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
            <Button onClick={() => void load(1)}>查询</Button>
          </div>
          <div className="max-h-80 overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th></th>
                  <th>工号</th>
                  <th>姓名</th>
                  <th>学习中心</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-3">
                      <input
                        type="radio"
                        checked={teacherId === t.id}
                        onChange={() => setTeacherId(t.id)}
                      />
                    </td>
                    <td>{t.identifier}</td>
                    <td>{t.displayName}</td>
                    <td>{t.organizationName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between text-sm">
            <span>每页10条记录，共 {total} 条记录</span>
            <div>
              <Button variant="outline" disabled={page <= 1} onClick={() => void load(page - 1)}>
                上一页
              </Button>
              <span className="px-3">
                第 {page} / {Math.max(1, Math.ceil(total / 10))} 页
              </span>
              <Button
                variant="outline"
                disabled={page * 10 >= total}
                onClick={() => void load(page + 1)}
              >
                下一页
              </Button>
              <Input
                className="ml-2 inline-block h-9 w-20"
                value={jumpPage}
                onChange={(e) => setJumpPage(e.target.value)}
                placeholder="页码"
              />
              <Button
                variant="outline"
                onClick={() => {
                  const target = Number(jumpPage),
                    max = Math.max(1, Math.ceil(total / 10));
                  if (!Number.isInteger(target) || target < 1 || target > max)
                    return toast.error('请输入有效页码');
                  void load(target);
                }}
              >
                跳转
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={!teacherId} onClick={() => void assign()}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
