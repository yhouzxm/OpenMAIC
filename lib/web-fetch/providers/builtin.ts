import { WEB_FETCH_CATALOG } from '../catalog';
import type { WebFetchProvider } from '../types';

export const builtin: Extract<WebFetchProvider, { hosted: false }> = {
  ...WEB_FETCH_CATALOG.builtin,
  hosted: false,
  resolveCredentials: () => ({}),
  extract: async (url, options) => {
    const { fetchAndExtractUrl } = await import('../builtin-extraction');
    return fetchAndExtractUrl(url, options);
  },
};

export default builtin;
