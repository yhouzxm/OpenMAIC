import React from 'react';
import type { Answers, Question, OrderingAnswer } from '@/lib/zhiban/domain/quiz/model';
import { displayItems, moveItem } from '@/lib/zhiban/domain/quiz/ordering';

export function OrderingAuthoring({
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
  const o = q.ordering!;
  const working = o.correctOrder.length ? o.correctOrder : o.items.map((item) => item.id);
  const key = (order: string[]) => onChange({ ...q, ordering: { ...o, correctOrder: order } });
  return (
    <fieldset disabled={disabled}>
      <legend>
        第{index + 1}题 · 排序题（{q.points}分）
      </legend>
      <p>配置唯一正确顺序，不支持并列。学生须明确确认排序；顺序完全正确得整题分，否则零分。</p>
      <label>
        排序题题干
        <textarea
          aria-label={`排序题干-${q.id}`}
          value={q.question}
          onChange={(e) => onChange({ ...q, question: e.target.value })}
        />
      </label>
      <label>
        排序题分值
        <input
          aria-label={`排序分值-${q.id}`}
          type="number"
          min="0.01"
          max="1000"
          step="0.01"
          value={q.points}
          onChange={(e) => onChange({ ...q, points: Number(e.target.value) })}
        />
      </label>
      <h4>项目内容</h4>
      {o.items.map((item, i) => (
        <div key={item.id}>
          <label>
            项目{i + 1}
            <input
              aria-label={`排序项目-${q.id}-${i}`}
              value={item.label}
              onChange={(e) =>
                onChange({
                  ...q,
                  ordering: {
                    ...o,
                    items: o.items.map((x) =>
                      x.id === item.id ? { ...item, label: e.target.value } : x,
                    ),
                  },
                })
              }
            />
          </label>
          <button
            disabled={o.items.length <= 2}
            onClick={() =>
              onChange({
                ...q,
                ordering: { items: o.items.filter((x) => x.id !== item.id), correctOrder: [] },
              })
            }
          >
            删除项目{i + 1}
          </button>
        </div>
      ))}
      <button
        disabled={o.items.length >= 10}
        onClick={() =>
          onChange({
            ...q,
            ordering: {
              items: [...o.items, { id: crypto.randomUUID(), label: '' }],
              correctOrder: [],
            },
          })
        }
      >
        添加排序项目
      </button>
      <h4>教师标准顺序</h4>
      <p>
        {o.correctOrder.length
          ? '已配置标准顺序'
          : '尚未配置标准顺序；请调整或确认，之后才可发布。'}
      </p>
      <ol aria-label="教师标准顺序">
        {working.map((id, i) => (
          <li key={id} data-item-id={id}>
            {o.items.find((item) => item.id === id)?.label || '未填写项目'}
            <button
              aria-label={`标准顺序第${i + 1}项上移`}
              disabled={i === 0}
              onClick={() => key(moveItem(working, i, -1))}
            >
              上移
            </button>
            <button
              aria-label={`标准顺序第${i + 1}项下移`}
              disabled={i === working.length - 1}
              onClick={() => key(moveItem(working, i, 1))}
            >
              下移
            </button>
          </li>
        ))}
      </ol>
      <button onClick={() => key([...working])}>确认标准顺序</button>
      <label>
        排序题解析
        <textarea
          aria-label={`排序解析-${q.id}`}
          value={q.analysis ?? ''}
          onChange={(e) => onChange({ ...q, analysis: e.target.value })}
        />
      </label>
      <button onClick={onDelete}>删除排序题</button>
    </fieldset>
  );
}
export function OrderingQuestion({
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
  const value = answers[q.id] as OrderingAnswer | undefined;
  const working = value?.order.length ? value.order : displayItems(q).map((item) => item.id);
  const change = (order: string[], confirmed: boolean) =>
    onChange({ ...answers, [q.id]: { order, confirmed } });
  return (
    <fieldset disabled={disabled}>
      <legend>
        第{index + 1}题 · 排序（{q.points}分）
      </legend>
      <p>{q.question}</p>
      <p>用上移／下移调整；修改后须确认当前排序。未确认按未作答处理，确认后顺序完全正确才得分。</p>
      <ol aria-label={`第${index + 1}题当前排序`}>
        {working.map((id, i) => (
          <li key={id} data-item-id={id}>
            {q.ordering!.items.find((item) => item.id === id)?.label}
            <button
              aria-label={`第${index + 1}题第${i + 1}项上移`}
              disabled={i === 0}
              onClick={() => change(moveItem(working, i, -1), false)}
            >
              上移
            </button>
            <button
              aria-label={`第${index + 1}题第${i + 1}项下移`}
              disabled={i === working.length - 1}
              onClick={() => change(moveItem(working, i, 1), false)}
            >
              下移
            </button>
          </li>
        ))}
      </ol>
      <p>{value?.confirmed ? '本题排序已确认' : '本题排序尚未确认'}</p>
      <button onClick={() => change([...working], true)}>确认当前排序</button>
      <button onClick={() => change([], false)}>清除本题作答</button>
      {earned !== undefined && (
        <p>
          自动得分：{earned} / {q.points}
        </p>
      )}
      {review && (
        <>
          <p>
            标准顺序：
            {q
              .ordering!.correctOrder.map(
                (id) => q.ordering!.items.find((item) => item.id === id)?.label,
              )
              .join(' → ')}
          </p>
          {q.analysis && <p>解析：{q.analysis}</p>}
        </>
      )}
    </fieldset>
  );
}
