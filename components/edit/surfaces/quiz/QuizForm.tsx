'use client';
import { QuizAuthoringSurface } from '@openmaic/editor/quiz';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useQuizSurfaceLifecycle, useResolvedQuizContent } from './use-quiz-surface';
import { useQuizEditSession } from './quiz-edit-session';
export function QuizForm() {
  useQuizSurfaceLifecycle();
  const value = useResolvedQuizContent();
  const { t } = useI18n();
  return (
    <QuizAuthoringSurface
      value={value}
      t={t}
      onChange={(next) => useQuizEditSession.getState().commit(next)}
    />
  );
}
