'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActivityAssignmentRecord } from '@/lib/zhiban/coursework';

type Activity = { id: string; title: string; type: string; chapterTitle: string };
type GradeItem = { id: string; name: string; maxScore: number };
const selectClass = 'h-9 rounded border bg-white px-3 text-sm';

export function TeacherCourseworkConsole({ courseId }: { courseId: string }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [assignments, setAssignments] = useState<ActivityAssignmentRecord[]>([]);
  const [gradeItems, setGradeItems] = useState<GradeItem[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [contentResponse, courseworkResponse] = await Promise.all([
      fetch(`/api/zhiban/teacher/courses/${courseId}/content`),
      fetch(`/api/zhiban/teacher/courses/${courseId}/coursework`),
    ]);
    const content = await contentResponse.json(),
      coursework = await courseworkResponse.json();
    if (!contentResponse.ok) throw new Error(content.error ?? '作业活动加载失败');
    if (!courseworkResponse.ok) throw new Error(coursework.error ?? '作业加载失败');
    setActivities(content.activities.filter((item: Activity) => item.type === 'assignment'));
    setAssignments(coursework.assignments);
    setGradeItems(coursework.gradeItems);
  }, [courseId]);
  useEffect(() => {
    void load().catch((error) => toast.error(error.message));
  }, [load]);
  const post = async (payload: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/zhiban/teacher/courses/${courseId}/coursework`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '操作失败');
      toast.success(message);
      await load();
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void post(
      {
        action: 'save_assignment',
        activityId: form.get('activityId'),
        title: form.get('title'),
        instructions: form.get('instructions'),
        submissionType: form.get('submissionType'),
        maxFiles: Number(form.get('maxFiles')),
        maxFileSize: Number(form.get('maxFileSize')) * 1024 * 1024,
        maxAttempts: Number(form.get('maxAttempts')),
        opensAt: dateValue(form.get('opensAt')),
        dueAt: dateValue(form.get('dueAt')),
        allowLate: form.get('allowLate') === 'on',
        status: form.get('status'),
        gradeItemId: form.get('gradeItemId') || null,
      },
      '作业设置已保存',
    ).catch((error) => toast.error(error.message));
  };
  return (
    <section className="border bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">活动作业</h2>
        <span className="text-sm text-slate-500">
          在课程结构中的“作业”活动内直接配置、收取和批改
        </span>
        <Button asChild size="sm" variant="outline" className="ml-auto">
          <Link href={`/zhiban/teacher/courses/${courseId}/grades`}>成绩项管理</Link>
        </Button>
      </div>
      {!activities.length ? (
        <p className="text-sm text-amber-700">请先在统一课程结构中新增“作业”活动。</p>
      ) : (
        <form onSubmit={save} className="grid gap-3 rounded border p-4 md:grid-cols-4">
          <select required name="activityId" className={selectClass}>
            <option value="">选择作业活动</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.chapterTitle} / {a.title}
              </option>
            ))}
          </select>
          <Input required name="title" placeholder="作业名称" />
          <select name="submissionType" className={selectClass}>
            <option value="mixed">文本或文件</option>
            <option value="text">仅文本</option>
            <option value="file">仅文件</option>
          </select>
          <select name="gradeItemId" className={selectClass}>
            <option value="">不计入成绩</option>
            {gradeItems.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}（{g.maxScore}分）
              </option>
            ))}
          </select>
          <textarea
            required
            name="instructions"
            placeholder="作业要求"
            className="min-h-24 rounded border p-3 text-sm md:col-span-4"
          />
          <label className="text-sm">
            最大文件数
            <Input name="maxFiles" type="number" min="0" max="20" defaultValue="5" />
          </label>
          <label className="text-sm">
            单文件上限（MB）
            <Input name="maxFileSize" type="number" min="1" max="50" defaultValue="15" />
          </label>
          <label className="text-sm">
            最大提交次数
            <Input name="maxAttempts" type="number" min="1" max="100" defaultValue="1" />
          </label>
          <select name="status" className={selectClass}>
            <option value="draft">草稿</option>
            <option value="published">发布</option>
            <option value="closed">关闭</option>
            <option value="archived">归档</option>
          </select>
          <label className="text-sm">
            开放时间
            <Input name="opensAt" type="datetime-local" />
          </label>
          <label className="text-sm">
            截止时间
            <Input name="dueAt" type="datetime-local" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="allowLate" type="checkbox" />
            允许迟交
          </label>
          <Button disabled={busy}>保存作业设置</Button>
        </form>
      )}
      <div className="mt-4 space-y-4">
        {assignments.map((assignment) => (
          <article key={assignment.id} className="rounded border p-4">
            <div className="flex flex-wrap gap-2">
              <b>
                {assignment.activityTitle} · {assignment.title}
              </b>
              <span className="text-sm text-slate-500">
                {assignment.status} · 最多{assignment.maxAttempts}次
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const title = window.prompt('作业名称', assignment.title)?.trim();
                  if (!title) return;
                  const instructions =
                    window.prompt('作业要求', assignment.instructions) ?? assignment.instructions;
                  void post(
                    {
                      action: 'save_assignment',
                      activityId: assignment.activityId,
                      title,
                      instructions,
                      submissionType: assignment.submissionType,
                      maxFiles: assignment.maxFiles,
                      maxFileSize: assignment.maxFileSize,
                      maxAttempts: assignment.maxAttempts,
                      opensAt: assignment.opensAt,
                      dueAt: assignment.dueAt,
                      allowLate: assignment.allowLate,
                      status: assignment.status,
                      gradeItemId: assignment.gradeItemId,
                    },
                    '作业已修改',
                  ).catch((error) => toast.error(error.message));
                }}
              >
                编辑设置
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void post(
                    {
                      action: 'save_assignment',
                      activityId: assignment.activityId,
                      title: assignment.title,
                      instructions: assignment.instructions,
                      submissionType: assignment.submissionType,
                      maxFiles: assignment.maxFiles,
                      maxFileSize: assignment.maxFileSize,
                      maxAttempts: assignment.maxAttempts,
                      opensAt: assignment.opensAt,
                      dueAt: assignment.dueAt,
                      allowLate: assignment.allowLate,
                      status: assignment.status === 'closed' ? 'published' : 'closed',
                      gradeItemId: assignment.gradeItemId,
                    },
                    assignment.status === 'closed' ? '作业已重新开放' : '作业已关闭',
                  ).catch((error) => toast.error(error.message))
                }
              >
                {assignment.status === 'closed' ? '重新开放' : '关闭'}
              </Button>
            </div>
            <p className="my-2 whitespace-pre-wrap text-sm">{assignment.instructions}</p>
            <div className="space-y-3">
              {assignment.submissions?.map((submission) => (
                <form
                  key={submission.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget),
                      action = String(form.get('reviewAction'));
                    void post(
                      {
                        action,
                        submissionId: submission.id,
                        feedback: form.get('feedback'),
                        score: action === 'grade' ? Number(form.get('score')) : null,
                      },
                      action === 'grade' ? '评分已保存' : '已退回重交',
                    ).catch((error) => toast.error(error.message));
                  }}
                  className="rounded bg-slate-50 p-3 text-sm"
                >
                  <div>
                    <b>{submission.studentName}</b> · 第{submission.attemptNo}次 ·{' '}
                    {submission.status}
                    {submission.isLate ? ' · 迟交' : ''}
                  </div>
                  <p className="my-2 whitespace-pre-wrap">
                    {submission.textContent || '（无文本内容）'}
                  </p>
                  <div className="mb-2 flex gap-2">
                    {submission.files.map((file) => (
                      <Link
                        className="text-blue-600"
                        key={file.id}
                        href={`/api/zhiban/coursework/files/${file.id}`}
                      >
                        {file.fileName}
                      </Link>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      name="feedback"
                      placeholder="反馈意见"
                      defaultValue={submission.feedback}
                      className="min-w-56 flex-1"
                    />
                    <Input
                      name="score"
                      type="number"
                      min="0"
                      max="100"
                      placeholder="分数"
                      defaultValue={submission.score ?? ''}
                      className="w-24"
                    />
                    <Button name="reviewAction" value="grade" size="sm">
                      评分
                    </Button>
                    <Button name="reviewAction" value="return" size="sm" variant="outline">
                      退回重交
                    </Button>
                  </div>
                </form>
              ))}
              {!assignment.submissions?.length && (
                <p className="text-sm text-slate-400">暂无学生提交。</p>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function dateValue(value: FormDataEntryValue | null) {
  return value ? new Date(String(value)).toISOString() : null;
}
