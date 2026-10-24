import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<{ fetchImpl?: unknown; apiKey?: string }>);
const dnsFixture = vi.hoisted(() => ({ address: '93.184.216.34' }));
// This is a model-construction contract, not an external DNS/network test.
vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      lookup: vi.fn(async (hostname: string) => {
        if (hostname !== 'api.openai.com') throw Error('Unexpected DNS fixture host');
        return [{ address: dnsFixture.address, family: 4 }];
      }),
    },
  };
});

vi.mock('@/lib/ai/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/providers')>()),
  getModel: (config: { fetchImpl?: unknown; apiKey?: string }) => {
    calls.push(config);
    return { model: {}, modelInfo: null };
  },
}));

const { languageModelFor } = await import('@/lib/server/model-config/llm');
const { clientBaseUrlLlmFetch } = await import('@/lib/server/llm-provider-fetch');
const { fetchWithRedirectValidation } = await import('@/lib/server/fetch-with-redirect-validation');

const target = (providerSource: 'deployment' | 'workspace') => ({
  providerId: 'p',
  providerSource,
  presetId: 'openai',
  registryId: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'k',
  modelId: 'gpt-5.6',
});

describe('the transport a slot model gets', () => {
  it('refuses redirects for a workspace endpoint', async () => {
    await languageModelFor(target('workspace'));
    expect(calls.at(-1)?.fetchImpl).toBe(clientBaseUrlLlmFetch);
  });

  it('still refuses a workspace endpoint resolving into the local fake-IP range', async () => {
    const count = calls.length;
    dnsFixture.address = '198.18.0.9';
    vi.stubEnv('ALLOW_LOCAL_NETWORKS', '');
    try {
      await expect(languageModelFor(target('workspace'))).rejects.toMatchObject({
        code: 'INVALID_URL',
      });
      expect(calls).toHaveLength(count);
    } finally {
      dnsFixture.address = '93.184.216.34';
      vi.unstubAllEnvs();
    }
  });

  it('keeps the operator transport for a deployment provider', async () => {
    await languageModelFor(target('deployment'));
    expect(calls.at(-1)?.fetchImpl).toBe(fetchWithRedirectValidation);
  });
});
