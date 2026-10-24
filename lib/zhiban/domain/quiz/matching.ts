import type { Content, Question } from './model';
export const MATCH_ALGORITHM = 'zhiban-quiz-match-1';
export function addMatching(content: Content, id: string, rightIds: [string, string]): Content {
  if (content.questions.length >= 100 || content.questions.some((q) => q.id === id)) return content;
  return {
    ...content,
    questions: [
      ...content.questions,
      {
        id,
        type: 'matching',
        question: '',
        points: 2,
        match: {
          left: [
            { label: '', points: 1, correct: '' },
            { label: '', points: 1, correct: '' },
          ],
          right: rightIds.map((id) => ({ id, label: '' })),
        },
      },
    ],
  };
}
export function publicMatching(q: Question) {
  return {
    id: q.id,
    type: q.type,
    question: q.question,
    points: q.points,
    match: {
      left: q.match!.left.map((l) => ({ label: l.label, points: l.points })),
      right: q.match!.right.map((r) => ({ ...r })),
    },
  };
}
export function matchingScore(q: Question, values: string[]) {
  return (
    q.match!.left.reduce(
      (n, l, i) =>
        n + (values[i] !== '' && values[i] === l.correct ? Math.round(l.points * 100) : 0),
      0,
    ) / 100
  );
}
