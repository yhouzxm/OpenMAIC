/** Transport contract unit fixture only; actual model acceptance remains the separate real journey. */
import { it, expect, vi, beforeEach } from 'vitest';
const f = vi.hoisted(() => ({ call: vi.fn(), resolve: vi.fn() }));
vi.mock('../../../lib/server/resolve-model', () => ({ resolveModel: f.resolve }));
vi.mock('../../../lib/ai/llm', () => ({ callLLM: f.call }));
import { nativeEmaEngine } from '../../../lib/zhiban/infrastructure/ema/native';
import { dimensions } from '../../../lib/zhiban/domain/ema/model';
const run = {
  id: 'fixture',
  lease: 'fixture',
  purpose: 'controlled transport test',
  promptVersion: 'ema-six-v1',
  evidence: [
    {
      kind: 'GRADE',
      id: 'fixture',
      digest: 'fixture',
      snapshot: { scorePoints: 8800, maxPoints: 10000 },
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  f.resolve.mockResolvedValue({
    model: {},
    providerId: 'CONTROLLED_UNIT_ONLY',
    modelId: 'NOT_REAL_ACCEPTANCE',
    serverManaged: true,
    modelInfo: { outputWindow: 128000 },
  });
  f.call.mockResolvedValue({
    finishReason: 'stop',
    text: JSON.stringify({
      findings: dimensions.map((d) => ({
        dimension: d.id,
        state: 'INSUFFICIENT',
        observation: '缺少过程证据。',
        evidence: [],
      })),
    }),
  });
});
it('keeps single-model provenance and bounded reasoning/output instead of implicit fallback', async () => {
  const r = await nativeEmaEngine.generate(run, new AbortController().signal);
  expect(f.call).toHaveBeenCalledTimes(1);
  const args = f.call.mock.calls[0];
  expect(args[4]).toEqual({ enabled: false, serverManaged: true });
  expect(args[3]).toMatchObject({ effort: 'low' });
  expect(args[0].maxOutputTokens).toBe(6144);
  expect(r.model.promptSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(r.model.model).toBe('NOT_REAL_ACCEPTANCE');
});
it('refuses a token-exhausted response even if its partial text happens to parse', async () => {
  f.call.mockResolvedValue({ finishReason: 'length', text: '{}' });
  await expect(nativeEmaEngine.generate(run, new AbortController().signal)).rejects.toThrow(
    'EMA_MODEL_FAILED',
  );
  expect(f.call).toHaveBeenCalledTimes(1);
});
it('preserves explicit deployment thinking configuration', async () => {
  f.resolve.mockResolvedValue({
    model: {},
    providerId: 'CONTROLLED_UNIT_ONLY',
    modelId: 'NOT_REAL_ACCEPTANCE',
    serverManaged: true,
    thinkingConfig: { mode: 'enabled', effort: 'medium' },
  });
  await nativeEmaEngine.generate(run, new AbortController().signal);
  expect(f.call.mock.calls[0][3]).toEqual({ mode: 'enabled', effort: 'medium' });
});
