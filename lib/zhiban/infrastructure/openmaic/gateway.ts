import { BridgeError, check } from './validation';
import type { Deadline } from './transactions';

export const gatewayHeaders = Object.freeze({
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
});
export function singleRange(range: string | null, length: number): readonly [number, number] {
  check(Number.isSafeInteger(length) && length >= 1 && length <= 4194304);
  if (range === null) return [0, length - 1];
  check(range.length <= 64);
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  check(match !== null && (match[1] !== '' || match[2] !== ''));
  for (const part of [match[1], match[2]])
    if (part !== '') check(Number.isSafeInteger(Number(part)));
  const start = match[1] === '' ? Math.max(0, length - Number(match[2])) : Number(match[1]),
    end =
      match[1] === ''
        ? length - 1
        : match[2] === ''
          ? length - 1
          : Math.min(length - 1, Number(match[2]));
  check(
    Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      start < length &&
      end >= start &&
      (match[1] !== '' || Number(match[2]) > 0),
  );
  return [start, end];
}
/** Protocol-neutral sink; authorization precedes HEAD/range parsing and every emitted chunk. */
export async function deliverAsset(
  mode: 'GET' | 'HEAD',
  range: string | null,
  load: () => Promise<{ bytes: Uint8Array; mime: string }>,
  reauthorize: () => Promise<void>,
  write: (chunk: Uint8Array) => Promise<void>,
  deadline: Deadline,
  open: (headers: Readonly<Record<string, string>>) => Promise<void> = async () => {},
) {
  try {
    await deadline.wait(reauthorize());
    deadline.assert();
    const asset = await deadline.wait(load());
    check(['image/png', 'audio/wav', 'video/webm'].includes(asset.mime));
    const [start, end] = singleRange(range, asset.bytes.byteLength);
    await deadline.wait(reauthorize());
    deadline.assert();
    check(mode === 'GET' || mode === 'HEAD');
    const headers = Object.freeze({
      ...gatewayHeaders,
      'Content-Type': asset.mime,
      'Content-Length': String(end - start + 1),
      ...(range === null
        ? {}
        : { 'Content-Range': `bytes ${start}-${end}/${asset.bytes.byteLength}` }),
    });
    await deadline.wait(open(headers));
    if (mode === 'GET')
      for (let pos = start; pos <= end; pos += 65536) {
        await deadline.wait(reauthorize());
        deadline.assert();
        await deadline.wait(write(asset.bytes.slice(pos, Math.min(pos + 65536, end + 1))));
        deadline.assert();
      }
    return headers;
  } catch {
    throw new BridgeError();
  }
}
