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
export function DirectoryConsole({ mode, embedded = false }: { mode: Mode; embedded?: boolean }) {
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
    [deleting, setDeleting] = useState<Row | null>(null),
    [creating, setCreating] = useState(false),
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
  async function openEdit(row: Row) {
    if (mode !== 'users') return setEditing(row);
    try {
      setEditing(await api(`${base}/${row.id}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取用户信息失败');
    }
  }
  async function removeUser() {
    if (!deleting) return;
    try {
      await api(`${base}/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      setMessage('用户已删除，登录会话和权限已撤销');
      await load(page, submitted);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除用户失败');
    }
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
  async function createUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget)),
      type = String(values.accountType);
    const body: Record<string, FormDataEntryValue | string> = {
      ...values,
      ...(type === 'student' ? { initialRoleCode: 'student', initialRoleScopeType: 'self' } : {}),
      ...(type === 'student'
        ? { studentNo: values.identifier }
        : { employeeNo: values.identifier }),
    };
    delete body.identifier;
    try {
      await api('/api/zhiban/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setCreating(false);
      setMessage('用户创建成功');
      if (searched) await load(page, submitted);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建失败');
    }
  }
  const users = mode === 'users';
  return (
    <div className={embedded ? '' : 'p-6'}>
      <div className={`mb-4 flex items-center justify-between ${embedded ? 'justify-end' : ''}`}>
        {!embedded && (
          <div>
            <h1 className="text-xl font-semibold">{users ? '用户管理' : '学籍管理'}</h1>
            <p className="mt-1 text-sm text-slate-500">支持查询、修改、分页和按当前条件导出。</p>
          </div>
        )}
        <div className="flex gap-2">
          {users && (
            <button
              onClick={() => setCreating(true)}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
            >
              新建用户
            </button>
          )}
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
                    '真实姓名',
                    '登录名',
                    '身份',
                    '学号 / 工号',
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
                    <td>{r.organization_name || '-'}</td>
                    <td>{r.real_name}</td>
                    <td>{r.login_name}</td>
                    <td>{r.account_type === 'student' ? '学生' : '教师'}</td>
                    <td>{r.account_type === 'student' ? r.student_no : r.employee_no}</td>
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
                  <button onClick={() => void openEdit(r)} className="text-blue-600">
                    修改
                  </button>
                  {users && r.login_name.toLowerCase() !== 'admin' && (
                    <button onClick={() => setDeleting(r)} className="ml-3 text-red-600">
                      删除
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={11} className="p-12 text-center text-slate-500">
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
                  <Field name="realName" label="真实姓名" value={editing.real_name} />
                  <Field name="mobile" label="手机号" value={editing.mobile} />
                  <ReadOnly label="登录名" value={editing.login_name} />
                  <ReadOnly
                    label="用户身份"
                    value={editing.account_type === 'student' ? '学生' : '教师'}
                  />
                  <ReadOnly label="所属机构" value={editing.organization_name} />
                  {editing.account_type === 'student' ? (
                    <ReadOnly label="学号" value={editing.student_no} />
                  ) : (
                    <ReadOnly label="工号" value={editing.employee_no} />
                  )}
                  <ReadOnly label="出生日期" value={editing.birth_date} />
                  <ReadOnly label="证件类型" value={editing.identity_document_type} />
                  <ReadOnly label="证件号码" value={editing.identity_number} />
                  {editing.account_type === 'student' ? (
                    <>
                      <ReadOnly label="入学年份" value={editing.enrollment_year} />
                      <ReadOnly label="学历层次" value={editing.education_level} />
                      <ReadOnly
                        label="专业"
                        value={[editing.major_code, editing.major_name].filter(Boolean).join(' · ')}
                      />
                      <ReadOnly label="学习中心" value={editing.learning_center} />
                      <ReadOnly label="学籍状态" value={editing.study_status} />
                      <ReadOnly label="入学学期" value={editing.admission_term} />
                      <ReadOnly
                        label="行政班"
                        value={[editing.class_code, editing.class_name].filter(Boolean).join(' · ')}
                      />
                    </>
                  ) : (
                    <>
                      <ReadOnly label="部门" value={editing.department} />
                      <ReadOnly label="职称" value={editing.professional_title} />
                      <ReadOnly label="任职状态" value={editing.employment_status} />
                    </>
                  )}
                  <ReadOnly label="数据来源" value={editing.source_system || 'local'} />
                  <ReadOnly label="来源标识" value={editing.source_external_id} />
                  <ReadOnly label="来源创建时间" value={editing.source_created_at} />
                  <ReadOnly label="创建时间" value={editing.created_at} />
                  <ReadOnly label="更新时间" value={editing.updated_at} />
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
                  <Field name="password" label="重置密码（至少8位）" type="password" />
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
      {users && deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">删除用户</h2>
            <p className="mt-3 text-sm text-slate-600">
              确认删除“{deleting.real_name || deleting.login_name}
              ”吗？该账号将被停用，现有登录会话及权限将立即撤销，审计记录会保留。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="rounded border px-4 py-2">
                取消
              </button>
              <button
                onClick={() => void removeUser()}
                className="rounded bg-red-600 px-4 py-2 text-white"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
      {users && creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={createUser} className="w-full max-w-xl rounded bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">新建用户</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label>
                用户身份
                <select name="accountType" className="mt-1 w-full rounded border p-2">
                  <option value="student">学生</option>
                  <option value="teacher">教师</option>
                </select>
              </label>
              <Field name="realName" label="真实姓名" />
              <Field name="identifier" label="登录名（学生填学号，教师填工号）" />
              <Field name="mobile" label="手机号" />
              <Field name="password" label="初始密码（至少8位）" type="password" />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded border px-4 py-2"
              >
                取消
              </button>
              <button className="rounded bg-blue-600 px-4 py-2 text-white">创建</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function ReadOnly({ label, value }: { label: string; value?: string }) {
  return (
    <label className="text-sm text-slate-600">
      {label}
      <input
        readOnly
        value={value || '-'}
        className="mt-1 w-full rounded border bg-slate-50 p-2 text-slate-700"
      />
    </label>
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
