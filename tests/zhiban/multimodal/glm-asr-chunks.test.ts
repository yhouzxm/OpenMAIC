import { describe, it, expect } from 'vitest';
import {
  mediaAsrChunkSeconds,
  mediaChunkWindows,
  maxMediaChunkCheckpoints,
} from '@/lib/document/extractors/local-media';

describe('configured GLM-ASR media extraction', () => {
  it('splits a longer recording into windows below the real 30-second provider limit', () => {
    const seconds = mediaAsrChunkSeconds({ modelId: 'glm-asr-2512' });
    const windows = mediaChunkWindows(61, seconds);
    expect(windows.map((w) => [w.startMs, w.endMs])).toEqual([
      [0, 25000],
      [25000, 50000],
      [50000, 61000],
    ]);
    expect(windows.every((w) => w.endMs - w.startMs < 30000)).toBe(true);
    expect(maxMediaChunkCheckpoints(seconds)).toBe(216);
  });
  it('retains the original chunking for other configured models', () => {
    const seconds = mediaAsrChunkSeconds({ modelId: 'whisper-1' });
    expect(mediaChunkWindows(601, seconds).map((w) => [w.startMs, w.endMs])).toEqual([
      [0, 600000],
      [600000, 601000],
    ]);
    expect(maxMediaChunkCheckpoints()).toBe(9);
  });
});
