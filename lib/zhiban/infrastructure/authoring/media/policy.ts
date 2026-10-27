/** Exact tenant-host request shapes. Provider credentials/URLs never come from the browser. */
import { requireContent } from '../../content/model';
export type MediaKind = 'image' | 'video' | 'tts' | 'asr';
export const MEDIA_BYTES = 25 * 1024 * 1024;
export function mediaInput(kind: Exclude<MediaKind, 'asr'>, value: unknown) {
  const v = value as Record<string, unknown>;
  requireContent(v && typeof v === 'object' && !Array.isArray(v));
  const fields =
    kind === 'tts'
      ? ['text', 'audioId', 'ttsVoice', 'ttsSpeed', 'ttsProviderOptions']
      : kind === 'image'
        ? ['prompt', 'negativePrompt', 'width', 'height', 'aspectRatio', 'style', 'stageId']
        : ['prompt', 'duration', 'aspectRatio', 'resolution'];
  requireContent(Object.keys(v).every((k) => fields.includes(k)));
  const field = kind === 'tts' ? 'text' : 'prompt';
  requireContent(
    typeof v[field] === 'string' &&
      (v[field] as string).trim().length > 0 &&
      (v[field] as string).length <= 8000,
  );
  for (const k of ['negativePrompt', 'style', 'resolution', 'audioId'])
    if (v[k] !== undefined)
      requireContent(typeof v[k] === 'string' && (v[k] as string).length <= 1000);
  if (kind === 'tts')
    requireContent(typeof v.audioId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v.audioId));
  for (const k of ['width', 'height'])
    if (v[k] !== undefined)
      requireContent(Number.isInteger(v[k]) && (v[k] as number) >= 64 && (v[k] as number) <= 2048);
  if (v.duration !== undefined)
    requireContent(
      Number.isInteger(v.duration) && (v.duration as number) >= 1 && (v.duration as number) <= 15,
    );
  if (v.aspectRatio !== undefined)
    requireContent(['16:9', '4:3', '1:1', '9:16'].includes(v.aspectRatio as string));
  if (v.stageId !== undefined)
    requireContent(
      typeof v.stageId === 'string' && v.stageId.length > 0 && v.stageId.length <= 128,
    );
  return kind === 'tts' ? { text: v.text, audioId: v.audioId } : v;
}
export async function boundedBytes(response: Response, max = MEDIA_BYTES) {
  requireContent(response.ok, 'MEDIA_UPSTREAM_FAILED', 502);
  const reader = response.body?.getReader();
  requireContent(reader, 'MEDIA_EMPTY', 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      requireContent(size <= max, 'MEDIA_TOO_LARGE', 413);
      chunks.push(r.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  requireContent(size > 0, 'MEDIA_EMPTY', 502);
  return Buffer.concat(chunks, size);
}
/** Container signature only; the native renderer still decides codec/content validity. */
export function mediaContainer(bytes: Buffer, mime: string) {
  const text = (a: number, b: number) => bytes.subarray(a, b).toString('ascii');
  const header = bytes.subarray(0, 4).toString('hex');
  return mime === 'image/png'
    ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    : mime === 'image/jpeg'
      ? bytes.subarray(0, 3).toString('hex') === 'ffd8ff'
      : mime === 'image/webp'
        ? text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP'
        : mime === 'image/gif'
          ? ['GIF87a', 'GIF89a'].includes(text(0, 6))
          : mime === 'audio/wav'
            ? text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE'
            : mime === 'audio/mpeg'
              ? text(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224)
              : mime === 'audio/ogg'
                ? text(0, 4) === 'OggS'
                : mime === 'video/webm'
                  ? header === '1a45dfa3'
                  : ['video/mp4', 'video/quicktime'].includes(mime)
                    ? text(4, 8) === 'ftyp'
                    : false;
}
/** Native image adapters may return bare base64 without a MIME label. Never guess executable types. */
export function generatedMime(bytes: Buffer, kind: 'image' | 'video' | 'tts', declared?: string) {
  const allowed =
    kind === 'image'
      ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
      : kind === 'video'
        ? ['video/mp4', 'video/webm', 'video/quicktime']
        : ['audio/wav', 'audio/mpeg', 'audio/ogg'];
  const label =
    ({ 'image/jpg': 'image/jpeg', 'audio/x-wav': 'audio/wav' } as Record<string, string>)[
      declared ?? ''
    ] ??
    declared?.toLowerCase().split(';')[0] ??
    '';
  if (label && label !== 'application/octet-stream') {
    requireContent(
      allowed.includes(label) && mediaContainer(bytes, label),
      'MEDIA_INVALID_CONTAINER',
      502,
    );
    return label;
  }
  const detected = allowed.find((m) => mediaContainer(bytes, m));
  requireContent(detected, 'MEDIA_INVALID_CONTAINER', 502);
  return detected;
}
