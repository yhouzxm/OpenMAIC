'use client';
import { Fragment } from 'react';
import type { QuizQuestion, PublicQuestion, QuizAnswers, QuestionResult } from '@openmaic/dsl/quiz';
import { SingleChoiceQuestion, MultipleChoiceQuestion, ShortAnswerQuestion } from './presentation';
export * from './presentation';
export interface QuizSurfaceProps {
  questions: PublicQuestion[];
  answers: QuizAnswers;
  phase: 'answering' | 'reviewing';
  readOnly?: boolean;
  busy?: boolean;
  onChange: (answers: QuizAnswers) => void;
  onSave?: () => void;
  onSubmit?: () => void;
  review?: { questions: QuizQuestion[]; results: QuestionResult[] };
}
export function QuizSurface(p: QuizSurfaceProps) {
  const disabled = p.readOnly || p.busy || p.phase === 'reviewing';
  return (
    <section className="space-y-4" aria-label="测验题目">
      {p.questions.map((publicQ, i) => {
        const q = p.review?.questions.find((x) => x.id === publicQ.id) ?? publicQ;
        const result = p.review?.results.find((x) => x.questionId === q.id);
        const onChange = (v: string | string[]) => p.onChange({ ...p.answers, [q.id]: v });
        return (
          <Fragment key={q.id}>
            {q.type === 'single' ? (
              <SingleChoiceQuestion
                question={q}
                index={i}
                value={p.answers[q.id] as string}
                onChange={onChange}
                disabled={disabled}
                result={result}
              />
            ) : q.type === 'multiple' ? (
              <MultipleChoiceQuestion
                question={q}
                index={i}
                value={p.answers[q.id] as string[]}
                onChange={onChange}
                disabled={disabled}
                result={result}
              />
            ) : (
              <ShortAnswerQuestion
                question={q}
                index={i}
                value={p.answers[q.id] as string}
                onChange={onChange}
                disabled={disabled}
                result={result}
              />
            )}
          </Fragment>
        );
      })}
      {!p.readOnly && (
        <div>
          <button type="button" disabled={p.busy} onClick={p.onSave}>
            保存答案
          </button>{' '}
          <button type="button" disabled={p.busy} onClick={p.onSubmit}>
            提交答案
          </button>
        </div>
      )}
    </section>
  );
}
