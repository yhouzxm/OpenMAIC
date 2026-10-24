/** A reviewed text handout projection, never an enabled native classroom. */
import { createHash } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { formulaText } from './formula';
import { draft, requireContent, type Draft } from '../content/model';
function stableId(value: string) {
  const s = createHash('sha256').update(value).digest('hex').split('');
  s[12] = '7';
  s[16] = '8';
  const h = s.join('').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function text(value: unknown): string {
  requireContent(typeof value === 'string', 'UNSUPPORTED_GENERATED_CONTENT', 409);
  return sanitizeHtml(value.replace(/<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?\s*>/gi, '\n'), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[<>&]/g, (c) => ({ '<': '＜', '>': '＞', '&': '＆' })[c]!)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
    .trim();
}
export function handoutProjection(
  runId: string,
  document: unknown,
): { draft: Draft; omitted: string[] } {
  const doc = document as {
    stage?: { name?: unknown };
    scenes?: Array<{
      id?: string;
      type?: string;
      title?: string;
      content?: {
        canvas?: {
          elements?: Array<{ type?: string; content?: string; text?: string; latex?: unknown }>;
        };
      };
    }>;
  };
  requireContent(
    doc?.stage && Array.isArray(doc.scenes) && doc.scenes.length > 0 && doc.scenes.length <= 32,
    'UNSUPPORTED_GENERATED_CONTENT',
    409,
  );
  const omitted = new Set<string>();
  const slides = doc.scenes.map((scene, index) => {
    requireContent(
      scene.type === 'slide' && Array.isArray(scene.content?.canvas?.elements),
      'UNSUPPORTED_GENERATED_CONTENT',
      409,
    );
    const parts = [text(scene.title ?? `第 ${index + 1} 页`)];
    for (const e of scene.content!.canvas!.elements!) {
      if (e.type === 'text') parts.push(text(e.content));
      else if (e.type === 'shape' && e.text)
        parts.push(
          text(typeof e.text === 'object' ? (e.text as { content?: string }).content : e.text),
        );
      else if (e.type === 'latex') parts.push(formulaText(e.latex));
      else omitted.add(e.type ?? 'unknown');
    }
    const value = parts.filter((p, i) => p && (i === 0 || p !== parts[0])).join('\n\n');
    requireContent(value.length <= 16000, 'GENERATED_PAGE_TOO_LONG', 409);
    const chunks = value.match(/[\s\S]{1,1800}/g) ?? [];
    requireContent(chunks.length > 0, 'UNSUPPORTED_GENERATED_CONTENT', 409);
    return {
      id: stableId(`${runId}:${index}`),
      elements: chunks.map((content, i) => ({
        id: stableId(`${runId}:${index}:${i}`),
        text: content,
        x: 20,
        y: 15 + i * Math.floor(510 / chunks.length),
        width: 920,
        height: Math.floor(510 / chunks.length),
      })),
    };
  });
  return {
    draft: draft({ title: text(doc.stage.name).slice(0, 120), slides }),
    omitted: [...omitted].sort(),
  };
}
