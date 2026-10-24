'use client';
import { createContext, useContext } from 'react';
import type { QuizContent, QuizQuestion } from '@openmaic/dsl/quiz';
import * as ops from './ops';
export function quizActions(change: (f: (c: QuizContent) => QuizContent) => void) {
  return {
    addQuizOption: (id: string) => change((c) => ops.addOption(c, id)),
    deleteQuizOption: (id: string, i: number) => change((c) => ops.deleteOption(c, id, i)),
    deleteQuizQuestion: (id: string) => change((c) => ops.deleteQuestion(c, id)),
    reorderQuizOptions: (id: string, a: number, b: number) =>
      change((c) => ops.reorderOptions(c, id, a, b)),
    setQuizQuestionType: (id: string, t: QuizQuestion['type']) =>
      change((c) => ops.setQuestionType(c, id, t)),
    toggleQuizCorrect: (id: string, i: number) => change((c) => ops.toggleCorrect(c, id, i)),
    typeQuizOptionLabel: (id: string, i: number, v: string) =>
      change((c) => ops.updateOptionLabel(c, id, i, v)),
    typeQuizQuestion: (id: string, p: Parameters<typeof ops.updateQuestion>[2], _key?: string) =>
      change((c) => ops.updateQuestion(c, id, p)),
  };
}
export type QuizAuthoringContext = ReturnType<typeof quizActions> & {
  t: (key: string, options?: Record<string, unknown>) => string;
};
export const Context = createContext<QuizAuthoringContext | null>(null);
export function useQuizAuthoring() {
  const v = useContext(Context);
  if (!v) throw Error('QuizAuthoring context missing');
  return v;
}
