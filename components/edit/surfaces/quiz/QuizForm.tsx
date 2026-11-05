'use client';
import { QuizAuthoringSurface } from '@openmaic/editor/quiz';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  buildQuizHints,
  useQuizSurfaceLifecycle,
  useResolvedQuizContent,
} from './use-quiz-surface';
import { useQuizEditSession } from './quiz-edit-session';
export function QuizForm() {
  useQuizSurfaceLifecycle();
  const value = useResolvedQuizContent();
  const { t } = useI18n();
  return (
    <section data-testid="quiz-surface">
      <QuizAuthoringSurface
        value={value}
        t={t}
        errors={buildQuizHints(value, t).map((hint) => hint.message)}
        onChange={(next) => useQuizEditSession.getState().commit(next)}
      />
    </section>
  );
}
