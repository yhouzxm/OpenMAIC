'use client';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type Row = Record<string, unknown>;

export function EmaPrompt() {
  const [items, setItems] = useState<Row[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const load = useCallback(async () => {
    const response = await fetch('/api/zhiban/ema');
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setItems(body.questionnaires ?? []);
  }, []);
  useEffect(() => {
    void load().catch((error) => toast.error(error.message));
    const timer = window.setInterval(() => void load().catch(() => undefined), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const item = items[0];
  if (!item) return null;
  const questions = Array.isArray(item.questions) ? (item.questions as Row[]) : [];
  async function submit(skipped: boolean) {
    try {
      const response = await fetch('/api/zhiban/ema', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instanceId: item.id,
          answers,
          skipped,
          skipReason: skipped ? '学习者选择稍后继续学习' : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      toast.success(skipped ? '已跳过，本次跳过不会增加任何风险分' : '感谢你的反馈');
      setAnswers({});
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交失败');
    }
  }
  const required = questions
    .filter((q) => q.type === 'scale' && q.optional !== true)
    .every((q) => answers[String(q.id)] !== undefined);
  return (
    <aside
      className="fixed bottom-4 right-4 z-[110] max-h-[80vh] w-[min(26rem,calc(100vw-2rem))] overflow-auto rounded-2xl border bg-white p-5 shadow-2xl"
      data-testid="ema-prompt"
    >
      <p className="text-xs font-medium text-teal-700">EMA · 学习状态即时反馈</p>
      <h2 className="mt-1 text-lg font-semibold">{String(item.title)}</h2>
      <p className="mt-1 text-sm text-slate-600">{String(item.description)}</p>
      <p className="mt-2 rounded bg-blue-50 p-2 text-xs text-blue-800">
        问卷可跳过；跳过不会增加风险评分，也不会影响课程成绩。
      </p>
      <div className="mt-4 space-y-4">
        {questions.map((question) => (
          <div key={String(question.id)}>
            <label className="text-sm font-medium">{String(question.label)}</label>
            {question.type === 'scale' ? (
              <div className="mt-2 flex gap-2">
                {Array.from(
                  { length: Number(question.max ?? 5) - Number(question.min ?? 1) + 1 },
                  (_, index) => index + Number(question.min ?? 1),
                ).map((value) => (
                  <button
                    key={value}
                    className={`size-9 rounded-full border text-sm ${answers[String(question.id)] === value ? 'bg-teal-600 text-white' : 'bg-white'}`}
                    onClick={() =>
                      setAnswers((current) => ({ ...current, [String(question.id)]: value }))
                    }
                  >
                    {value}
                  </button>
                ))}
              </div>
            ) : (
              <textarea
                className="mt-2 min-h-16 w-full rounded border p-2 text-sm"
                value={String(answers[String(question.id)] ?? '')}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [String(question.id)]: event.target.value,
                  }))
                }
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={() => void submit(true)}>
          跳过
        </Button>
        <Button disabled={!required} onClick={() => void submit(false)}>
          提交回答
        </Button>
      </div>
    </aside>
  );
}
