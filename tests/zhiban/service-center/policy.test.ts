import { describe, it, expect } from 'vitest';
import {
  settingsInput,
  probeInput,
  auditSummary,
} from '@/lib/zhiban/infrastructure/service-center/policy';
import { currentServiceTenant, withServiceTenant } from '@/lib/server/service-scope';
import { applyModelSettingsChange } from '@/lib/server/model-config/settings';
import { setDeploymentConfigForTests } from '@/lib/server/model-config/runtime';
import { aggregateUsage } from '@/lib/usage/aggregate';
import type { UsageRecord } from '@/lib/server/usage-storage';
describe('service center boundary', () => {
  it('retains deployment locks for administrator workspace changes', async () => {
    setDeploymentConfigForTests({
      legacy: false,
      notices: [],
      layer: {
        source: 'deployment',
        config: { providers: {}, slots: { image: null }, lock: 'all', allowUserKeys: false },
      },
    });
    try {
      await expect(
        applyModelSettingsChange(null, { kind: 'slots', set: { image: null } }),
      ).rejects.toMatchObject({ code: 'SLOT_LOCKED' });
    } finally {
      setDeploymentConfigForTests();
    }
  });
  it('refuses privilege fields and browser probe credentials/targets', () => {
    expect(
      settingsInput.safeParse({
        revision: null,
        change: { kind: 'slots', set: { image: null } },
        tenant: 'other',
      }).success,
    ).toBe(false);
    for (const extra of [
      { apiKey: 'secret' },
      { baseUrl: 'http://127.0.0.1' },
      { ownerId: 'foreign' },
    ])
      expect(
        probeInput.safeParse({ provider: 'saved', kind: 'image', revision: 1, ...extra }).success,
      ).toBe(false);
  });
  it('records a useful audit summary without keys, URLs or models', () => {
    const change = {
      kind: 'provider' as const,
      id: 'saved',
      preset: 'openai',
      apiKey: 'secret',
      baseUrl: 'https://private.example',
      models: ['internal'],
    };
    expect(auditSummary(change)).toEqual({
      kind: 'provider',
      provider: 'saved',
      preset: 'openai',
      keyChanged: true,
    });
  });
  it('isolates trusted service attribution across concurrent asynchronous calls', async () => {
    const result = await Promise.all(
      ['a', 'b'].map((t) =>
        withServiceTenant(t, async () => {
          await new Promise((r) => setTimeout(r, t === 'a' ? 10 : 1));
          return currentServiceTenant();
        }),
      ),
    );
    expect(result).toEqual(['a', 'b']);
    expect(currentServiceTenant()).toBeUndefined();
  });
  it('reuses native usage aggregation over only the selected scope', () => {
    const row = (tenantId?: string) =>
      ({
        tenantId,
        kind: 'llm',
        unit: 'token',
        modelString: 'p:m',
        inputTokens: 4,
        outputTokens: 2,
        cacheReadTokens: 1,
        cacheCreationTokens: 0,
        createdAt: 1,
      }) as UsageRecord;
    const records = [row('a'), row('b'), row()];
    expect(aggregateUsage(records.filter((r) => r.tenantId === 'a')).totals).toEqual({
      requests: 1,
      llmTokens: 6,
    });
  });
});
