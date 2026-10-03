import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { HttpFacade } from '@/lib/zhiban/infrastructure/identity/http/adapter';

/** Fixture overrides are case-insensitive replacements; omission is explicit. */
export function requestHeaders(
  defaults: HeadersInit,
  overrides: HeadersInit = {},
  omitted: readonly string[] = [],
) {
  const headers = new Headers(defaults);
  for (const [name, value] of new Headers(overrides)) headers.set(name, value);
  for (const name of omitted) headers.delete(name);
  return headers;
}

/** Real transport, not a direct handler call. Bound only to loopback; no raw request logging. */
export async function listen(facade: HttpFacade) {
  const server = createServer({ maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2)
        headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
      const method = incoming.method ?? 'GET';
      const request = new Request('http://127.0.0.1' + incoming.url, {
        method,
        headers,
        ...(!['GET', 'HEAD'].includes(method)
          ? { body: Readable.toWeb(incoming), duplex: 'half' }
          : {}),
      } as RequestInit);
      const response = await facade.handle(request);
      outgoing.statusCode = response.status;
      response.headers.forEach((v, k) => outgoing.setHeader(k, v));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.statusCode = 503;
      outgoing.setHeader('Cache-Control', 'no-store');
      outgoing.end();
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Synthetic listener unavailable.');
  return {
    base: `http://127.0.0.1:${address.port}/api/zhiban/identity/`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
