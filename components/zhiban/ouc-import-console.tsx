'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

type Mode = 'users' | 'students' | 'registrations' | 'classes';
type Batch = {
  id: string;
  status: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  file_name?: string;
  users_file_name?: string;
  students_file_name?: string;
  error_message?: string;
};
type ValidationIssue = { rowNumber: number; key?: string; errors: string[] };
const meta = {
  users: {
    title: '用户数据导入',
    description: '导入账号、手机号、证件信息、所属机构和用户身份。',
    file: '用户表（users.xlsx）',
  },
  students: {
    title: '学生数据导入',
    description: '根据学号关联已导入的用户账号，补充学籍、班级、专业和学习中心信息。',
    file: '学生信息.xlsx',
  },
  registrations: {
    title: '课程注册数据导入',
    description:
      '关联已有行政班，导入课程、开课实例及学生选课注册关系；不存在对应行政班时禁止导入。',
    file: '学生课程注册明细.xlsx',
  },
  classes: {
    title: '行政班数据导入',
    description: '导入行政班、专业、培养方案、所属机构及班主任信息。',
    file: '班级信息.xlsx',
  },
} as const;

async function jsonResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
  return body;
}

export function OucImportConsole({ mode }: { mode: Mode }) {
  const [batches, setBatches] = useState<Batch[]>([]),
    [message, setMessage] = useState(''),
    [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]),
    [busy, setBusy] = useState(false);
  const identity = mode === 'users' || mode === 'students';
  const base = identity
    ? '/api/zhiban/import/ouc-identity'
    : mode === 'classes'
      ? '/api/zhiban/import/administrative-classes'
      : '/api/zhiban/import/course-registration';
  const reload = useCallback(async () => {
    const body = await jsonResponse(await fetch(base));
    const rows: Batch[] = body.batches ?? [];
    setBatches(
      identity
        ? rows.filter((b) =>
            mode === 'students'
              ? b.users_file_name === '__student_only__'
              : b.users_file_name !== '__student_only__',
          )
        : rows,
    );
  }, [base, identity, mode]);
  useEffect(() => {
    const timer = window.setTimeout(() => reload().catch((e) => setMessage(e.message)), 0);
    return () => clearTimeout(timer);
  }, [reload]);
  const selected = useMemo(() => meta[mode], [mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setValidationIssues([]);
    setMessage('正在预检文件，不会写入业务数据…');
    try {
      const form = new FormData(event.currentTarget);
      if (identity) form.set('mode', mode);
      const result = await jsonResponse(await fetch(base, { method: 'POST', body: form }));
      setValidationIssues(result.rows ?? []);
      setMessage(
        `预检完成：有效 ${result.validRows} 行，无效 ${result.invalidRows} 行。全部有效后请点击“确认执行”。`,
      );
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '预检失败');
    } finally {
      setBusy(false);
    }
  }
  async function act(id: string, action: 'execute' | 'rollback' | 'delete', status?: string) {
    if (
      action === 'rollback' &&
      !confirm('确认回滚该批次？如存在后续业务引用，系统会停止回滚且不执行部分删除。')
    )
      return;
    if (
      action === 'delete' &&
      !confirm(
        status === 'completed'
          ? '确认删除该导入批次记录吗？已成功导入的业务数据会保留，删除后将无法再通过该批次回滚。'
          : '确认删除该导入批次吗？批次明细和预检记录将一并删除。',
      )
    )
      return;
    setBusy(true);
    try {
      await jsonResponse(
        await fetch(
          action === 'delete'
            ? `${base}?batchId=${encodeURIComponent(id)}`
            : `${base}/${id}/${action}`,
          { method: action === 'delete' ? 'DELETE' : 'POST' },
        ),
      );
      setMessage(
        action === 'execute'
          ? '批次执行成功。'
          : action === 'rollback'
            ? '批次回滚完成。'
            : '导入批次已删除。',
      );
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="p-6">
      <div className="mb-5 border-b bg-white px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="mt-1 text-2xl font-semibold">{selected.title}</h1>
          </div>
          {(identity || mode === 'classes' || mode === 'registrations') && (
            <Link
              href={
                mode === 'users'
                  ? '/zhiban/admin/users'
                  : mode === 'registrations'
                    ? '/zhiban/admin/academic?tab=courses'
                    : mode === 'classes'
                      ? '/zhiban/admin/students?tab=classes'
                      : '/zhiban/admin/students?tab=students'
              }
              className="flex items-center rounded border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="mr-2 size-4" />
              返回
              {mode === 'users' ? '用户管理' : mode === 'registrations' ? '教学管理' : '学籍管理'}
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">{selected.description}</p>
      </div>
      {message && (
        <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {message}
        </div>
      )}
      {validationIssues.length > 0 && (
        <section className="mb-4 rounded border border-red-200 bg-red-50 p-4 text-sm">
          <h2 className="font-medium text-red-800">预检失败明细</h2>
          <div className="mt-2 max-h-64 overflow-auto">
            {validationIssues.map((issue) => (
              <div key={`${issue.rowNumber}-${issue.key}`} className="border-t border-red-100 py-2">
                第 {issue.rowNumber} 行{issue.key ? `（${issue.key}）` : ''}：
                {issue.errors.join('；')}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="rounded border bg-white p-5 shadow-sm">
        <form className="grid gap-4 md:grid-cols-3" onSubmit={submit}>
          <label className="md:col-span-2">
            {selected.file}
            <input
              required
              name="file"
              type="file"
              accept=".xlsx"
              className="mt-1 block w-full rounded border p-2"
            />
          </label>
          <div className="flex items-end gap-3">
            <a
              href={`/api/zhiban/import/templates/${mode}`}
              download
              className="rounded border border-blue-300 px-5 py-2 text-blue-700 hover:bg-blue-50"
            >
              下载标准模板
            </a>
            <button
              disabled={busy}
              className="rounded bg-[#1677e8] px-5 py-2 text-white disabled:opacity-50"
            >
              上传并预检
            </button>
          </div>
        </form>
        {mode === 'users' && (
          <p className="mt-3 text-sm text-slate-500">
            所属机构和身份均从 Excel
            读取；身份只允许填写“学生、教师”。管理员权限请在权限管理中授予教师。
          </p>
        )}
      </section>
      <section className="mt-5 overflow-hidden rounded border bg-white shadow-sm">
        <div className="border-b px-5 py-4 font-medium">导入批次</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="p-3">文件</th>
                <th>状态</th>
                <th>有效行</th>
                <th>无效行</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="p-3">
                    {b.file_name || b.students_file_name || b.users_file_name}
                  </td>
                  <td>
                    {b.status}
                    {b.error_message ? `：${b.error_message}` : ''}
                  </td>
                  <td>
                    {b.valid_rows}/{b.total_rows}
                  </td>
                  <td>{b.invalid_rows}</td>
                  <td className="space-x-2">
                    {b.status === 'validated' && b.invalid_rows === 0 && (
                      <button
                        disabled={busy}
                        onClick={() => act(b.id, 'execute')}
                        className="rounded bg-blue-600 px-3 py-1 text-white"
                      >
                        确认执行
                      </button>
                    )}
                    {b.status === 'completed' && (
                      <button
                        disabled={busy}
                        onClick={() => act(b.id, 'rollback')}
                        className="rounded border border-red-300 px-3 py-1 text-red-700"
                      >
                        回滚
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => act(b.id, 'delete', b.status)}
                      className="rounded border border-red-300 px-3 py-1 text-red-700"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {!batches.length && (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-slate-500">
                    暂无导入批次
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
