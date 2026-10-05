import { describe, it, expect, vi } from 'vitest';
import type { MaicDocument } from '@openmaic/storage';
import { DSL_VERSION, type Slide } from '@openmaic/dsl';
import { planCandidate, consumeCandidate } from '@/lib/zhiban/infrastructure/openmaic/candidate';
import {
  preview,
  nativeDocument,
  validateDocument,
  validateBytes,
} from '@/lib/zhiban/infrastructure/openmaic/content';
import { BridgeError } from '@/lib/zhiban/infrastructure/openmaic/validation';
import { admittedOperation, Deadline } from '@/lib/zhiban/infrastructure/openmaic/transactions';
import { deliverAsset, singleRange } from '@/lib/zhiban/infrastructure/openmaic/gateway';

function document(ref = 'planned', byteDigest = 'a'.repeat(64)) {
  const candidate = planCandidate(),
    stage = candidate.stageRef;
  const canvas = preview(
    {
      id: 'slide',
      viewportSize: 960,
      viewportRatio: 0.5625,
      elements: [
        {
          id: 'image',
          type: 'image',
          left: 0,
          top: 0,
          width: 80,
          height: 80,
          rotate: 0,
          src: `asset:${ref}`,
          fixedRatio: true,
        },
      ],
    } as Slide,
    (id) => `asset:${id}`,
  );
  const doc: MaicDocument = {
    dslVersion: DSL_VERSION,
    stage: { id: stage, name: 'Synthetic', createdAt: 1000, updatedAt: 1000 },
    scenes: [
      {
        id: 'scene',
        stageId: stage,
        title: 'Synthetic',
        order: 0,
        type: 'slide',
        content: { type: 'slide', canvas },
      },
    ],
  };
  const refs = new Map([[ref, { byteDigest, sceneRef: 'scene', purpose: 'IMAGE' as const }]]);
  return { candidate, doc, refs };
}
describe('Bridge frozen candidate and closed content', () => {
  it('round-trips native bare AssetRefs without changing Bridge content identity', () => {
    const { doc, refs } = document();
    const native = nativeDocument(doc, 'WRITE');
    expect((native.scenes[0].content as { canvas: Slide }).canvas.elements[0]).toMatchObject({
      src: 'planned',
    });
    const restored = nativeDocument(native, 'READ');
    expect(restored).toEqual(doc);
    expect(validateDocument(restored, doc.stage.id, refs)).toEqual(
      validateDocument(doc, doc.stage.id, refs),
    );
  });
  it.each(['url', 'prefixed', 'extra', 'foreign'] as const)(
    'native conversion cannot repair unsafe or unbound persisted content: %s',
    (kind) => {
      const { doc, refs } = document();
      const native = nativeDocument(doc, 'WRITE');
      const canvas = (native.scenes[0].content as { canvas: Slide }).canvas;
      if (kind === 'extra') Object.assign(canvas, { arbitraryScript: 'unapproved' });
      else
        Object.assign(canvas.elements[0], {
          src:
            kind === 'url'
              ? 'https://foreign.invalid/asset'
              : kind === 'prefixed'
                ? 'asset:planned'
                : 'foreign',
        });
      expect(() => validateDocument(nativeDocument(native, 'READ'), doc.stage.id, refs)).toThrow(
        BridgeError,
      );
    },
  );
  it.each(['0.11.2', '0.2.0', '99.0.0', undefined])(
    'rejects a package, stale, future or absent document protocol stamp: %s',
    (version) => {
      const { doc, refs } = document();
      expect(validateDocument(doc, doc.stage.id, refs).digest).toMatch(/^[0-9a-f]{64}$/);
      if (version === undefined) delete doc.dslVersion;
      else doc.dslVersion = version;
      expect(() => validateDocument(doc, doc.stage.id, refs)).toThrow(BridgeError);
    },
  );
  it('allocates IDs/principal before hashing and only admits the server-issued intention once', () => {
    const candidate = planCandidate();
    expect(candidate.generationId).not.toBe(candidate.stageRef);
    expect(Buffer.from(candidate.ownerHandle, 'base64url')).toHaveLength(32);
    expect(() => consumeCandidate({ ...candidate })).toThrow(BridgeError);
    expect(consumeCandidate(candidate)).toBe(candidate);
    expect(() => consumeCandidate(candidate)).toThrow(BridgeError);
  });
  it('freezes semantic bytes/purpose/scene before the public provider allocates an Asset ID', () => {
    const { doc, refs } = document();
    const before = validateDocument(doc, doc.stage.id, refs);
    const saved = structuredClone(doc);
    (saved.scenes[0].content as { canvas: Slide }).canvas.elements[0] = {
      ...(saved.scenes[0].content as { canvas: Slide }).canvas.elements[0],
      src: 'asset:fresh-public-ID',
    } as Slide['elements'][number];
    const after = validateDocument(
      saved,
      saved.stage.id,
      new Map([['fresh-public-ID', { ...refs.get('planned')! }]]),
    );
    expect(after).toEqual(before);
    expect(() => validateDocument(saved, saved.stage.id, refs)).toThrow(BridgeError);
    expect(
      validateDocument(
        saved,
        saved.stage.id,
        new Map([['fresh-public-ID', { ...refs.get('planned')!, byteDigest: 'b'.repeat(64) }]]),
      ).digest,
    ).not.toBe(before.digest);
  });
  it.each(['purpose', 'scene', 'extra', 'unbound'] as const)(
    'rejects invalid frozen asset intention: %s',
    (kind) => {
      const { doc, refs } = document();
      if (kind === 'purpose')
        refs.set('planned', { ...refs.get('planned')!, purpose: 'AUDIO' as 'IMAGE' });
      if (kind === 'scene')
        refs.set('planned', { ...refs.get('planned')!, sceneRef: 'foreign-scene' });
      if (kind === 'extra') refs.set('unused', { ...refs.get('planned')! });
      if (kind === 'unbound') refs.clear();
      expect(() => validateDocument(doc, doc.stage.id, refs)).toThrow(BridgeError);
    },
  );
  it.each(['actions', 'url', 'html', 'rich', 'stage', 'order', 'version'] as const)(
    'denies unsafe native document case %s',
    (kind) => {
      const { doc, refs } = document();
      const scene = doc.scenes[0],
        canvas = (scene.content as { canvas: Slide }).canvas;
      if (kind === 'actions') scene.actions = [{}] as NonNullable<typeof scene.actions>;
      if (kind === 'url')
        canvas.elements[0] = {
          ...canvas.elements[0],
          src: 'https://foreign.invalid/asset',
        } as Slide['elements'][number];
      if (kind === 'html') scene.title = '<script>';
      if (kind === 'rich') Object.assign(canvas, { arbitraryScript: 'unapproved' });
      if (kind === 'stage') scene.stageId = 'foreign';
      if (kind === 'order') scene.order = 1;
      if (kind === 'version') Object.assign(doc, { dslVersion: 'future' });
      expect(() => validateDocument(doc, doc.stage.id, refs)).toThrow(BridgeError);
    },
  );
  it('rejects markup/getters in standalone preview before provider or renderer work', () => {
    let called = 0;
    const slide = Object.defineProperty({}, 'elements', {
      enumerable: true,
      get() {
        called++;
        return [];
      },
    }) as Slide;
    expect(() => preview(slide, () => 'unused')).toThrow(BridgeError);
    expect(called).toBe(0);
  });
  it('accepts only bounded PNG/WAV/WebM signatures, not arbitrary MIME', () => {
    const wav = Buffer.alloc(44);
    wav.write('RIFF');
    wav.writeUInt32LE(36, 4);
    wav.write('WAVE', 8);
    expect(validateBytes('audio/wav', wav)).toMatch(/^[0-9a-f]{64}$/);
    expect(validateBytes('video/webm', Buffer.from('1a45dfa3', 'hex'))).toMatch(/^[0-9a-f]{64}$/);
    expect(() => validateBytes('application/javascript', wav)).toThrow(BridgeError);
  });
  it('rejects unsafe numeric suffix ranges instead of silently falling back to the whole asset', () => {
    expect(() => singleRange('bytes=-999999999999999999999', 10)).toThrow(BridgeError);
  });
  it('releases process permits at the total deadline even when external work never resolves', async () => {
    vi.useFakeTimers();
    try {
      const pending = admittedOperation(() => new Promise(() => {}));
      const failed = expect(pending).rejects.toThrow(BridgeError);
      await vi.advanceTimersByTimeAsync(10001);
      await failed;
      await expect(admittedOperation(async () => 'released')).resolves.toBe('released');
    } finally {
      vi.useRealTimers();
    }
  });
  it('bounds a backpressured sink by the same deadline and emits no later chunks', async () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn(() => new Promise<void>(() => {}));
      const stream = deliverAsset(
        'GET',
        null,
        async () => ({ bytes: new Uint8Array(65537), mime: 'image/png' }),
        async () => {},
        write,
        new Deadline(),
      );
      const failed = expect(stream).rejects.toThrow(BridgeError);
      await vi.advanceTimersByTimeAsync(10001);
      await failed;
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
