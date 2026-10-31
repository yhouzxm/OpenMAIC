import { describe, expect, it } from 'vitest';
import type { Slide } from '@openmaic/dsl';
import { rewritePublishedSlideMedia } from '@/lib/zhiban/infrastructure/authoring/published-media';

const slide = (src: string, mediaRef?: string): Pick<Slide, 'background' | 'elements'> => ({
  elements: [
    {
      id: 'video',
      type: 'video',
      autoplay: false,
      src,
      mediaRef,
      left: 0,
      top: 0,
      width: 800,
      height: 400,
      rotate: 0,
    },
  ],
});
const refs = new Map([
  ['owned-video', '/exact-publication/video'],
  ['owned-image', '/exact-publication/image'],
]);
const videos = new Set(['owned-video']);

describe('fixed publication video projection', () => {
  it('binds editor src to the media table contract without mutating the saved snapshot', () => {
    const saved = slide('owned-video');
    const projected = structuredClone(saved);
    rewritePublishedSlideMedia(projected, refs, videos);
    expect(projected.elements[0]).toMatchObject({
      src: '/exact-publication/video',
      mediaRef: '/exact-publication/video',
    });
    expect(saved.elements[0]).toMatchObject({ src: 'owned-video' });
    expect(saved.elements[0]).not.toHaveProperty('mediaRef', expect.any(String));
  });
  it('supports a snapshot that already carries a valid mediaRef', () => {
    const projected = slide('', 'owned-video');
    rewritePublishedSlideMedia(projected, refs, videos);
    expect(projected.elements[0]).toHaveProperty('mediaRef', '/exact-publication/video');
  });
  it('does not make external, foreign or image bytes playable as snapshot video', () => {
    for (const source of ['https://external.invalid/video.mp4', 'foreign-video', 'owned-image']) {
      const projected = slide(source, source);
      rewritePublishedSlideMedia(projected, refs, videos);
      expect(projected.elements[0]).not.toHaveProperty('mediaRef');
    }
  });
});
