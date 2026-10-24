import type { Content } from './model';

/** Host-side conveniences; the persisted contract remains the native three types. */
export function addJudgment(content: Content, id: string): Content {
  if (content.questions.length >= 100 || content.questions.some((q) => q.id === id)) return content;
  return {
    ...content,
    questions: [
      ...content.questions,
      {
        id,
        type: 'single',
        question: '',
        points: 1,
        options: [
          { value: 'A', label: '正确' },
          { value: 'B', label: '错误' },
        ],
        answer: [],
      },
    ],
  };
}
export function copyQuestion(content: Content, sourceId: string, id: string): Content {
  const index = content.questions.findIndex((q) => q.id === sourceId);
  if (index < 0 || content.questions.length >= 100 || content.questions.some((q) => q.id === id))
    return content;
  const copy = structuredClone(content.questions[index]);
  copy.id = id;
  return {
    ...content,
    questions: [
      ...content.questions.slice(0, index + 1),
      copy,
      ...content.questions.slice(index + 1),
    ],
  };
}
