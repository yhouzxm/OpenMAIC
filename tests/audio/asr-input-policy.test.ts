import { describe, expect, it } from 'vitest';
import { isGlmAsr, validateClassroomWav } from '@/lib/audio/asr-input-policy';
import { normalizeASRUploadAudio } from '@/lib/audio/wav-utils';
function wav(seconds = 1) {
  const b = Buffer.alloc(44 + 16000 * 2 * seconds);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(b.length - 44, 40);
  return b;
}
describe('classroom GLM audio boundary', () => {
  it('accepts actual PCM through 30 seconds and preserves the browser WAV upload', async () => {
    expect(validateClassroomWav(wav(30))).toBe(30);
    const b = new Blob([wav()], { type: 'audio/wav' });
    expect((await normalizeASRUploadAudio('openai-whisper', b, 'glm-asr-2512')).fileName).toBe(
      'recording.wav',
    );
    expect(isGlmAsr('openai-whisper', 'whisper-1')).toBe(false);
  });
  it('rejects excess duration, truncated data and a claimed WAV with non-WAV bytes', () => {
    for (const b of [wav(31), wav().subarray(0, 44), Buffer.from('fake audio/wav')])
      expect(() => validateClassroomWav(b)).toThrow();
  });
  it('rejects forged rate, compressed format and duplicate data chunks', () => {
    for (const [at, value] of [
      [28, 1],
      [20, 3],
      [32, 4],
    ]) {
      const b = wav();
      b.writeUInt16LE(value, at);
      expect(() => validateClassroomWav(b)).toThrow();
    }
    const b = Buffer.concat([wav(), Buffer.from('data\0\0\0\0')]);
    b.writeUInt32LE(b.length - 8, 4);
    expect(() => validateClassroomWav(b)).toThrow();
  });
});
