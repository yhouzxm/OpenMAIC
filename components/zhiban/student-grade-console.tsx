'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
type Row = Record<string, unknown>;
export function StudentGradeConsole({ hideHeader = false, courseId }: { hideHeader?: boolean; courseId?: string }) {
  const [data, setData] = useState<{ courses: Row[]; records: Row[] }>({
    courses: [],
    records: [],
  });
  const [assessments, setAssessments] = useState<Row[]>([]);
  const load = useCallback(() =>
    Promise.all([
      fetch('/api/zhiban/student/grades'),
      fetch('/api/zhiban/student/assessments'),
    ]).then(async ([g, a]) => {
      const gb = await g.json(),
        ab = await a.json();
      if (!g.ok) throw new Error(gb.error);
      if (!a.ok) throw new Error(ab.error);
      setData(gb);
      setAssessments(ab.assessments);
    }), []);
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>, assessment: Row) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const questions = assessment.questions as Row[];
    const answers = questions.map((q) => ({
      questionId: q.id,
      answer:
        q.type === 'multiple_choice' ? form.getAll(String(q.id)) : (form.get(String(q.id)) ?? ''),
    }));
    const response = await fetch('/api/zhiban/student/assessments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assessmentId: assessment.id, answers }),
    });
    const body = await response.json();
    if (!response.ok) {
      toast.error(body.error);
      return;
    }
    toast.success(body.score == null ? '已提交，等待教师评分' : `提交成功，本次得分 ${body.score}`);
    await load();
  }
  return (
    <main className="min-h-screen bg-slate-100 p-2 sm:p-5">
      <div className="mx-auto max-w-5xl space-y-5">
        {!hideHeader && (
          <header className="flex items-center justify-between rounded-2xl bg-slate-950 p-6 text-white">
            <div>
              <h1 className="text-2xl font-semibold">测评与我的成绩</h1>
              <p className="text-sm text-slate-300">完成已开放测评，查看教师发布的成绩和总评</p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="secondary">
                <a href="/api/zhiban/student/grades/export">导出成绩</a>
              </Button>
              <Button asChild className="bg-white text-slate-900">
                <Link href="/zhiban/student/classrooms">返回学习</Link>
              </Button>
            </div>
          </header>
        )}
        {courseId && <h2 className="text-xl font-semibold">本课程学习成绩</h2>}
        {!courseId && assessments.map((a) => (
          <Card key={String(a.id)}>
            <CardHeader>
              <div className="flex justify-between">
                <CardTitle>{String(a.title)}</CardTitle>
                <Badge>{String(a.assessment_type)}</Badge>
              </div>
              <p className="text-sm text-slate-500">
                {String(a.course_name)} · 已尝试 {String(a.attempt_count)}/{String(a.max_attempts)}
              </p>
            </CardHeader>
            <CardContent>
              {Number(a.attempt_count) >= Number(a.max_attempts) ? (
                <p className="text-sm text-slate-500">已达到最大尝试次数。</p>
              ) : (
                <form onSubmit={(e) => void submit(e, a)} className="space-y-4">
                  {(a.questions as Row[]).map((q, index) => (
                    <div key={String(q.id)} className="block rounded-md border p-3">
                      <span className="mb-2 block font-medium">
                        {index + 1}. {String(q.prompt)}（{String(q.maxScore)}分）
                      </span>
                      {q.type === 'multiple_choice' && Array.isArray(q.options) ? (
                        <div className="space-y-1">
                          {(q.options as unknown[]).map((option) => (
                            <label key={String(option)} className="flex gap-2">
                              <input type="checkbox" name={String(q.id)} value={String(option)} />
                              {String(option)}
                            </label>
                          ))}
                        </div>
                      ) : Array.isArray(q.options) && (q.options as unknown[]).length > 0 ? (
                        <select name={String(q.id)} className="h-10 w-full rounded border px-3">
                          {(q.options as unknown[]).map((option) => (
                            <option key={String(option)}>{String(option)}</option>
                          ))}
                        </select>
                      ) : q.type === 'true_false' ? (
                        <select name={String(q.id)} className="h-10 w-full rounded border px-3">
                          <option value="true">正确</option>
                          <option value="false">错误</option>
                        </select>
                      ) : q.type === 'essay' ? (
                        <textarea
                          name={String(q.id)}
                          required
                          className="min-h-28 w-full rounded border p-2"
                          placeholder="请输入答案"
                        />
                      ) : (
                        <Input name={String(q.id)} required placeholder="请输入答案" />
                      )}
                    </div>
                  ))}
                  <Button>提交本次测评</Button>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
        {data.courses.filter((c) => !courseId || String(c.id) === courseId).map((c) => (
          <Card key={String(c.id)}>
            <CardHeader>
              <div className="flex justify-between">
                <CardTitle>{String(c.name)}</CardTitle>
                {c.total_score != null ? (
                  <div className="text-right">
                    <b className="text-2xl text-teal-700">{Number(c.total_score).toFixed(1)}</b>
                    <Badge className="ml-2">{String(c.letter_grade)}</Badge>
                  </div>
                ) : (
                  <Badge variant="outline">总评未发布</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid grid-cols-3 gap-3 text-center">
                <Score label="过程性" value={c.formative_score} />
                <Score label="项目" value={c.project_score} />
                <Score label="期末" value={c.final_exam_score} />
              </div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">课程学习活动成绩</h3>
                <span className="text-xs text-slate-500">列出作业、练习、测验、项目及考试成绩项目</span>
              </div>
              <div className="divide-y rounded-md border bg-white">
                {data.records
                  .filter((r) => r.course_id === c.id)
                  .map((r) => (
                    <div
                      key={String(r.code)}
                      className="grid gap-3 p-4 text-sm md:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] md:items-center"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-base font-medium">{String(r.name)}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {itemTypeLabel(r.item_type)} · {categoryLabel(r.category)}
                          {r.due_at ? ` · 截止：${new Date(String(r.due_at)).toLocaleString('zh-CN')}` : ''}
                        </p>
                        {Number(r.max_attempts ?? 0) > 0 && <p className="mt-1 text-xs text-slate-500">已作答 {String(r.attempt_count ?? 0)} / {String(r.max_attempts)} 次</p>}
                        {r.feedback ? <p className="mt-1 text-xs text-slate-600">教师反馈：{String(r.feedback)}</p> : null}
                      </div>
                      <Metric label="得分" value={r.raw_score == null ? '待评分' : `${Number(r.raw_score).toFixed(1)} / ${Number(r.max_score).toFixed(1)}`} />
                      <Metric label="权重" value={`${Number(r.weight ?? 0).toFixed(1)}%`} />
                      <div className="md:text-center">
                        <Metric label="实际得分" value={weightedScore(r)} />
                      </div>
                    </div>
                  ))}
                {!data.records.filter((r) => r.course_id === c.id).length && <p className="p-6 text-center text-sm text-slate-500">教师尚未设置课程成绩项目。</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
function Score({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value == null ? '—' : Number(value).toFixed(1)}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="md:text-center"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-medium text-blue-700">{value}</p></div>;
}

function weightedScore(row: Row) {
  if (row.normalized_score == null) return '—';
  return (Number(row.normalized_score) * Number(row.weight ?? 0) / 100).toFixed(1);
}

function categoryLabel(value: unknown) {
  return ({ formative: '过程性成绩', project: '项目成绩', final: '期末成绩' } as Record<string, string>)[String(value)] ?? String(value);
}

function itemTypeLabel(value: unknown) {
  return ({ assignment: '作业', practice: '练习', quiz: '测验', exam: '考试', pbl: 'PBL 项目', classroom_quiz: '课堂测验', manual: '学习活动' } as Record<string, string>)[String(value)] ?? '学习活动';
}
