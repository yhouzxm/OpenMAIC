/** GLM's classroom microphone accepts bounded PCM WAV, never a MIME-only claim. */
export const isGlmAsr = (provider: string, model?: string) =>
  provider === 'openai-whisper' && model === 'glm-asr-2512';
export const GLM_RECORDING_SECONDS = 25;
export function validateClassroomWav(bytes: Uint8Array): number {
  const fail = () => {
    throw new Error('语音须为有效 PCM WAV，且不超过 30 秒');
  };
  if (bytes.length < 44 || bytes.length > 5242880) return fail();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || v.getUint32(4, true) + 8 !== bytes.length)
    return fail();
  let rate = 0,
    align = 0,
    size = 0,
    fmt = false,
    data = false,
    at = 12,
    chunks = 0;
  while (at + 8 <= bytes.length && ++chunks <= 64) {
    const n = v.getUint32(at + 4, true),
      end = at + 8 + n;
    if (end > bytes.length) return fail();
    if (tag(at) === 'fmt ') {
      if (fmt || n < 16) return fail();
      fmt = true;
      const channels = v.getUint16(at + 10, true);
      rate = v.getUint32(at + 12, true);
      align = v.getUint16(at + 20, true);
      if (
        v.getUint16(at + 8, true) !== 1 ||
        ![1, 2].includes(channels) ||
        rate < 8000 ||
        rate > 48000 ||
        v.getUint16(at + 22, true) !== 16 ||
        align !== channels * 2 ||
        v.getUint32(at + 16, true) !== rate * align
      )
        return fail();
    } else if (tag(at) === 'data') {
      if (data) return fail();
      data = true;
      size = n;
    }
    at = end + (n % 2);
  }
  if (at !== bytes.length || !fmt || !data || !size || size % align || size / align / rate > 30)
    return fail();
  return size / align / rate;
}
