import type { AdviceInput, AdviceResult } from './advice';
import { requireAcademic } from '../../domain/academic/model';
import type { Content } from '../../domain/quiz/model';
export function parseAdvice(text: string, input: AdviceInput, model: string): AdviceResult {
  const parsed = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, ''),
  );
  const questions = (input.content as Content).questions.filter((q) => q.type === 'short_answer');
  requireAcademic(
    parsed && Array.isArray(parsed.items) && parsed.items.length === questions.length,
  );
  const marks: Record<string, string> = {},
    feedback: string[] = [];
  for (const q of questions) {
    const items = parsed.items.filter((x: { id: string }) => x?.id === q.id);
    requireAcademic(items.length === 1);
    const v = items[0];
    requireAcademic(
      typeof v.score === 'number' &&
        Number.isFinite(v.score) &&
        v.score >= 0 &&
        v.score <= (q.points ?? 1) &&
        Math.abs(v.score * 100 - Math.round(v.score * 100)) < 1e-7,
    );
    requireAcademic(
      typeof v.comment === 'string' && v.comment.trim().length > 0 && v.comment.length <= 500,
    );
    marks[q.id] = v.score.toFixed(2);
    feedback.push(v.comment.trim());
  }
  const comment = feedback.join('\n');
  requireAcademic(comment.length <= 2000);
  return { marks, feedback: comment, model };
}
