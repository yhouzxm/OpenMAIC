'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Job {
  id: string;
  file_name: string;
  status: string;
  mode: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  created_at: string;
  error_message?: string;
}
interface Preview {
  jobId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  summary: Record<string, number>;
  rows: Array<{ sheet: string; rowNumber: number; key: string; errors: string[] }>;
}
async function json<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? '操作失败');
  return body as T;
}

export function ImportConsole() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setJobs((await json<{ jobs: Job[] }>('/api/zhiban/import')).jobs);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const result = await json<Preview>('/api/zhiban/import', { method: 'POST', body: form });
      setPreview(result);
      toast.success(result.invalidRows ? '预检完成，请修正错误' : '预检通过');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '预检失败');
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    if (!preview) return;
    setBusy(true);
    try {
      await json(`/api/zhiban/import/${preview.jobId}/execute`, { method: 'POST' });
      toast.success('整批导入完成');
      setPreview(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败，已回滚');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between rounded-2xl bg-slate-950 px-6 py-5 text-white">
        <div>
          <p className="text-sm text-teal-300">智伴·创学管理中心</p>
          <h1 className="text-2xl font-semibold">基础数据批量导入</h1>
        </div>
        <Button variant="secondary" asChild>
          <Link href="/zhiban/admin/academic">
            <ArrowLeft className="mr-2 size-4" />
            班级与课程
          </Link>
        </Button>
      </header>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>上传与预检</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            先下载标准模板；上传后只做校验，点击“确认执行”才会写入数据库。任意一行失败时整批回滚。
          </div>
          <form onSubmit={validate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm">
              Excel文件
              <input
                className="mt-2 block w-full rounded-md border p-2"
                name="file"
                type="file"
                accept=".xlsx"
                required
              />
            </label>
            <label className="text-sm">
              重复策略
              <select className="mt-2 block rounded-md border p-2" name="mode">
                <option value="skip">跳过已有数据</option>
                <option value="update">更新已有数据</option>
              </select>
            </label>
            <Button disabled={busy}>
              <Upload className="mr-2 size-4" />
              上传预检
            </Button>
            <Button variant="outline" asChild>
              <a href="/templates/zhiban-bulk-import-template.xlsx" download>
                <Download className="mr-2 size-4" />
                下载模板
              </a>
            </Button>
          </form>
        </CardContent>
      </Card>
      {preview && (
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>预检结果</CardTitle>
            <Button disabled={busy || preview.invalidRows > 0} onClick={() => void execute()}>
              {busy ? '执行中…' : '确认执行'}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Badge>总计 {preview.totalRows}</Badge>
              <Badge variant="outline">有效 {preview.validRows}</Badge>
              <Badge variant={preview.invalidRows ? 'destructive' : 'outline'}>
                错误 {preview.invalidRows}
              </Badge>
            </div>
            {preview.invalidRows > 0 ? (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                存在 {preview.invalidRows} 行错误，修正文件并重新预检后才能执行。
              </p>
            ) : (
              <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                预检已通过，可以点击右上角“确认执行”写入数据库。
              </p>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              {Object.entries(preview.summary).map(([key, value]) => (
                <div key={key} className="rounded border p-2 text-sm">
                  {key}：{value}
                </div>
              ))}
            </div>
            {preview.rows.map((row) => (
              <div
                key={`${row.sheet}-${row.rowNumber}`}
                className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700"
              >
                {row.sheet} 第{row.rowNumber}行（{row.key}）：{row.errors.join('；')}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>最近导入任务</CardTitle>
          <Button variant="ghost" onClick={() => void load()}>
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">
                  <FileSpreadsheet className="mr-2 inline size-4" />
                  {job.file_name}
                </p>
                <p className="text-sm text-slate-500">
                  {job.total_rows}行 · 有效{job.valid_rows} · 错误{job.invalid_rows}
                </p>
                {job.error_message && <p className="text-sm text-red-600">{job.error_message}</p>}
              </div>
              <Badge variant="outline">{job.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
