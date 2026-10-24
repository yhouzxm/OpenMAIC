import { DSL_VERSION } from '@openmaic/dsl';
import { v7 } from 'uuid';
import { createHash } from 'node:crypto';
export class ContentError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export function requireContent(v: unknown, code = 'INVALID_INPUT', status = 400): asserts v {
  if (!v) throw new ContentError(code, status);
}
export function id(v: unknown): string {
  requireContent(
    typeof v === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v),
  );
  return v;
}
export function revision(v: unknown): string {
  requireContent(
    typeof v === 'string' &&
      /^[1-9][0-9]{0,18}$/.test(v) &&
      BigInt(v) <= BigInt('9223372036854775807'),
  );
  return v;
}
export function exact(v: any, keys: string[]) {
  requireContent(
    v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v).length === keys.length &&
      Object.keys(v).every((k) => keys.includes(k)),
  );
}
export type Draft = {
  title: string;
  slides: {
    id: string;
    elements: ({ id: string; x: number; y: number; width: number; height: number } & (
      | { text: string; assetId?: never }
      | { assetId: string; text?: never }
    ))[];
  }[];
};
export function draft(v: any): Draft {
  exact(v, ['title', 'slides']);
  requireContent(
    typeof v.title === 'string' &&
      v.title === v.title.trim() &&
      v.title.length > 0 &&
      v.title.length <= 120 &&
      v.title.isWellFormed() &&
      !/[\x00-\x1f\x7f-\x9f]/.test(v.title),
  );
  requireContent(Array.isArray(v.slides) && v.slides.length >= 1 && v.slides.length <= 32);
  const ids = new Set<string>();
  const unique = (s: any) => {
    id(s);
    requireContent(!ids.has(s));
    ids.add(s);
  };
  for (const s of v.slides) {
    exact(s, ['id', 'elements']);
    unique(s.id);
    requireContent(Array.isArray(s.elements) && s.elements.length <= 32);
    for (const e of s.elements) {
      exact(e, ['id', 'assetId' in e ? 'assetId' : 'text', 'x', 'y', 'width', 'height']);
      unique(e.id);
      if ('assetId' in e) id(e.assetId);
      else
        requireContent(
          typeof e.text === 'string' &&
            e.text.isWellFormed() &&
            e.text.length <= 2000 &&
            !/[<>&\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(e.text),
        );
      requireContent(
        [e.x, e.y, e.width, e.height].every(Number.isSafeInteger) &&
          e.x >= 0 &&
          e.y >= 0 &&
          e.width >= 1 &&
          e.height >= 1 &&
          e.x + e.width <= 960 &&
          e.y + e.height <= 540,
      );
    }
  }
  requireContent(Buffer.byteLength(JSON.stringify(v)) <= 262144);
  return v;
}
export const emptyDraft = (title: string) => draft({ title, slides: [{ id: v7(), elements: [] }] });
export const canvas = (s: Draft['slides'][number]) => ({
  id: s.id,
  viewportSize: 960,
  viewportRatio: 0.5625,
  elements: s.elements.map((e) => ({
    id: e.id,
    ...('assetId' in e
      ? { type: 'image', src: `asset:${e.assetId}`, fixedRatio: true }
      : { type: 'text', content: e.text, defaultFontName: 'sans-serif', defaultColor: '#111111' }),
    left: e.x,
    top: e.y,
    width: e.width,
    height: e.height,
    rotate: 0,
  })),
  background: { type: 'solid', color: '#ffffff' },
  theme: {
    backgroundColor: '#ffffff',
    themeColors: ['#111111'],
    fontColor: '#111111',
    fontName: 'sans-serif',
  },
});
export function document(d: Draft, stage: string, sceneRefs: string[], at: number): any {
  return {
    dslVersion: DSL_VERSION,
    stage: { id: stage, name: d.title, createdAt: at, updatedAt: at },
    scenes: d.slides.map((s, i) => ({
      id: sceneRefs[i],
      stageId: stage,
      title: `第 ${i + 1} 页`,
      order: i,
      type: 'slide',
      content: { type: 'slide', canvas: canvas(s) },
    })),
  };
}
export function canonical(v: any): string {
  return JSON.stringify(v, (_, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]]),
        )
      : value,
  );
}
export function command(v: any) {
  const fields: Record<string, string[]> = {
    CREATE_CONTENT: ['type', 'title'],
    CREATE_INTERACTIVE: ['type', 'title', 'html'],
    SAVE_INTERACTIVE: ['type', 'id', 'revision', 'title', 'html'],
    SAVE_CONTENT: ['type', 'id', 'revision', 'title', 'slides'],
    PUBLISH_CONTENT: ['type', 'id', 'revision'],
    WITHDRAW_CONTENT: ['type', 'id', 'revision'],
  };
  requireContent(fields[v?.type]);
  exact(v, fields[v.type]);
  if (v.type === 'CREATE_CONTENT' || v.type === 'CREATE_INTERACTIVE') emptyDraft(v.title);
  else {
    id(v.id);
    revision(v.revision);
    if (v.type === 'SAVE_CONTENT') draft({ title: v.title, slides: v.slides });
  }
  return v;
}
