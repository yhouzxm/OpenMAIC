import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { requireContent, ContentError } from '../../content/model';
import { MEDIA_BYTES, mediaContainer } from './policy';

/** Some GLM watermark responses label JPEG bytes as PNG. Decode/re-encode, never relabel bytes. */
export async function normalizeGlmImage(provider: string | undefined, bytes: Buffer, mime: string) {
  if (provider !== 'glm-image' || mime !== 'image/png' || !mediaContainer(bytes, 'image/jpeg'))
    return { bytes, mime, normalization: undefined };
  requireContent(bytes.length <= MEDIA_BYTES, 'MEDIA_TOO_LARGE', 413);
  try {
    const image = sharp(bytes, { limitInputPixels: 4194304, failOn: 'warning' });
    const metadata = await image.metadata();
    requireContent(
      metadata.format === 'jpeg' &&
        !!metadata.width &&
        !!metadata.height &&
        metadata.width >= 64 &&
        metadata.height >= 64 &&
        metadata.width <= 2048 &&
        metadata.height <= 2048,
      'MEDIA_INVALID_CONTAINER',
      502,
    );
    // Preserve visual watermarks and image metadata; PNG encoding changes no decoded pixels.
    const output = await image.keepMetadata().png().toBuffer();
    requireContent(
      output.length <= MEDIA_BYTES && mediaContainer(output, 'image/png'),
      'MEDIA_INVALID_CONTAINER',
      502,
    );
    return {
      bytes: output,
      mime: 'image/png',
      normalization: {
        kind: 'GLM_JPEG_TO_CANONICAL_PNG',
        originalSha256: createHash('sha256').update(bytes).digest('hex'),
        originalDeclaredMime: mime,
        decodedMime: 'image/jpeg',
        width: metadata.width,
        height: metadata.height,
      },
    };
  } catch (error) {
    if (error instanceof ContentError) throw error;
    throw new ContentError('MEDIA_INVALID_CONTAINER', 502);
  }
}
