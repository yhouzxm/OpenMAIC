import type { Content, Question, Answers, OrderingAnswer } from './model';
export const ORDERING_ALGORITHM = 'zhiban-quiz-order-1';
export function addOrdering(content: Content, id: string, itemIds: [string, string]): Content {
  if (content.questions.length >= 100 || content.questions.some((q) => q.id === id)) return content;
  return {
    ...content,
    questions: [
      ...content.questions,
      {
        id,
        type: 'ordering',
        question: '',
        points: 1,
        ordering: { items: itemIds.map((id) => ({ id, label: '' })), correctOrder: [] },
      },
    ],
  };
}
/** Neutral display order depends only on item IDs, never on the private answer key. */
export function displayItems(q: Question) {
  return [...q.ordering!.items]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => ({ id: item.id, label: item.label }));
}
export function publicOrdering(q: Question) {
  return {
    id: q.id,
    type: q.type,
    question: q.question,
    points: q.points,
    ordering: { items: displayItems(q) },
  };
}
export function orderingScore(q: Question, a: OrderingAnswer | undefined) {
  return a?.confirmed &&
    a.order.length === q.ordering!.correctOrder.length &&
    a.order.every((id, i) => id === q.ordering!.correctOrder[i])
    ? q.points!
    : 0;
}
export function isUnanswered(q: Question, value: Answers[string] | undefined): boolean {
  if (q.type === 'ordering')
    return !value || Array.isArray(value) || typeof value !== 'object' || !value.confirmed;
  if (q.type === 'fill_blank' || q.type === 'matching')
    return !Array.isArray(value) || value.some((v) => !v.trim());
  return !value || (typeof value === 'object' && !Array.isArray(value)) || value.length === 0;
}
export function moveItem(order: string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= order.length || target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
