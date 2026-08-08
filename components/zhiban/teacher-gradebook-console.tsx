'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { TeacherCourse } from '@/lib/zhiban/teacher-courses';
type Row = Record<string, unknown>;
type Book = {
  course: Row;
  items: Row[];
  students: Row[];
  assessments: Row[];
  records: Row[];
  finalGrades: Row[];
  pendingAttempts: Row[];
  quizScenes: string[];
  reviews: Row[];
};
async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? '请求失败');
  return body as T;
}
const select = 'h-10 rounded-md border border-slate-300 bg-white px-3 text-sm';
export function TeacherGradebookConsole() {
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [courseId, setCourseId] = useState('');
  const [book, setBook] = useState<Book | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (courseId) setBook(await api<Book>(`/api/zhiban/teacher/courses/${courseId}/grades`));
  }, [courseId]);
  useEffect(() => {
    void api<{ courses: TeacherCourse[] }>('/api/zhiban/teacher/courses')
      .then((r) => {
        setCourses(r.courses);
        const requested = new URLSearchParams(window.location.search).get('courseId');
        setCourseId(
          r.courses.some((course) => course.id === requested)
            ? requested!
            : (r.courses[0]?.id ?? ''),
        );
      })
      .catch((e) => toast.error(e.message));
  }, []);
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, [load]);
  async function action(body: unknown, message: string) {
    setBusy(true);
    try {
      await api(`/api/zhiban/teacher/courses/${courseId}/grades`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast.success(message);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  function createItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void action(
      {
        action: 'grade_item',
        code: f.get('code'),
        name: f.get('name'),
        category: f.get('category'),
        weight: Number(f.get('weight')),
        maxScore: Number(f.get('maxScore')),
        dropLowest: f.get('dropLowest') === 'on',
        sourceType: f.get('sourceType'),
        sourceId: f.get('sourceId') || undefined,
      },
      '成绩项已创建',
    );
  }
  const parseQuestions = (value: string) =>
    value
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('|').map((x) => x.trim());
        if (parts.length <= 3) {
          const [prompt, answer, max = '10'] = parts;
          return {
            type: 'short_answer',
            prompt,
            options: [],
            answerKey: { value: answer },
            maxScore: Number(max),
          };
        }
        const [type, prompt, options = '', answer = '', max = '10'] = parts;
        return {
          type,
          prompt,
          options: options ? options.split(',').map((x) => x.trim()) : [],
          answerKey: answer
            ? {
                value: type === 'multiple_choice' ? answer.split(',').map((x) => x.trim()) : answer,
              }
            : {},
          maxScore: Number(max),
        };
      });
  function createAssessment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const questions = parseQuestions(String(f.get('questions')));
    void action(
      {
        action: 'assessment',
        code: f.get('code'),
        name: f.get('title'),
        title: f.get('title'),
        description: '',
        category: f.get('category'),
        weight: Number(f.get('weight')),
        maxScore: questions.reduce((n, q) => n + q.maxScore, 0),
        assessmentType: f.get('assessmentType'),
        maxAttempts: Number(f.get('maxAttempts')),
        scoringMethod: f.get('scoringMethod'),
        questions,
      },
      '测评草稿已创建',
    );
  }
  function editAssessment(a: Row) {
    const existing = (a.questions as Row[])
      .map(
        (q) =>
          `${String(q.type)} | ${String(q.prompt)} | ${Array.isArray(q.options) ? q.options.join(',') : ''} | ${String((q.answerKey as Row)?.value ?? '')} | ${String(q.maxScore)}`,
      )
      .join('\n');
    const value = window.prompt('编辑题目：题型 | 题目 | 选项(逗号分隔) | 答案 | 分值', existing);
    if (!value) return;
    void action(
      {
        action: 'update_assessment',
        assessmentId: a.id,
        title: a.title,
        description: a.description,
        maxAttempts: Number(a.max_attempts),
        scoringMethod: a.scoring_method,
        opensAt: a.opens_at,
        dueAt: a.due_at,
        questions: parseQuestions(value),
      },
      '测评已更新',
    );
  }
  const record = (studentId: unknown, itemId: unknown) =>
    book?.records.find((r) => r.student_id === studentId && r.grade_item_id === itemId);
  const final = (studentId: unknown) => book?.finalGrades.find((r) => r.student_id === studentId);
  return (
    <main className="min-h-screen bg-slate-100 p-5 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-950 p-6 text-white">
          <div>
            <h1 className="text-2xl font-semibold">测评与课程成绩</h1>
            <p className="text-sm text-slate-300">统一管理过程性、项目、期末成绩和课程总评</p>
          </div>
          <Button asChild className="bg-white text-slate-900 hover:bg-slate-100">
            <Link href="/zhiban/teacher/courses">返回课程设置</Link>
          </Button>
        </header>
        <Card>
          <CardContent className="pt-5">
            <label className="mb-2 block text-sm font-medium">课程</label>
            <select
              className={`${select} w-full max-w-md`}
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>新增成绩项</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={createItem} className="grid gap-3 sm:grid-cols-2">
                <Input name="code" placeholder="编码" required />
                <Input name="name" placeholder="名称" required />
                <select name="category" className={select}>
                  <option value="formative">过程性</option>
                  <option value="project">项目</option>
                  <option value="final">期末</option>
                </select>
                <Input
                  name="weight"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue="10"
                  placeholder="分类内权重"
                  required
                />
                <Input name="maxScore" type="number" min="1" defaultValue="100" required />
                <select name="sourceType" className={select}>
                  <option value="manual">教师录入</option>
                  <option value="classroom_quiz">OpenMAIC课堂Quiz</option>
                </select>
                <Input
                  name="sourceId"
                  list="quiz-scenes"
                  placeholder="Quiz场景ID（仅课堂Quiz需要）"
                />
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="dropLowest" />
                  同类成绩项超过一个时去掉最低分
                </label>
                <datalist id="quiz-scenes">
                  {book?.quizScenes.map((scene) => (
                    <option key={scene} value={scene} />
                  ))}
                </datalist>
                <Button disabled={busy}>创建</Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>创建测评</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={createAssessment} className="grid gap-3 sm:grid-cols-2">
                <Input name="code" placeholder="测评编码" required />
                <Input name="title" placeholder="测评名称" required />
                <select name="category" className={select}>
                  <option value="formative">过程性</option>
                  <option value="final">期末</option>
                </select>
                <select name="assessmentType" className={select}>
                  <option value="quiz">测验</option>
                  <option value="assignment">作业</option>
                  <option value="exam">考试</option>
                  <option value="practice">练习</option>
                </select>
                <Input name="weight" type="number" min="0" max="100" defaultValue="10" />
                <Input name="maxAttempts" type="number" min="1" defaultValue="1" />
                <select name="scoringMethod" className={select}>
                  <option value="highest">最高分</option>
                  <option value="latest">最新一次</option>
                  <option value="average">平均分</option>
                </select>
                <textarea
                  name="questions"
                  required
                  className="min-h-24 rounded-md border p-3 text-sm sm:col-span-2"
                  placeholder="题型 | 题目 | 选项(逗号) | 答案 | 分值；支持 single_choice、multiple_choice、true_false、short_answer、essay"
                />
                <Button disabled={busy}>保存测评草稿</Button>
              </form>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>课程成绩册</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href={`/api/zhiban/teacher/courses/${courseId}/grades/export`}>导出CSV</a>
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void action({ action: 'publish_records' }, '成绩明细已发布')}
              >
                发布成绩明细
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void action({ action: 'recalculate' }, '总评已重新计算')}
              >
                计算总评
              </Button>
              <Button
                disabled={busy}
                className="bg-teal-700 hover:bg-teal-800"
                onClick={() => void action({ action: 'publish' }, '总评已发布')}
              >
                发布总评
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt('请输入撤回总评原因');
                  if (reason) void action({ action: 'withdraw', reason }, '已撤回已发布总评');
                }}
              >
                撤回总评
              </Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="p-3 text-left">学生</th>
                  {book?.items.map((i) => (
                    <th className="p-3 text-left" key={String(i.id)}>
                      {String(i.name)}
                      <div className="font-normal text-slate-500">
                        {String(i.category)} · 权重{String(i.weight)} · {String(i.max_score)}分
                      </div>
                    </th>
                  ))}
                  <th className="p-3">总评</th>
                </tr>
              </thead>
              <tbody>
                {book?.students.map((s) => (
                  <tr className="border-b" key={String(s.id)}>
                    <td className="p-3 font-medium">{String(s.display_name || s.login_name)}</td>
                    {book.items.map((i) => {
                      const r = record(s.id, i.id);
                      return (
                        <td className="p-2" key={String(i.id)}>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              void action(
                                {
                                  action: 'grade',
                                  studentId: s.id,
                                  gradeItemId: i.id,
                                  score: f.get('score') === '' ? null : Number(f.get('score')),
                                  status: f.get('status'),
                                  reason: '教师成绩册录入或更正',
                                },
                                '成绩已保存',
                              );
                            }}
                            className="flex gap-1"
                          >
                            <Input
                              name="score"
                              type="number"
                              min="0"
                              max={Number(i.max_score)}
                              step="0.01"
                              className="w-20"
                              defaultValue={r?.raw_score == null ? '' : String(r.raw_score)}
                            />
                            <select
                              name="status"
                              className="rounded border text-xs"
                              defaultValue={String(r?.status ?? 'draft')}
                            >
                              <option value="draft">草稿</option>
                              <option value="excused">免修</option>
                              <option value="absent">缺考</option>
                              <option value="deferred">缓考</option>
                              <option value="makeup">补考</option>
                            </select>
                            <Button size="sm" variant="outline">
                              保存
                            </Button>
                          </form>
                        </td>
                      );
                    })}
                    <td className="p-3 text-center">
                      <b>
                        {final(s.id)?.total_score == null
                          ? '—'
                          : Number(final(s.id)?.total_score).toFixed(1)}
                      </b>
                      <div>
                        <Badge variant="outline">{String(final(s.id)?.status ?? '未计算')}</Badge>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>待人工逐题评分</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {book?.pendingAttempts.map((attempt) => (
              <form
                key={String(attempt.id)}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const answers = (attempt.answers as Row[]).map((a) => ({
                    answerId: a.answerId,
                    score: Number(f.get(`score:${String(a.answerId)}`)),
                    feedback: String(f.get(`feedback:${String(a.answerId)}`) ?? ''),
                  }));
                  void action(
                    {
                      action: 'grade_answers',
                      attemptId: attempt.id,
                      answers,
                      feedback: f.get('overall'),
                    },
                    '逐题评分已保存',
                  );
                }}
                className="rounded-md border p-3"
              >
                <b>
                  {String(attempt.display_name || attempt.login_name)} · {String(attempt.title)} ·
                  第 {String(attempt.attempt_no)} 次
                </b>
                <div className="my-2 space-y-2">
                  {(attempt.answers as Row[]).map((answer, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded bg-slate-50 p-2 text-sm md:grid-cols-[1fr_100px_1fr]"
                    >
                      <div>
                        <p>{String(answer.question)}</p>
                        <p className="text-slate-600">回答：{JSON.stringify(answer.answer)}</p>
                      </div>
                      <Input
                        name={`score:${String(answer.answerId)}`}
                        type="number"
                        min="0"
                        max={Number(answer.maxScore)}
                        step="0.01"
                        defaultValue={answer.score == null ? '' : String(answer.score)}
                        placeholder={`/${String(answer.maxScore)}`}
                        required
                      />
                      <Input
                        name={`feedback:${String(answer.answerId)}`}
                        defaultValue={String(answer.feedback ?? '')}
                        placeholder="逐题反馈"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input name="overall" placeholder="综合反馈" />
                  <Button>提交逐题评分</Button>
                </div>
              </form>
            ))}
            {!book?.pendingAttempts.length && (
              <p className="text-sm text-slate-500">没有待人工评分的提交。</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>成绩复核申请</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {book?.reviews.map((review) => (
              <div key={String(review.id)} className="rounded border p-3">
                <b>{String(review.display_name || review.login_name)}</b>
                <p className="text-sm">{String(review.reason)}</p>
                <Badge variant="outline">{String(review.status)}</Badge>
                {review.status === 'pending' && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        const resolution = window.prompt('请输入处理意见');
                        if (resolution)
                          void action(
                            {
                              action: 'handle_review',
                              reviewId: review.id,
                              status: 'approved',
                              resolution,
                            },
                            '复核申请已通过',
                          );
                      }}
                    >
                      通过
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const resolution = window.prompt('请输入驳回原因');
                        if (resolution)
                          void action(
                            {
                              action: 'handle_review',
                              reviewId: review.id,
                              status: 'rejected',
                              resolution,
                            },
                            '复核申请已驳回',
                          );
                      }}
                    >
                      驳回
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {!book?.reviews.length && <p className="text-sm text-slate-500">暂无复核申请。</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>测评列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {book?.assessments.map((a) => (
              <div
                key={String(a.id)}
                className="flex flex-wrap items-center gap-2 rounded-md border p-3"
              >
                <b>{String(a.title)}</b>
                <Badge>{String(a.assessment_type)}</Badge>
                <Badge variant="outline">{String(a.status)}</Badge>
                <span className="text-sm text-slate-500">最多 {String(a.max_attempts)} 次</span>
                {a.status === 'draft' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => editAssessment(a)}>
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        void action(
                          { action: 'publish_assessment', assessmentId: a.id },
                          '测评已发布',
                        )
                      }
                    >
                      向学生发布
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        void action(
                          { action: 'delete_assessment', assessmentId: a.id },
                          '测评已删除',
                        )
                      }
                    >
                      删除
                    </Button>
                  </>
                )}
                {a.status === 'published' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void action({ action: 'close_assessment', assessmentId: a.id }, '测评已关闭')
                    }
                  >
                    关闭
                  </Button>
                )}
                {a.status === 'closed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void action(
                        { action: 'archive_assessment', assessmentId: a.id },
                        '测评已归档',
                      )
                    }
                  >
                    归档
                  </Button>
                )}
              </div>
            ))}
            {!book?.assessments.length && <p className="text-sm text-slate-500">暂无测评。</p>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
