import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { normalizeGlmImage } from '@/lib/zhiban/infrastructure/authoring/media/glm-image-normalization';
import { generatedMime } from '@/lib/zhiban/infrastructure/authoring/media/policy';

describe('GLM mislabeled watermark output', () => {
  it('creates real PNG bytes with the same pixels and retains original provenance', async () => {
    const original = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#1677ff' },
    })
      .jpeg()
      .toBuffer();
    const result = await normalizeGlmImage('glm-image', original, 'image/png');
    expect(generatedMime(result.bytes, 'image', result.mime)).toBe('image/png');
    expect(result.normalization).toMatchObject({
      kind: 'GLM_JPEG_TO_CANONICAL_PNG',
      decodedMime: 'image/jpeg',
      width: 64,
      height: 64,
    });
    expect(await sharp(result.bytes).raw().toBuffer()).toEqual(
      await sharp(original).raw().toBuffer(),
    );
  });
  it('keeps the strict contradictory-MIME refusal for other providers', async () => {
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const result = await normalizeGlmImage('other-provider', bytes, 'image/png');
    expect(result.normalization).toBeUndefined();
    expect(() => generatedMime(result.bytes, 'image', result.mime)).toThrow();
  });
  it('refuses corrupt JPEG-looking content and oversized image dimensions', async () => {
    await expect(
      normalizeGlmImage('glm-image', Buffer.from('ffd8ff000000', 'hex'), 'image/png'),
    ).rejects.toMatchObject({ code: 'MEDIA_INVALID_CONTAINER' });
    const bytes = await sharp({
      create: { width: 2049, height: 64, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    await expect(normalizeGlmImage('glm-image', bytes, 'image/png')).rejects.toMatchObject({
      code: 'MEDIA_INVALID_CONTAINER',
    });
  });
});
