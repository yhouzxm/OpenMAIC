import { describe, it, expect } from 'vitest';
import {
  mediaInput,
  boundedBytes,
  generatedMime,
} from '@/lib/zhiban/infrastructure/authoring/media/policy';
describe('course media request boundary', () => {
  it('refuses caller credentials/endpoints/providers and oversized options', () => {
    for (const field of [
      'apiKey',
      'baseUrl',
      'providerId',
      'previewProvider',
      'url',
      'referenceAudio',
      'signal',
    ])
      expect(() => mediaInput('image', { prompt: 'lesson', [field]: 'private' })).toThrow();
    expect(() => mediaInput('video', { prompt: 'lesson', duration: 100 })).toThrow();
    expect(() => mediaInput('image', { prompt: 'lesson', width: 10000 })).toThrow();
  });
  it('projects native TTS UI preferences to operator-default voice without forwarding clone options', () => {
    expect(
      mediaInput('tts', {
        text: 'lesson',
        audioId: 'audio',
        ttsVoice: 'auto-id',
        ttsSpeed: 2,
        ttsProviderOptions: { baseUrl: 'http://localhost' },
      }),
    ).toEqual({ text: 'lesson', audioId: 'audio' });
  });
  it('enforces output cap while streaming and cancels the remaining body', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(8));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(boundedBytes(new Response(stream), 4)).rejects.toMatchObject({
      code: 'MEDIA_TOO_LARGE',
    });
    expect(cancelled).toBe(true);
  });
});
import { providerEnvironment } from '@/lib/zhiban/infrastructure/authoring/media/environment';
it('delivers provider environment without redirecting LOCAL data/process boundaries', () => {
  expect(
    providerEnvironment({
      GLM_API_KEY: 'keep',
      TTS_QWEN_API_KEY: 'keep',
      OPENMAIC_CONFIG: '/private/config',
      DATABASE_URL: 'blocked',
      PGHOST: 'blocked',
      NODE_OPTIONS: 'blocked',
      PATH: 'blocked',
      HOME: 'blocked',
      NEXT_PUBLIC_API_KEY: 'blocked',
    }),
  ).toEqual({ GLM_API_KEY: 'keep', TTS_QWEN_API_KEY: 'keep', OPENMAIC_CONFIG: '/private/config' });
});

it('recognizes native bare inline PNG and refuses a contradictory MIME', () => {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  expect(generatedMime(png, 'image')).toBe('image/png');
  expect(generatedMime(png, 'image', 'application/octet-stream')).toBe('image/png');
  expect(() => generatedMime(png, 'image', 'image/jpeg')).toThrow();
  expect(() => generatedMime(Buffer.from('<svg/>'), 'image')).toThrow();
});
