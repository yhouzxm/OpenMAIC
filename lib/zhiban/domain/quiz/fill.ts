import { ORDERING_ALGORITHM, publicOrdering, orderingScore } from './ordering';
import { MATCH_ALGORITHM, publicMatching, matchingScore } from './matching';
import type { Content, Question, Answers } from './model';
import {
  gradeChoiceQuestions,
  publicQuestions,
  QUIZ_CONTRACT_VERSION,
  type QuizQuestion,
  type QuestionResult,
} from '@openmaic/dsl/quiz';
export const FILL_ALGORITHM = 'zhiban-quiz-fill-1';
export const algorithm = (questions: Question[]) =>
  questions.some((q) => q.type === 'ordering')
    ? ORDERING_ALGORITHM
    : questions.some((q) => q.type === 'matching')
      ? MATCH_ALGORITHM
      : questions.some((q) => q.type === 'fill_blank')
        ? FILL_ALGORITHM
        : QUIZ_CONTRACT_VERSION;
export function publicQuiz(questions: Question[]) {
  return questions.map((q) =>
    q.type === 'ordering'
      ? publicOrdering(q)
      : q.type === 'matching'
        ? publicMatching(q)
        : q.type === 'fill_blank'
          ? {
              id: q.id,
              type: q.type,
              question: q.question,
              points: q.points,
              blanks: q.blanks!.map((b) => ({ label: b.label, points: b.points })),
            }
          : publicQuestions([q as QuizQuestion])[0],
  );
}
export function gradeQuiz(questions: Question[], answers: Answers): QuestionResult[] {
  return questions.flatMap((q) => {
    if (q.type === 'ordering') {
      const earned = orderingScore(q, answers[q.id] as import('./model').OrderingAnswer);
      const correct = earned === q.points;
      return [
        {
          questionId: q.id,
          earned,
          correct,
          status: correct ? ('correct' as const) : ('incorrect' as const),
        },
      ];
    }
    if (q.type !== 'fill_blank' && q.type !== 'matching')
      return gradeChoiceQuestions([q as QuizQuestion], {
        [q.id]: answers[q.id] as string | string[],
      });
    const values = answers[q.id] as string[];
    const earned =
      q.type === 'matching'
        ? Math.round(matchingScore(q, values) * 100)
        : q.blanks!.reduce(
            (sum, b, i) =>
              sum +
              (values[i].trim() !== '' && b.accepted.some((a) => a.trim() === values[i].trim())
                ? Math.round(b.points * 100)
                : 0),
            0,
          );
    const correct = earned === Math.round(q.points! * 100);
    return [
      {
        questionId: q.id,
        correct,
        status: correct ? ('correct' as const) : ('incorrect' as const),
        earned: earned / 100,
      },
    ];
  });
}
export function addFill(content: Content, id: string): Content {
  if (content.questions.length >= 100) return content;
  return {
    ...content,
    questions: [
      ...content.questions,
      {
        id,
        type: 'fill_blank',
        question: '',
        points: 1,
        blanks: [{ label: '第1空', points: 1, accepted: [] }],
      },
    ],
  };
}
