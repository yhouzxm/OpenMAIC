import { expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { validatePng, pngCrc } from '@/lib/zhiban/infrastructure/content/png';
export function chunk(type: string, data: Buffer) {
  const b = Buffer.alloc(data.length + 12);
  b.writeUInt32BE(data.length);
  b.write(type, 4);
  data.copy(b, 8);
  b.writeUInt32BE(pngCrc(b.subarray(4, -4)), b.length - 4);
  return b;
}
export function png(width = 2, height = 2, pixels?: Buffer) {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(width);
  h.writeUInt32BE(height, 4);
  h[8] = 8;
  h[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', h),
    chunk('IDAT', deflateSync(pixels ?? Buffer.alloc((width * 4 + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
it('accepts a complete bounded RGBA stream and strips ancillary payloads', () => {
  const original = png(),
    text = chunk('tEXt', Buffer.from('label\0private'));
  const withText = Buffer.concat([original.subarray(0, 33), text, original.subarray(33)]);
  expect(validatePng(withText).bytes).toEqual(original);
  expect(validatePng(original)).toMatchObject({ width: 2, height: 2 });
});
it('rejects signatures without valid chunks, CRC corruption, EOF tails and APNG', () => {
  const b = png();
  const corrupt = Buffer.from(b);
  corrupt[corrupt.length - 1] ^= 1;
  for (const input of [
    b.subarray(0, 24),
    corrupt,
    Buffer.concat([b, Buffer.from([0])]),
    Buffer.concat([b.subarray(0, 33), chunk('acTL', Buffer.alloc(8)), b.subarray(33)]),
  ])
    expect(() => validatePng(input)).toThrow();
});
it('rejects oversized dimensions, short scanlines, invalid filters and deflate tails', () => {
  expect(() => validatePng(png(4096, 4096))).toThrow();
  expect(() => validatePng(png(2, 2, Buffer.alloc(1)))).toThrow();
  const pixels = Buffer.alloc(18);
  pixels[0] = 5;
  expect(() => validatePng(png(2, 2, pixels))).toThrow();
  const b = png();
  const bad = Buffer.concat([
    b.subarray(0, 33),
    chunk('IDAT', Buffer.concat([deflateSync(Buffer.alloc(18)), Buffer.from([1, 2, 3])])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  expect(() => validatePng(bad)).toThrow();
});
