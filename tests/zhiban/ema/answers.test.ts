import { describe, expect, it } from 'vitest';
import { DEFAULT_EMA_QUESTIONS, validateEmaAnswers } from '@/lib/zhiban/ema';

describe('EMA answers', () => {
  it('accepts complete bounded scale answers and optional notes', () => {
    expect(() =>
      validateEmaAnswers(DEFAULT_EMA_QUESTIONS, { confidence: 4, difficulty: 3, emotion: 5 }),
    ).not.toThrow();
  });
  it('rejects missing or out-of-range required answers', () => {
    expect(() => validateEmaAnswers(DEFAULT_EMA_QUESTIONS, {})).toThrow('confidence');
    expect(() =>
      validateEmaAnswers(DEFAULT_EMA_QUESTIONS, { confidence: 8, difficulty: 3, emotion: 4 }),
    ).toThrow('out of range');
  });
});
