/** Closed offline-HTML content policy; not Runtime, completion, or an AI capability. */
import { DSL_VERSION } from '@openmaic/dsl';
import { v7 } from 'uuid';
import { parse } from 'parse5';
import { boundedJson } from '../openmaic/content';
import { canonical, draft, exact, hash, id, requireContent, type Draft } from './model';
export const interactivePolicy = 'content-interactive-offline-v1';
export type InteractiveDraft = Draft & { html: string };
export function interactiveHtml(value: unknown): string {
  requireContent(
    typeof value === 'string' &&
      value.trim().length > 0 &&
      value.isWellFormed() &&
      Buffer.byteLength(value) <= 65536 &&
      !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value),
  );
  // Unsupported resources are rejected visibly instead of becoming a broken published lesson.
  let count = 0;
  const walk = (node: ReturnType<typeof parse> | Record<string, unknown>, depth = 0) => {
    requireContent(depth <= 64 && ++count <= 10000);
    const n = node as {
      nodeName: string;
      attrs?: { name: string; value: string }[];
      childNodes?: Record<string, unknown>[];
      content?: Record<string, unknown>;
    };
    requireContent(
      ![
        'iframe',
        'frame',
        'frameset',
        'object',
        'embed',
        'base',
        'form',
        'link',
        'img',
        'audio',
        'video',
        'source',
        'track',
      ].includes(n.nodeName),
    );
    if (n.nodeName === 'meta')
      requireContent(!n.attrs?.some((a) => ['http-equiv'].includes(a.name)));
    for (const a of n.attrs ?? []) {
      requireContent(
        !/^on/i.test(a.name) &&
          ![
            'src',
            'srcset',
            'href',
            'action',
            'formaction',
            'poster',
            'ping',
            'xlink:href',
          ].includes(a.name),
      );
    }
    for (const child of n.childNodes ?? []) walk(child, depth + 1);
    if (n.content) walk(n.content, depth + 1);
  };
  walk(parse(value));
  return value;
}
export function interactiveDraft(value: unknown): InteractiveDraft {
  exact(value, ['title', 'slides', 'html']);
  const v = value as InteractiveDraft;
  const d = draft({ title: v.title, slides: v.slides });
  requireContent(d.slides.length === 1 && d.slides[0].elements.length === 0);
  return { ...d, html: interactiveHtml(v.html) };
}
export function newInteractiveDraft(title: string, html: unknown, page = v7()) {
  return interactiveDraft({ title, slides: [{ id: page, elements: [] }], html });
}
export function interactiveDocument(
  d: InteractiveDraft,
  stage: string,
  refs: string[],
  at: number,
) {
  return {
    dslVersion: DSL_VERSION,
    stage: { id: stage, name: d.title, createdAt: at, updatedAt: at },
    scenes: [
      {
        id: refs[0],
        stageId: stage,
        title: d.title,
        order: 0,
        type: 'interactive',
        content: { type: 'interactive', html: d.html },
      },
    ],
  };
}
export function checkInteractiveDocument(value: unknown, stage: string) {
  boundedJson(value);
  const doc = value as ReturnType<typeof interactiveDocument>;
  exact(doc, ['dslVersion', 'stage', 'scenes']);
  requireContent(doc.dslVersion === DSL_VERSION);
  exact(doc.stage, ['id', 'name', 'createdAt', 'updatedAt']);
  requireContent(doc.stage.id === stage);
  id(stage);
  requireContent(
    typeof doc.stage.name === 'string' && doc.stage.name.length > 0 && doc.stage.name.length <= 120,
  );
  requireContent(
    Number.isSafeInteger(doc.stage.createdAt) &&
      doc.stage.createdAt >= 0 &&
      doc.stage.updatedAt === doc.stage.createdAt,
  );
  requireContent(Array.isArray(doc.scenes) && doc.scenes.length === 1);
  const s = doc.scenes[0];
  exact(s, ['id', 'stageId', 'title', 'order', 'type', 'content']);
  id(s.id);
  requireContent(
    s.stageId === stage && s.title === doc.stage.name && s.order === 0 && s.type === 'interactive',
  );
  exact(s.content, ['type', 'html']);
  requireContent(s.content.type === 'interactive');
  interactiveHtml(s.content.html);
  return {
    document: doc,
    digest: hash(canonical(doc)),
    scenes: [{ ref: s.id, ordinal: 0, digest: hash(canonical(s)) }],
  };
}
export const INTERACTIVE_FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; script-src-attr 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts";
