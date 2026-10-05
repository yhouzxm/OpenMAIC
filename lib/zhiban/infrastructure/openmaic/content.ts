import type { MaicDocument } from '@openmaic/storage';
import type { Slide } from '@openmaic/dsl';
import { check, hash, opaque, digest } from './validation';
export type AssetPurpose = 'IMAGE' | 'AUDIO' | 'VIDEO' | 'POSTER' | 'BACKGROUND';
export type AssetExpectations =
  | ReadonlyMap<string, Readonly<{ byteDigest: string; sceneRef: string; purpose: AssetPurpose }>>
  | ReadonlySet<string>;

/** Traverse descriptors before encoding: no getters, cycles, huge arrays, or rich objects. */
export function boundedJson(value: unknown): string {
  let budget = 0;
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number) => {
    check(depth <= 16);
    if (typeof v === 'string') {
      budget += Buffer.byteLength(v) + 8;
      check(budget <= 4194304 && !/[\x00]/.test(v));
      return;
    }
    if (v === null || typeof v === 'boolean') {
      budget += 8;
      return;
    }
    if (typeof v === 'number') {
      check(Number.isFinite(v));
      budget += 32;
      return;
    }
    check(typeof v === 'object' && v !== null && !seen.has(v));
    seen.add(v);
    check(
      Array.isArray(v)
        ? v.length <= 4096
        : [null, Object.prototype].includes(Object.getPrototypeOf(v)),
    );
    const descriptors = Object.getOwnPropertyDescriptors(v);
    check(Object.keys(descriptors).length <= 4097);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key === 'length') continue;
      check('value' in descriptor && descriptor.enumerable);
      budget += Buffer.byteLength(key) + 8;
      check(budget <= 4194304);
      walk(descriptor.value, depth + 1);
    }
    seen.delete(v);
  };
  walk(value, 0);
  const text = JSON.stringify(value);
  check(typeof text === 'string' && Buffer.byteLength(text) <= 4194304);
  return text;
}
export function preview(
  slide: Slide,
  resolve: (asset: string, purpose: AssetPurpose) => string,
): Slide {
  boundedJson(slide);
  const number = (v: unknown) => {
    check(typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 9600);
    return v;
  };
  const positive = (v: unknown) => {
    const n = number(v);
    check(n > 0);
    return n;
  };
  const text = (v: unknown) => {
    check(typeof v === 'string' && v.length <= 2048 && !/[<>&\x00-\x1f\x7f]/.test(v));
    return v;
  };
  const src = (v: unknown, purpose: AssetPurpose) => {
    check(typeof v === 'string' && v.startsWith('asset:'));
    const id = opaque(v.slice(6));
    check(!/[\s:/?#\\]/.test(id));
    return resolve(id, purpose);
  };
  check(slide && Array.isArray(slide.elements) && slide.elements.length <= 32);
  check(positive(slide.viewportSize) * positive(slide.viewportRatio) <= 9600);
  const elements = slide.elements.map((e) => {
    check(e.type === 'text' || e.type === 'image' || e.type === 'audio' || e.type === 'video');
    const base = {
      id: text(e.id),
      left: number(e.left),
      top: number(e.top),
      width: positive(e.width),
      height: positive(e.height),
      rotate: number(e.rotate),
    };
    switch (e.type) {
      case 'text':
        return {
          ...base,
          type: 'text' as const,
          content: text(e.content),
          defaultFontName: 'sans-serif',
          defaultColor: '#111111',
        };
      case 'image':
        return { ...base, type: 'image' as const, src: src(e.src, 'IMAGE'), fixedRatio: true };
      case 'audio':
        return { ...base, type: 'audio' as const, src: src(e.src, 'AUDIO'), loop: false };
      case 'video':
        return {
          ...base,
          type: 'video' as const,
          src: src(e.src, 'VIDEO'),
          ...(e.poster ? { poster: src(e.poster, 'POSTER') } : {}),
        };
      default:
        check(false);
    }
  });
  check(!slide.background || ['solid', 'image'].includes(slide.background.type));
  if (slide.background?.type === 'image') check(slide.background.image !== undefined);
  const background =
    slide.background?.type === 'image'
      ? {
          type: 'image' as const,
          image: { src: src(slide.background.image!.src, 'BACKGROUND'), size: 'contain' as const },
        }
      : { type: 'solid' as const, color: '#ffffff' };
  return {
    id: text(slide.id),
    viewportSize: positive(slide.viewportSize),
    viewportRatio: positive(slide.viewportRatio),
    elements,
    background,
    theme: {
      backgroundColor: '#ffffff',
      themeColors: ['#111111'],
      fontColor: '#111111',
      fontName: 'sans-serif',
    },
  } as Slide;
}
export function validateDocument(
  document: MaicDocument,
  stageRef: string,
  assetRefs: AssetExpectations,
) {
  boundedJson(document);
  check(
    document.dslVersion === '0.11.2' &&
      document.stage.id === opaque(stageRef) &&
      document.outline === undefined,
  );
  const keys = (object: object, allowed: readonly string[]) =>
    check(Object.keys(object).every((key) => allowed.includes(key)));
  keys(document, ['stage', 'scenes', 'dslVersion']);
  keys(document.stage, ['id', 'name', 'description', 'createdAt', 'updatedAt']);
  check(
    typeof document.stage.name === 'string' &&
      document.stage.name.length <= 256 &&
      !/[<>\x00-\x1f]/.test(document.stage.name),
  );
  check(
    document.stage.description === undefined ||
      (typeof document.stage.description === 'string' &&
        document.stage.description.length <= 2048 &&
        !/[<>\x00-\x1f]/.test(document.stage.description)),
  );
  check(
    Number.isSafeInteger(document.stage.createdAt) &&
      Number.isSafeInteger(document.stage.updatedAt) &&
      document.stage.createdAt >= 0 &&
      document.stage.updatedAt >= document.stage.createdAt,
  );
  check(
    document.scenes.length >= 1 &&
      document.scenes.length <= 64 &&
      new Set(document.scenes.map((s) => s.id)).size === document.scenes.length,
  );
  check(assetRefs instanceof Map || assetRefs.size === 0);
  const seen = new Set<string>(),
    normalized: MaicDocument['scenes'] = [];
  const scenes = document.scenes.map((scene, index) => {
    keys(scene, ['id', 'stageId', 'title', 'order', 'type', 'content', 'actions']);
    keys(scene.content, ['type', 'canvas']);
    check(
      typeof scene.title === 'string' &&
        scene.title.length <= 256 &&
        !/[<>\x00-\x1f]/.test(scene.title),
    );
    check(scene.stageId === stageRef && scene.order === index && scene.type === 'slide');
    check(!('actions' in scene) || (Array.isArray(scene.actions) && scene.actions.length === 0));
    check(scene.content.type === 'slide');
    const binding = (ref: string, purpose: AssetPurpose) => {
      check(assetRefs instanceof Map);
      const value = assetRefs.get(ref);
      check(value !== undefined && value.sceneRef === scene.id && value.purpose === purpose);
      digest(value.byteDigest);
      seen.add(ref);
      return value;
    };
    const projected = preview(scene.content.canvas, (ref, purpose) => {
      check(assetRefs.has(ref));
      binding(ref, purpose);
      return `asset:${ref}`;
    });
    // Exact closed stored content: stripped unsafe fields cannot silently survive in native JSON.
    check(canonicalJson(projected) === canonicalJson(scene.content.canvas));
    // Content identity freezes bytes/purpose/scene intentions, not an Asset ID allocated later by public put.
    const identity = {
      ...scene,
      content: {
        type: 'slide' as const,
        canvas: preview(
          scene.content.canvas,
          (ref, purpose) => `asset:${binding(ref, purpose).byteDigest}`,
        ),
      },
    };
    normalized.push(identity);
    return Object.freeze({
      ref: opaque(scene.id),
      ordinal: index,
      digest: hash(canonicalJson(identity)),
    });
  });
  check(seen.size === assetRefs.size);
  return Object.freeze({
    digest: hash(canonicalJson({ ...document, scenes: normalized })),
    scenes: Object.freeze(scenes),
  });
}
export function canonicalJson(value: unknown): string {
  const clean: unknown = JSON.parse(boundedJson(value));
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, val]) => [key, sort(val)]),
          )
        : v;
  return JSON.stringify(sort(clean));
}
export function validateBytes(mime: string, bytes: Uint8Array) {
  check(bytes instanceof Uint8Array && bytes.byteLength >= 1 && bytes.byteLength <= 4194304);
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png')
    check(
      b.length >= 24 &&
        b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
        b.toString('ascii', 12, 16) === 'IHDR' &&
        b.readUInt32BE(8) === 13 &&
        b.readUInt32BE(16) > 0 &&
        b.readUInt32BE(16) <= 4096 &&
        b.readUInt32BE(20) > 0 &&
        b.readUInt32BE(20) <= 4096,
    );
  else if (mime === 'audio/wav')
    check(
      b.length >= 44 &&
        b.toString('ascii', 0, 4) === 'RIFF' &&
        b.toString('ascii', 8, 12) === 'WAVE' &&
        b.readUInt32LE(4) + 8 === b.length,
    );
  else if (mime === 'video/webm')
    check(b.length >= 4 && b.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')));
  else check(false);
  return hash(bytes);
}
