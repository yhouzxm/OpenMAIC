'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ActivityAssignmentRecord } from '@/lib/zhiban/coursework';

export function StudentCoursework({ courseId }: { courseId: string }) {
  const [assignments, setAssignments] = useState<ActivityAssignmentRecord[]>([]),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/zhiban/student/courses/${courseId}/coursework`),
      body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '作业加载失败');
    setAssignments(body.assignments);
  }, [courseId]);
  useEffect(() => {
    void load().catch((error) => toast.error(error.message));
  }, [load]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`/api/zhiban/student/courses/${courseId}/coursework`, {
          method: 'POST',
          body: new FormData(event.currentTarget),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '提交失败');
      toast.success(
        body.status === 'draft'
          ? '作业草稿已保存'
          : `第 ${body.attemptNo} 次提交成功${body.isLate ? '（迟交）' : ''}`,
      );
      event.currentTarget.reset();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交失败');
    } finally {
      setBusy(false);
    }
  };
  if (!assignments.length) return null;
  return (
    <section className="border bg-white p-5">
      <h2 className="text-lg font-semibold">课程作业</h2>
      <div className="mt-4 space-y-4">
        {assignments.map((assignment) => {
          const submitted =
            assignment.mySubmissions?.filter((item) =>
              ['submitted', 'graded'].includes(item.status),
            ).length ?? 0;
          const canSubmit = assignment.status === 'published' && submitted < assignment.maxAttempts;
          return (
            <article key={assignment.id} className="rounded border p-4">
              <div className="flex flex-wrap gap-2">
                <h3 className="font-semibold">
                  {assignment.activityTitle} · {assignment.title}
                </h3>
                <Badge variant="outline">{assignment.status}</Badge>
              </div>
              <p className="my-3 whitespace-pre-wrap text-sm">{assignment.instructions}</p>
              <div className="space-y-2">
                {assignment.mySubmissions?.map((submission) => (
                  <div key={submission.id} className="rounded bg-slate-50 p-3 text-sm">
                    <b>
                      第{submission.attemptNo}次：{submission.status}
                    </b>
                    {submission.isLate ? '（迟交）' : ''}
                    {submission.score != null ? ` · ${submission.score}分` : ''}
                    <p className="whitespace-pre-wrap">{submission.feedback}</p>
                    <div>
                      {submission.files.map((file) => (
                        <Link
                          className="mr-3 text-blue-600"
                          key={file.id}
                          href={`/api/zhiban/coursework/files/${file.id}`}
                        >
                          {file.fileName}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {canSubmit && (
                <form onSubmit={submit} className="mt-3 space-y-2">
                  <input type="hidden" name="assignmentId" value={assignment.id} />
                  {assignment.submissionType !== 'file' && (
                    <textarea
                      name="textContent"
                      maxLength={50000}
                      required={assignment.submissionType === 'text'}
                      placeholder="填写作业内容"
                      className="min-h-28 w-full rounded border p-3 text-sm"
                    />
                  )}
                  {assignment.submissionType !== 'text' && (
                    <input
                      name="files"
                      type="file"
                      multiple
                      required={assignment.submissionType === 'file'}
                      className="block text-sm"
                    />
                  )}
                  <Button name="mode" value="submit" disabled={busy}>
                    确认提交
                  </Button>
                  <Button name="mode" value="draft" variant="outline" disabled={busy}>
                    保存草稿
                  </Button>
                  <span className="ml-2 text-xs text-slate-500">
                    提交后生成新版本；最多 {assignment.maxAttempts} 次
                  </span>
                </form>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
