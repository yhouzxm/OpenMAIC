import React from 'react';
import type { Answers, Question } from '@/lib/zhiban/domain/quiz/model';

export function MatchingAuthoring({
  q,
  index,
  disabled,
  onChange,
  onDelete,
}: {
  q: Question;
  index: number;
  disabled: boolean;
  onChange: (q: Question) => void;
  onDelete: () => void;
}) {
  const m = q.match!;
  const change = (match: NonNullable<Question['match']>) =>
    onChange({
      ...q,
      match,
      points: match.left.reduce((n, l) => n + Math.round(l.points * 100), 0) / 100,
    });
  return (
    <fieldset disabled={disabled}>
      <legend>
        第{index + 1}题 · 匹配题（总分{q.points}）
      </legend>
      <p>每个左项选择一个右项；右项可重复使用。逐项匹配得分，错配或未答为零分。</p>
      <label>
        匹配题题干
        <textarea
          aria-label={`匹配题干-${q.id}`}
          value={q.question}
          onChange={(e) => onChange({ ...q, question: e.target.value })}
        />
      </label>
      <h4>右项选项</h4>
      {m.right.map((r, i) => (
        <div key={r.id}>
          <label>
            右项{i + 1}
            <input
              aria-label={`右项-${q.id}-${i}`}
              value={r.label}
              onChange={(e) =>
                change({
                  ...m,
                  right: m.right.map((x) => (x.id === r.id ? { ...r, label: e.target.value } : x)),
                })
              }
            />
          </label>
          <button
            disabled={m.right.length <= 2}
            onClick={() =>
              change({
                ...m,
                right: m.right.filter((x) => x.id !== r.id),
                left: m.left.map((l) => (l.correct === r.id ? { ...l, correct: '' } : l)),
              })
            }
          >
            删除右项{i + 1}
          </button>
        </div>
      ))}
      <button
        disabled={m.right.length >= 10}
        onClick={() =>
          change({ ...m, right: [...m.right, { id: crypto.randomUUID(), label: '' }] })
        }
      >
        添加右项
      </button>
      <h4>左项与标准配对</h4>
      {m.left.map((l, i) => (
        <div key={i}>
          <label>
            左项{i + 1}
            <input
              aria-label={`左项-${q.id}-${i}`}
              value={l.label}
              onChange={(e) =>
                change({
                  ...m,
                  left: m.left.map((x, j) => (j === i ? { ...l, label: e.target.value } : x)),
                })
              }
            />
          </label>
          <label>
            左项{i + 1}分值
            <input
              aria-label={`匹配分值-${q.id}-${i}`}
              type="number"
              min="0.01"
              max="1000"
              step="0.01"
              value={l.points}
              onChange={(e) =>
                change({
                  ...m,
                  left: m.left.map((x, j) =>
                    j === i ? { ...l, points: Number(e.target.value) } : x,
                  ),
                })
              }
            />
          </label>
          <label>
            左项{i + 1}正确右项
            <select
              aria-label={`标准配对-${q.id}-${i}`}
              value={l.correct}
              onChange={(e) =>
                change({
                  ...m,
                  left: m.left.map((x, j) => (j === i ? { ...l, correct: e.target.value } : x)),
                })
              }
            >
              <option value="">请选择标准配对</option>
              {m.right.map((r, j) => (
                <option key={r.id} value={r.id}>
                  {j + 1}. {r.label || '未填写右项'}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={m.left.length <= 2}
            onClick={() => change({ ...m, left: m.left.filter((_, j) => j !== i) })}
          >
            删除左项{i + 1}
          </button>
        </div>
      ))}
      <button
        disabled={m.left.length >= 10}
        onClick={() => change({ ...m, left: [...m.left, { label: '', points: 1, correct: '' }] })}
      >
        添加左项
      </button>
      <label>
        匹配题解析
        <textarea
          aria-label={`匹配解析-${q.id}`}
          value={q.analysis ?? ''}
          onChange={(e) => onChange({ ...q, analysis: e.target.value })}
        />
      </label>
      <button onClick={onDelete}>删除匹配题</button>
    </fieldset>
  );
}
export function MatchingQuestion({
  q,
  index,
  answers,
  disabled,
  review,
  earned,
  onChange,
}: {
  q: Question;
  index: number;
  answers: Answers;
  disabled: boolean;
  review: boolean;
  earned?: number;
  onChange: (a: Answers) => void;
}) {
  const m = q.match!;
  return (
    <fieldset disabled={disabled}>
      <legend>
        第{index + 1}题 · 匹配（{q.points}分）
      </legend>
      <p>{q.question}</p>
      <p>右项可重复选择；每个左项独立计分。</p>
      {m.left.map((l, i) => (
        <label key={i}>
          {l.label}（{l.points}分）
          <select
            aria-label={`第${index + 1}题左项${i + 1}`}
            value={(answers[q.id] as string[] | undefined)?.[i] ?? ''}
            onChange={(e) => {
              const values = m.left.map(
                (_, j) => (answers[q.id] as string[] | undefined)?.[j] ?? '',
              );
              values[i] = e.target.value;
              onChange({ ...answers, [q.id]: values });
            }}
          >
            <option value="">请选择配对</option>
            {m.right.map((r, j) => (
              <option key={r.id} value={r.id}>
                {j + 1}. {r.label}
              </option>
            ))}
          </select>
          {review && <span>标准配对：{m.right.find((r) => r.id === l.correct)?.label}</span>}
        </label>
      ))}
      {earned !== undefined && (
        <p>
          自动得分：{earned} / {q.points}
        </p>
      )}
      {review && q.analysis && <p>解析：{q.analysis}</p>}
    </fieldset>
  );
}
