'use client';
import { useState, useRef } from 'react';
import { Reorder } from 'motion/react';
import type { QuizContent } from '@openmaic/dsl/quiz';
import { Context, quizActions } from './context';
import { QuestionCard } from './QuestionCard';
import * as ops from './ops';
export * from './ops';
export interface QuizAuthoringSurfaceProps {
  value: QuizContent;
  onChange: (v: QuizContent) => void;
  readOnly?: boolean;
  t?: (key: string, options?: Record<string, unknown>) => string;
  errors?: string[];
}
export function QuizAuthoringSurface({
  value,
  onChange,
  readOnly,
  t = (k) => k,
  errors = [],
}: QuizAuthoringSurfaceProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const history = useRef(ops.createQuizEditHistory(value));
  if (history.current.present !== value) history.current = ops.createQuizEditHistory(value);
  const change = (f: (c: QuizContent) => QuizContent) => {
    if (readOnly) return;
    history.current = ops.commitQuizContent(history.current, f(history.current.present));
    onChange(history.current.present);
  };
  const travel = (direction: 'undo' | 'redo') => {
    if (readOnly) return;
    history.current =
      direction === 'undo' ? ops.undoQuiz(history.current) : ops.redoQuiz(history.current);
    onChange(history.current.present);
  };
  return (
    <Context.Provider value={{ ...quizActions(change), t }}>
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0 }}>
        {errors.map((x, i) => (
          <p role="alert" key={i}>
            {x}
          </p>
        ))}
        <div>
          <button type="button" onClick={() => travel('undo')}>
            撤销
          </button>{' '}
          <button type="button" onClick={() => travel('redo')}>
            重做
          </button>
        </div>
        <Reorder.Group
          as="ol"
          axis="y"
          values={value.questions.map((q) => q.id)}
          onReorder={(ids) => change((c) => ops.reorderQuestions(c, ids))}
          className="space-y-3"
        >
          {value.questions.map((q, index) => (
            <QuestionCard
              key={q.id}
              question={q}
              index={index}
              expanded={q.id === expanded}
              onToggle={() => setExpanded(q.id === expanded ? null : q.id)}
            />
          ))}
        </Reorder.Group>
        <div>
          {(['single', 'multiple', 'short_answer'] as const).map((type) => (
            <button
              type="button"
              key={type}
              onClick={() =>
                change((c) => {
                  const next = ops.addQuestion(c, type);
                  setExpanded(next.questions.at(-1)!.id);
                  return next;
                })
              }
            >
              添加{type === 'single' ? '单选' : type === 'multiple' ? '多选' : '简答'}
            </button>
          ))}
        </div>
      </fieldset>
    </Context.Provider>
  );
}

export {QuestionCard} from './QuestionCard';
