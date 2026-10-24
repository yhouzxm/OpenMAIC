/** Browser-safe display catalogue shared with the executable server registry. */
import { FIRECRAWL_DEFAULT_BASE_URL } from '@/lib/web-search/firecrawl-endpoint';
import { PROVIDERS } from '@/lib/ai/providers';
import type { WebFetchProviderInfo } from './types';
export const WEB_FETCH_CATALOG: Record<string, WebFetchProviderInfo & { defaultBaseUrl?: string }> =
  {
    builtin: {
      id: 'builtin',
      name: 'Built-in reader',
      nameKey: 'settings.providerNames.builtin',
      requiresApiKey: false,
    },
    kimi: {
      id: 'kimi',
      defaultBaseUrl: PROVIDERS.kimi.defaultBaseUrl,
      name: 'Kimi',
      icon: PROVIDERS.kimi.icon,
      requiresApiKey: true,
      credentialPresets: ['kimi', 'kimi-coding-plan'],
    },
    deepseek: {
      id: 'deepseek',
      defaultBaseUrl: PROVIDERS.deepseek.defaultBaseUrl,
      name: 'DeepSeek',
      icon: PROVIDERS.deepseek.icon,
      requiresApiKey: true,
      credentialPresets: ['deepseek'],
    },
    firecrawl: {
      defaultBaseUrl: FIRECRAWL_DEFAULT_BASE_URL,
      id: 'firecrawl',
      name: 'Firecrawl',
      requiresApiKey: true,
    },
  };
