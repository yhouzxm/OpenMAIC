'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
type Row = Record<string, unknown>;
export function StudentGradeConsole() {
  const [data, setData] = useState<{ courses: Row[]; records: Row[]; reviews: Row[] }>({
    courses: [],
    records: [],
    reviews: [],
  });
  const [assessments, setAssessments] = useState<Row[]>([]);
  const load = () =>
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
    });
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, []);
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
  async function review(input: {
    courseId: unknown;
    gradeRecordId?: unknown;
    finalGradeId?: unknown;
  }) {
    const reason = window.prompt('请输入成绩复核理由');
    if (!reason) return;
    const response = await fetch('/api/zhiban/student/grade-reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, reason }),
    });
    const body = await response.json();
    if (!response.ok) {
      toast.error(body.error);
      return;
    }
    toast.success('复核申请已提交');
    await load();
  }
  return (
    <main className="min-h-screen bg-slate-100 p-5">
      <div className="mx-auto max-w-5xl space-y-5">
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
        {assessments.map((a) => (
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
        {data.courses.map((c) => (
          <Card key={String(c.id)}>
            <CardHeader>
              <div className="flex justify-between">
                <CardTitle>{String(c.name)}</CardTitle>
                {c.total_score != null ? (
                  <div className="text-right">
                    <b className="text-2xl text-teal-700">{Number(c.total_score).toFixed(1)}</b>
                    <Badge className="ml-2">{String(c.letter_grade)}</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-2"
                      onClick={() =>
                        void review({ courseId: c.id, finalGradeId: c.final_grade_id })
                      }
                    >
                      申请复核
                    </Button>
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
              <div className="divide-y rounded-md border">
                {data.records
                  .filter((r) => r.course_id === c.id)
                  .map((r) => (
                    <div
                      key={String(r.code)}
                      className="flex items-center justify-between p-3 text-sm"
                    >
                      <span>
                        {String(r.name)}{' '}
                        <span className="text-slate-500">({String(r.category)})</span>
                      </span>
                      <div>
                        <b>
                          {String(r.raw_score)} / {String(r.max_score)}
                        </b>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void review({ courseId: c.id, gradeRecordId: r.grade_record_id })
                          }
                        >
                          复核
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>我的复核申请</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.reviews.map((r) => (
              <div key={String(r.id)} className="rounded border p-3 text-sm">
                <p>{String(r.reason)}</p>
                <Badge variant="outline">{String(r.status)}</Badge>
                {Boolean(r.resolution) && (
                  <p className="mt-1 text-slate-600">处理意见：{String(r.resolution)}</p>
                )}
              </div>
            ))}
            {!data.reviews.length && <p className="text-sm text-slate-500">暂无复核申请。</p>}
          </CardContent>
        </Card>
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
