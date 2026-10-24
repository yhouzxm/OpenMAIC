import { createHash } from 'node:crypto';
import { content, canonical, type Content } from '../../domain/quiz/model';
import { normalizeQuizContent } from '@openmaic/dsl/quiz';
import { requireContent } from '../content/model';
export const QUIZ_PROJECTION_VERSION = 'native-quiz-adopt-1';
export function quizProjection(
  runId: string,
  document: unknown,
): { title: string; content: Content; sourceHash: string; adapter: string } {
  const doc = document as {
    stage?: { name?: unknown };
    scenes?: Array<{ type?: string; content?: unknown }>;
  };
  requireContent(
    doc?.stage &&
      typeof doc.stage.name === 'string' &&
      Array.isArray(doc.scenes) &&
      doc.scenes.length > 0 &&
      doc.scenes.length <= 12,
    'UNSUPPORTED_GENERATED_CONTENT',
    409,
  );
  const questions: Content['questions'] = [];
  for (const [sceneIndex, scene] of doc.scenes.entries()) {
    requireContent(scene.type === 'quiz', 'UNSUPPORTED_GENERATED_CONTENT', 409);
    const value = scene.content as Content;
    requireContent(
      value?.type === 'quiz' &&
        Array.isArray(value.questions) &&
        value.questions.every((q) => ['single', 'multiple', 'short_answer'].includes(q.type)),
      'UNSUPPORTED_GENERATED_CONTENT',
      409,
    );
    const normalized = normalizeQuizContent(value as Parameters<typeof normalizeQuizContent>[0]);
    for (const [index, q] of normalized.questions.entries())
      questions.push({
        ...q,
        id: createHash('sha256')
          .update(`${runId}:${sceneIndex}:${index}`)
          .digest('hex')
          .slice(0, 32),
      });
  }
  const title = doc.stage.name.trim().slice(0, 100);
  requireContent(title.length > 0, 'UNSUPPORTED_GENERATED_CONTENT', 409);
  return {
    title,
    content: content({ type: 'quiz', questions }, true),
    sourceHash: createHash('sha256').update(canonical(document)).digest('hex'),
    adapter: QUIZ_PROJECTION_VERSION,
  };
}
