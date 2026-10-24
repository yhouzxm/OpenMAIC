import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { MaicDocument } from '@openmaic/storage';
import {
  validateDocument,
  canonicalJson,
  boundedJson,
  type AssetExpectations,
} from '../openmaic/content';
import { ContentError, requireContent } from './model';
export const pngPolicy = 'content-png-v1';
export const maxPngBytes = 4194304;
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function pngCrc(bytes: Uint8Array) {
  let n = 0xffffffff;
  for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
/** Closed PNG policy: 8-bit RGB/RGBA, non-interlaced, <=4 MP. Strip ancillary metadata. */
export function validatePng(input: Uint8Array) {
  requireContent(input.byteLength > 0 && input.byteLength <= maxPngBytes, 'TOO_LARGE', 413);
  const b = Buffer.from(input);
  requireContent(b.subarray(0, 8).equals(signature));
  let at = 8,
    width = 0,
    height = 0,
    channels = 0,
    phase = 0,
    ended = false,
    transparency = false;
  const chunks: Buffer[] = [signature],
    compressed: Buffer[] = [];
  while (at < b.length) {
    requireContent(at + 12 <= b.length);
    const size = b.readUInt32BE(at),
      type = b.toString('ascii', at + 4, at + 8);
    requireContent(
      size <= maxPngBytes &&
        at + 12 + size <= b.length &&
        /^[A-Za-z]{4}$/.test(type) &&
        /[A-Z]/.test(type[2]),
    );
    const data = b.subarray(at + 8, at + 8 + size);
    requireContent(pngCrc(b.subarray(at + 4, at + 8 + size)) === b.readUInt32BE(at + 8 + size));
    if (phase === 0) {
      requireContent(type === 'IHDR' && size === 13);
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      requireContent(
        width >= 1 && height >= 1 && width <= 4096 && height <= 4096 && width * height <= 4194304,
      );
      requireContent(
        data[8] === 8 &&
          [2, 6].includes(data[9]) &&
          data[10] === 0 &&
          data[11] === 0 &&
          data[12] === 0,
      );
      channels = data[9] === 6 ? 4 : 3;
      phase = 1;
      chunks.push(b.subarray(at, at + size + 12));
    } else if (type === 'IDAT') {
      requireContent(phase <= 2);
      phase = 2;
      compressed.push(data);
      chunks.push(b.subarray(at, at + size + 12));
    } else if (type === 'IEND') {
      requireContent(size === 0 && compressed.length > 0 && at + 12 === b.length);
      chunks.push(b.subarray(at, at + 12));
      ended = true;
      break;
    } else {
      requireContent(type !== 'IHDR' && !['acTL', 'fcTL', 'fdAT'].includes(type));
      if (phase === 2) phase = 3;
      if (type === 'tRNS') {
        requireContent(
          !transparency &&
            phase === 1 &&
            channels === 3 &&
            size === 6 &&
            [0, 2, 4].every((n) => data.readUInt16BE(n) <= 255),
        );
        transparency = true;
        chunks.push(b.subarray(at, at + size + 12));
      } else requireContent(/[a-z]/.test(type[0])); // No unknown critical chunks / palettes.
    }
    at += size + 12;
  }
  requireContent(ended);
  const zipped = Buffer.concat(compressed),
    row = width * channels + 1,
    length = row * height;
  try {
    const decoded = inflateSync(zipped, { maxOutputLength: length + 1, info: true }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    requireContent(
      decoded.buffer.length === length && decoded.engine.bytesWritten === zipped.length,
    );
    for (let y = 0; y < height; y++) requireContent(decoded.buffer[y * row] <= 4);
  } catch (e) {
    if (e instanceof ContentError) throw e;
    throw new ContentError('INVALID_INPUT');
  }
  const bytes = Buffer.concat(chunks);
  return { bytes, width, height, digest: createHash('sha256').update(bytes).digest('hex') };
}

/** PNG composition preserves A/B plain-text whitespace. The frozen Bridge validator
 * still verifies the exact non-text projection; neither its code nor production root changes. */
export function validatePngDocument(
  document: MaicDocument,
  stage: string,
  refs: AssetExpectations,
) {
  boundedJson(document);
  requireContent(refs instanceof Map);
  const probe = JSON.parse(JSON.stringify(document)) as MaicDocument;
  for (const scene of probe.scenes) {
    requireContent(scene.content.type === 'slide');
    for (const e of scene.content.canvas.elements)
      if (e.type === 'text') {
        requireContent(
          typeof e.content === 'string' &&
            e.content.length <= 2000 &&
            !/[<>&\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(e.content),
        );
        e.content = e.content.replace(/[\n\r\t]/g, ' ');
      }
  }
  validateDocument(probe, stage, refs);
  const normalized = JSON.parse(JSON.stringify(document)) as MaicDocument;
  for (const scene of normalized.scenes) {
    requireContent(scene.content.type === 'slide');
    for (const e of scene.content.canvas.elements)
      if (e.type === 'image') {
        const ref = refs.get(e.src.slice(6));
        requireContent(ref && ref.sceneRef === scene.id && ref.purpose === 'IMAGE');
        e.src = `asset:${ref.byteDigest}`;
      }
  }
  const digest = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
  return {
    digest: digest(normalized),
    scenes: normalized.scenes.map((s, i) => ({ ref: s.id, ordinal: i, digest: digest(s) })),
  };
}
export function pngStorageDocument(
  document: MaicDocument,
  direction: 'WRITE' | 'READ',
): MaicDocument {
  boundedJson(document);
  const result = JSON.parse(JSON.stringify(document)) as MaicDocument;
  for (const scene of result.scenes) {
    requireContent(scene.content.type === 'slide');
    for (const e of scene.content.canvas.elements)
      if (e.type === 'image') {
        requireContent(typeof e.src === 'string');
        e.src = direction === 'WRITE' ? e.src.slice(6) : `asset:${e.src}`;
      }
  }
  return result;
}
