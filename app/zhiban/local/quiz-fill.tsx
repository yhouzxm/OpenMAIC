import { OrderingAuthoring, OrderingQuestion } from './quiz-ordering';
import { addOrdering } from '@/lib/zhiban/domain/quiz/ordering';
import { MatchingAuthoring, MatchingQuestion } from './quiz-matching';
import { addMatching } from '@/lib/zhiban/domain/quiz/matching';
import React, { useState } from 'react';
import type { Content, Question, Answers } from '@/lib/zhiban/domain/quiz/model';
import { addFill } from '@/lib/zhiban/domain/quiz/fill';
import { QuizAuthoringSurface } from '@openmaic/editor/quiz';
import { validateQuizContent, type QuizQuestion, type QuestionResult } from '@openmaic/dsl/quiz';
import {
  SingleChoiceQuestion,
  MultipleChoiceQuestion,
  ShortAnswerQuestion,
} from '@openmaic/renderer/quiz';

export function FillAuthoring({
  value,
  onChange,
  readOnly,
  t,
}: {
  value: Content;
  onChange: (v: Content) => void;
  readOnly: boolean;
  t: (k: string) => string;
}) {
  const change = (id: string, patch: Partial<Question>) =>
    onChange({
      ...value,
      questions: value.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    });
  const native = value.questions.filter(
    (q) => q.type !== 'fill_blank' && q.type !== 'matching' && q.type !== 'ordering',
  ) as QuizQuestion[];
  const [nativeCache, setNativeCache] = useState<{ type: 'quiz'; questions: QuizQuestion[] }>({
    type: 'quiz',
    questions: native,
  });
  if (
    nativeCache.questions.length !== native.length ||
    native.some((q, i) => q !== nativeCache.questions[i])
  )
    setNativeCache({ type: 'quiz', questions: native });
  return (
    <>
      <button
        disabled={readOnly || value.questions.length >= 100}
        onClick={() => onChange(addFill(value, crypto.randomUUID()))}
      >
        添加填空题
      </button>
      <button
        disabled={readOnly || value.questions.length >= 100}
        onClick={() =>
          onChange(
            addMatching(value, crypto.randomUUID(), [crypto.randomUUID(), crypto.randomUUID()]),
          )
        }
      >
        添加匹配题
      </button>
      <button
        disabled={readOnly || value.questions.length >= 100}
        onClick={() =>
          onChange(
            addOrdering(value, crypto.randomUUID(), [crypto.randomUUID(), crypto.randomUUID()]),
          )
        }
      >
        添加排序题
      </button>
      <QuizAuthoringSurface
        value={nativeCache}
        readOnly={readOnly}
        t={t}
        errors={native.length ? validateQuizContent({ type: 'quiz', questions: native }) : []}
        onChange={(next) => {
          setNativeCache(next);
          const pending = [...next.questions];
          const merged = value.questions.flatMap((q) =>
            q.type === 'fill_blank' || q.type === 'matching' || q.type === 'ordering'
              ? [q]
              : pending.length
                ? [pending.shift()!]
                : [],
          );
          onChange({ ...value, questions: [...merged, ...pending] });
        }}
      />
      {value.questions.map((q, index) =>
        q.type === 'ordering' ? (
          <OrderingAuthoring
            key={q.id}
            q={q}
            index={index}
            disabled={readOnly}
            onChange={(updated) => change(q.id, updated)}
            onDelete={() =>
              onChange({ ...value, questions: value.questions.filter((x) => x.id !== q.id) })
            }
          />
        ) : q.type === 'matching' ? (
          <MatchingAuthoring
            key={q.id}
            q={q}
            index={index}
            disabled={readOnly}
            onChange={(updated) => change(q.id, updated)}
            onDelete={() =>
              onChange({ ...value, questions: value.questions.filter((x) => x.id !== q.id) })
            }
          />
        ) : (
          q.type === 'fill_blank' && (
            <fieldset key={q.id} disabled={readOnly}>
              <legend>
                第{index + 1}题 · 填空题（总分{q.points}）
              </legend>
              <p>
                按下列空位顺序作答；首尾空白忽略，区分大小写。每行一个可接受答案，不做模糊匹配。
              </p>
              <label>
                填空题题干
                <textarea
                  aria-label={`填空题干-${q.id}`}
                  value={q.question}
                  onChange={(e) => change(q.id, { question: e.target.value })}
                />
              </label>
              {q.blanks!.map((b, i) => {
                const update = (patch: Partial<typeof b>) => {
                  const blanks = q.blanks!.map((old, j) => (j === i ? { ...old, ...patch } : old));
                  change(q.id, {
                    blanks,
                    points:
                      Math.round(blanks.reduce((n, x) => n + Math.round(x.points * 100), 0)) / 100,
                  });
                };
                return (
                  <div key={i}>
                    <label>
                      第{i + 1}空提示
                      <input
                        aria-label={`空提示-${q.id}-${i}`}
                        value={b.label}
                        onChange={(e) => update({ label: e.target.value })}
                      />
                    </label>
                    <label>
                      第{i + 1}空分值
                      <input
                        aria-label={`空分值-${q.id}-${i}`}
                        type="number"
                        min="0.01"
                        max="1000"
                        step="0.01"
                        value={b.points}
                        onChange={(e) => update({ points: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      第{i + 1}空可接受答案
                      <textarea
                        aria-label={`可接受答案-${q.id}-${i}`}
                        value={b.accepted.join('\n')}
                        onChange={(e) => update({ accepted: e.target.value.split('\n') })}
                      />
                    </label>
                    <button
                      disabled={q.blanks!.length <= 1}
                      onClick={() => {
                        const blanks = q.blanks!.filter((_, j) => j !== i);
                        change(q.id, {
                          blanks,
                          points: blanks.reduce((n, x) => n + Math.round(x.points * 100), 0) / 100,
                        });
                      }}
                    >
                      删除第{i + 1}空
                    </button>
                  </div>
                );
              })}
              <button
                disabled={q.blanks!.length >= 10}
                onClick={() => {
                  const blanks = [
                    ...q.blanks!,
                    { label: `第${q.blanks!.length + 1}空`, points: 1, accepted: [] },
                  ];
                  change(q.id, {
                    blanks,
                    points: blanks.reduce((n, x) => n + Math.round(x.points * 100), 0) / 100,
                  });
                }}
              >
                添加空位
              </button>
              <label>
                填空题解析
                <textarea
                  aria-label={`填空解析-${q.id}`}
                  value={q.analysis ?? ''}
                  onChange={(e) => change(q.id, { analysis: e.target.value })}
                />
              </label>
              <button
                onClick={() =>
                  onChange({ ...value, questions: value.questions.filter((x) => x.id !== q.id) })
                }
              >
                删除填空题
              </button>
            </fieldset>
          )
        ),
      )}
    </>
  );
}
export function FillSurface(p: {
  questions: Question[];
  answers: Answers;
  phase: 'answering' | 'reviewing';
  readOnly?: boolean;
  busy?: boolean;
  onChange: (v: Answers) => void;
  review?: { questions: Question[]; results: QuestionResult[] };
  onSave?: () => void;
  onSubmit?: () => void;
}) {
  const disabled = p.readOnly || p.busy || p.phase === 'reviewing';
  return (
    <section aria-label="测验题目" className="space-y-4">
      {p.questions.map((publicQ, i) => {
        const q = p.review?.questions.find((q) => q.id === publicQ.id) ?? publicQ;
        const result = p.review?.results.find((r) => r.questionId === q.id);
        if (q.type === 'ordering')
          return (
            <OrderingQuestion
              key={q.id}
              q={q}
              index={i}
              disabled={!!disabled}
              review={!!p.review}
              earned={result?.earned}
              answers={p.answers}
              onChange={p.onChange}
            />
          );
        if (q.type === 'matching')
          return (
            <MatchingQuestion
              key={q.id}
              q={q}
              index={i}
              disabled={!!disabled}
              review={!!p.review}
              earned={result?.earned}
              answers={p.answers}
              onChange={p.onChange}
            />
          );
        if (q.type === 'fill_blank')
          return (
            <fieldset key={q.id} disabled={disabled}>
              <legend>
                第{i + 1}题 · 填空（{q.points}分）
              </legend>
              <p>{q.question}</p>
              {q.blanks!.map((b, j) => (
                <label key={j}>
                  {b.label}（{b.points}分）
                  <input
                    aria-label={`第${i + 1}题第${j + 1}空`}
                    maxLength={200}
                    value={(p.answers[q.id] as string[] | undefined)?.[j] ?? ''}
                    onChange={(e) => {
                      const values = q.blanks!.map(
                        (_, k) => (p.answers[q.id] as string[] | undefined)?.[k] ?? '',
                      );
                      values[j] = e.target.value;
                      p.onChange({ ...p.answers, [q.id]: values });
                    }}
                  />
                  {p.review && <span>可接受答案：{b.accepted.join(' / ')}</span>}
                </label>
              ))}
              {result && (
                <p>
                  自动得分：{result.earned} / {q.points}
                </p>
              )}
              {p.review && q.analysis && <p>解析：{q.analysis}</p>}
            </fieldset>
          );
        const shared = {
          question: q as QuizQuestion,
          index: i,
          disabled,
          result,
          onChange: (v: string | string[]) => p.onChange({ ...p.answers, [q.id]: v }),
        };
        return q.type === 'single' ? (
          <SingleChoiceQuestion key={q.id} {...shared} value={p.answers[q.id] as string} />
        ) : q.type === 'multiple' ? (
          <MultipleChoiceQuestion key={q.id} {...shared} value={p.answers[q.id] as string[]} />
        ) : (
          <ShortAnswerQuestion key={q.id} {...shared} value={p.answers[q.id] as string} />
        );
      })}
      {!p.readOnly && (
        <div>
          <button disabled={p.busy} onClick={p.onSave}>
            保存答案
          </button>
          <button disabled={p.busy} onClick={p.onSubmit}>
            提交答案
          </button>
        </div>
      )}
    </section>
  );
}
