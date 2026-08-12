'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
type Mode = 'users' | 'students';
type Row = Record<string, string> & { id: string };
async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, init),
    b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || '操作失败');
  return b;
}
export function DirectoryConsole({ mode }: { mode: Mode }) {
  const [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [keyword, setKeyword] = useState(''),
    [status, setStatus] = useState(''),
    [organization, setOrganization] = useState(''),
    [admissionTerm, setAdmissionTerm] = useState(''),
    [submitted, setSubmitted] = useState({
      keyword: '',
      status: '',
      organization: '',
      admissionTerm: '',
    }),
    [searched, setSearched] = useState(false),
    [editing, setEditing] = useState<Row | null>(null),
    [message, setMessage] = useState('');
  const base = `/api/zhiban/admin/directory/${mode}`;
  function makeQuery(filters: typeof submitted, pageNumber = page) {
    return new URLSearchParams({ ...filters, page: String(pageNumber), pageSize: '10' }).toString();
  }
  async function load(pageNumber: number, filters: typeof submitted) {
    try {
      const b = await api(`${base}?${makeQuery(filters, pageNumber)}`);
      setRows(b.rows);
      setTotal(b.total);
      setPage(pageNumber);
      setSearched(true);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '查询失败');
    }
  }
  function search(e: FormEvent) {
    e.preventDefault();
    const filters = { keyword, status, organization, admissionTerm };
    setSubmitted(filters);
    void load(1, filters);
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const values = Object.fromEntries(
      [...new FormData(e.currentTarget)].filter(([, v]) => String(v).trim()),
    );
    try {
      await api(`${base}/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      setEditing(null);
      setMessage('修改成功');
      await load(page, submitted);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '修改失败');
    }
  }
  const users = mode === 'users';
  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{users ? '用户信息管理' : '学生信息管理'}</h1>
          <p className="mt-1 text-sm text-slate-500">支持查询、修改、分页和按当前条件导出。</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/zhiban/admin/import/${mode}`}
            className="rounded border border-blue-300 px-4 py-2 text-sm text-blue-700"
          >
            导入数据
          </Link>
          <a
            href={
              searched
                ? `/api/zhiban/admin/directory/export/${mode}?${makeQuery(submitted, 1)}`
                : undefined
            }
            aria-disabled={!searched}
            className={`rounded px-4 py-2 text-sm text-white ${searched ? 'bg-blue-600' : 'cursor-not-allowed bg-slate-400'}`}
          >
            导出 Excel
          </a>
        </div>
      </div>
      {message && (
        <div className="mb-4 rounded bg-blue-50 p-3 text-sm text-blue-900">{message}</div>
      )}
      <form
        onSubmit={search}
        className="mb-4 grid gap-3 rounded border bg-white p-4 md:grid-cols-5"
      >
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={users ? '姓名、登录名、手机尾号' : '学号、姓名、班级'}
          className="rounded border px-3 py-2"
        />
        <input
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          placeholder="机构代码或名称"
          className="rounded border px-3 py-2"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border px-3 py-2"
        >
          <option value="">全部状态</option>
          {users ? (
            <>
              <option value="active">正常</option>
              <option value="disabled">停用</option>
            </>
          ) : (
            <>
              <option value="active">在读</option>
              <option value="suspended">休学</option>
              <option value="graduated">毕业</option>
              <option value="withdrawn">退学</option>
            </>
          )}
        </select>
        {!users && (
          <input
            value={admissionTerm}
            onChange={(e) => setAdmissionTerm(e.target.value)}
            placeholder="入学年度学期"
            className="rounded border px-3 py-2"
          />
        )}
        <button className="rounded bg-blue-600 px-4 py-2 text-white">查询</button>
      </form>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              {(users
                ? [
                    '序号',
                    '机构',
                    '姓名',
                    '登录名',
                    '身份',
                    '手机号',
                    '证件号',
                    '来源',
                    '状态',
                    '操作',
                  ]
                : [
                    '序号',
                    '姓名',
                    '学号',
                    '入学学期',
                    '学籍状态',
                    '学生类别',
                    '专业层次',
                    '专业',
                    '学习中心',
                    '班级',
                    '操作',
                  ]
              ).map((x) => (
                <th className="p-3" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => (
              <tr className="border-t" key={r.id}>
                <td className="p-3">{(page - 1) * 10 + index + 1}</td>
                {users ? (
                  <>
                    <td>{r.organization_code || r.organization_name || '-'}</td>
                    <td>{r.display_name}</td>
                    <td>{r.login_name}</td>
                    <td>{r.account_type}</td>
                    <td>{r.mobile_last4 ? `****${r.mobile_last4}` : '-'}</td>
                    <td>{r.identity_last4 ? `**************${r.identity_last4}` : '-'}</td>
                    <td>{r.source_system || 'local'}</td>
                    <td>{r.status}</td>
                  </>
                ) : (
                  <>
                    <td>{r.real_name}</td>
                    <td>{r.student_no}</td>
                    <td>{r.admission_term || '-'}</td>
                    <td>{r.study_status}</td>
                    <td>{r.student_category_name || '-'}</td>
                    <td>{r.program_level_name || '-'}</td>
                    <td>{r.major_name || '-'}</td>
                    <td>{r.learning_center_name || r.learning_center_code || '-'}</td>
                    <td>{r.class_name || r.class_code || '-'}</td>
                  </>
                )}
                <td>
                  <button onClick={() => setEditing(r)} className="text-blue-600">
                    修改
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={10} className="p-12 text-center text-slate-500">
                  {searched ? '没有符合条件的数据' : '请设置查询条件后点击“查询”'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t p-3 text-sm">
          <span>
            共 {total} 条，第 {page} 页
          </span>
          <div className="space-x-2">
            <button
              disabled={page <= 1}
              onClick={() => void load(page - 1, submitted)}
              className="rounded border px-3 py-1 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              disabled={page * 10 >= total}
              onClick={() => void load(page + 1, submitted)}
              className="rounded border px-3 py-1 disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <form
            onSubmit={save}
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded bg-white p-6 shadow-xl"
          >
            <h2 className="mb-4 text-lg font-semibold">修改{users ? '用户' : '学生'}信息</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {users ? (
                <>
                  <Field name="displayName" label="姓名" value={editing.display_name} />
                  <Field name="mobile" label="新手机号" />
                  <label>
                    状态
                    <select
                      name="status"
                      defaultValue={editing.status}
                      className="mt-1 w-full rounded border p-2"
                    >
                      <option value="active">正常</option>
                      <option value="disabled">停用</option>
                    </select>
                  </label>
                  <Field name="password" label="重置密码（至少12位）" type="password" />
                </>
              ) : (
                <>
                  <Field name="realName" label="姓名" value={editing.real_name} />
                  <label>
                    学籍状态
                    <select
                      name="studyStatus"
                      defaultValue={editing.study_status}
                      className="mt-1 w-full rounded border p-2"
                    >
                      <option value="active">在读</option>
                      <option value="suspended">休学</option>
                      <option value="graduated">毕业</option>
                      <option value="withdrawn">退学</option>
                    </select>
                  </label>
                  <Field
                    name="registryStatusCode"
                    label="学籍状态代码"
                    value={editing.registry_status_code}
                  />
                  <Field
                    name="studentCategoryName"
                    label="学生类别"
                    value={editing.student_category_name}
                  />
                  <Field
                    name="programLevelName"
                    label="专业层次"
                    value={editing.program_level_name}
                  />
                  <Field name="majorCode" label="专业代码" value={editing.major_code} />
                  <Field name="majorName" label="专业名称" value={editing.major_name} />
                  <Field name="classCode" label="班级代码" value={editing.class_code} />
                  <Field name="className" label="班级名称" value={editing.class_name} />
                  <Field
                    name="trainingPlanNo"
                    label="培养方案号"
                    value={editing.training_plan_no}
                  />
                </>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded border px-4 py-2"
              >
                取消
              </button>
              <button className="rounded bg-blue-600 px-4 py-2 text-white">保存</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function Field({
  name,
  label,
  value = '',
  type = 'text',
}: {
  name: string;
  label: string;
  value?: string;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value || ''}
        className="mt-1 w-full rounded border p-2"
      />
    </label>
  );
}
