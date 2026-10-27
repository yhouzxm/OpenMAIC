/** Strict public, DNS-pinned asset fetch. No URL-taking HTTP proxy is exposed by this host. */
import { createValidatedDispatcher } from '@/lib/server/pinned-dispatcher';
import { validatePublicUrlForSSRF } from '@/lib/server/ssrf-guard';
import { requireContent } from '../../content/model';
import { boundedBytes } from './policy';
export async function generatedBytes(url: string, signal: AbortSignal) {
  const dispatcher = createValidatedDispatcher({
    allowLocalNetworks: false,
    headersTimeout: 30000,
    bodyTimeout: 30000,
  });
  try {
    for (let hop = 0; ; hop++) {
      requireContent(!(await validatePublicUrlForSSRF(url)), 'MEDIA_URL_REFUSED', 502);
      const r = await fetch(url, { redirect: 'manual', signal, dispatcher } as RequestInit);
      if (r.status >= 300 && r.status < 400) {
        const location = r.headers.get('location');
        await r.body?.cancel();
        requireContent(location && hop < 4, 'MEDIA_URL_REFUSED', 502);
        url = new URL(location, url).href;
        continue;
      }
      return {
        bytes: await boundedBytes(r),
        mime: r.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream',
      };
    }
  } finally {
    void dispatcher.destroy().catch(() => {});
  }
}
