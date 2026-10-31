import { INTERACTIVE_FRAME_CSP } from './interactive';
import { publishedPlayerDocument, attemptRuntimeDocument, PUBLISHED_PLAYER_CSP } from './player';
import { Deadline, admittedOperation } from '../openmaic/transactions';
import { observeOperation } from '../identity/composition/refusals';
import type { IdentityAuthentication } from '../identity/composition/authentication';
import { academicSessionAuthentication } from '../academic/session-authentication';
import {
  body,
  cookie,
  headers,
  response,
  failure,
  requestId,
  ProtocolRefusal,
} from '../identity/http/protocol';
import { ContentService, type ContentContext } from './service';
import { id, revision, requireContent, ContentError } from './model';
export function contentHttp(
  service: ContentService,
  security: IdentityAuthentication,
  origin: string,
  lesson?: { handle(x: ContentContext, request: Request, value?: unknown): Promise<unknown> },
) {
  const authenticate = academicSessionAuthentication((token) => security.authenticate(token));
  let active = 0,
    streams = 0;
  return async (request: Request) => {
    const trace = requestId();
    if (active >= 4) return failure(trace, 503, 'UNAVAILABLE');
    active++;
    try {
      requireContent(!request.headers.has('content-encoding'), 'INVALID_INPUT', 400);
      const ai = new URL(request.url).pathname.endsWith('/ai');
      const url = new URL(request.url),
        match =
          /^\/api\/zhiban\/content\/([^/]+)\/offerings\/([^/]+)(?:\/resources\/([^/]+)\/(preview|assets|player|frame|runtime|records)(?:\/([^/]+))?)?$/.exec(
            ai ? url.pathname.slice(0, -3) : url.pathname,
          );
      requireContent(match && (!ai || !match[3]), 'NOT_FOUND', 404);
      const assetRead =
        match[4] === 'assets' && !!match[5] && ['GET', 'HEAD'].includes(request.method);
      const recordsRead = match[4] === 'records' && !match[5] && request.method === 'GET';
      const playerRead = match[4] === 'player' && !match[5] && request.method === 'GET';
      const frameRead = match[4] === 'frame' && !match[5] && request.method === 'GET';
      const upload = match[4] === 'assets' && !match[5] && request.method === 'POST';
      const protocolHeaders = new Headers(request.headers);
      if ((playerRead || recordsRead) && !protocolHeaders.has('x-zhiban-request')) {
        requireContent(
          ['same-origin', 'none'].includes(protocolHeaders.get('sec-fetch-site') ?? '') &&
            protocolHeaders.get('sec-fetch-dest') === 'document' &&
            protocolHeaders.get('sec-fetch-mode') === 'navigate',
          'FORBIDDEN',
          403,
        );
        const referer = protocolHeaders.get('referer');
        requireContent(!referer || new URL(referer).origin === origin, 'FORBIDDEN', 403);
        protocolHeaders.set('x-zhiban-request', 'identity-v1');
      }
      if (frameRead && !protocolHeaders.has('x-zhiban-request')) {
        requireContent(
          protocolHeaders.get('sec-fetch-site') === 'same-origin' &&
            protocolHeaders.get('sec-fetch-dest') === 'iframe' &&
            protocolHeaders.get('sec-fetch-mode') === 'navigate' &&
            !!protocolHeaders.get('referer') &&
            new URL(protocolHeaders.get('referer')!).origin === origin,
          'FORBIDDEN',
          403,
        );
        protocolHeaders.set('x-zhiban-request', 'identity-v1');
      }
      if (assetRead && !protocolHeaders.has('x-zhiban-request')) {
        requireContent(
          protocolHeaders.get('sec-fetch-site') === 'same-origin' &&
            protocolHeaders.get('sec-fetch-dest') === 'image',
          'FORBIDDEN',
          403,
        );
        const referer = protocolHeaders.get('referer');
        requireContent(referer && new URL(referer).origin === origin, 'FORBIDDEN', 403);
        protocolHeaders.set('x-zhiban-request', 'identity-v1');
      }
      if (upload) {
        requireContent(
          request.headers.get('content-type') === 'image/png',
          'UNSUPPORTED_MEDIA_TYPE',
          415,
        );
        protocolHeaders.set('content-type', 'application/json');
      }
      headers(
        new Request(request.url, { headers: protocolHeaders }),
        origin,
        request.method === 'POST',
      );
      const tenant = id(match[1]),
        offering = id(match[2]);
      requireContent(
        ['GET', 'POST', ...(assetRead ? ['HEAD'] : [])].includes(request.method),
        'METHOD_NOT_ALLOWED',
        405,
      );
      const token = cookie(request);
      const verified = token
        ? await observeOperation(() => authenticate(token))
        : { ok: true as const, value: null };
      if (!verified.ok)
        return failure(
          trace,
          verified.refusal === 'SESSION_REJECTED' ? 401 : 503,
          verified.refusal === 'SESSION_REJECTED' ? 'UNAUTHENTICATED' : 'UNAVAILABLE',
        );
      const handle = verified.value;
      requireContent(handle, 'UNAUTHENTICATED', 401);
      let space = null,
        cursor = null;
      do {
        const page = await security.spaces(handle, cursor, 50);
        space = page.find((s) => s.tenantId === tenant) ?? space;
        cursor = page.length === 50 ? page.at(-1)!.membershipId : null;
      } while (!space && cursor);
      requireContent(space, 'FORBIDDEN', 403);
      const x = { handle, tenant, member: space.membershipId, offering, deadline: new Deadline() };
      const run = async <T>(work: (context: typeof x) => Promise<T>) => {
        let refusal: unknown;
        try {
          return await admittedOperation(async (deadline) => {
            try {
              return await work({ ...x, deadline });
            } catch (error) {
              refusal = error;
              throw error;
            }
          });
        } catch (error) {
          throw refusal ?? error;
        }
      };
      if (match[4] === 'records') {
        requireContent(recordsRead && !url.search && !ai, 'INVALID_INPUT', 400);
        await run((ctx) => service.attemptRuntimeAccess(ctx, id(match[3])));
        return new Response(attemptRuntimeDocument(url.pathname.slice(0, -8)), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
            'Content-Security-Policy': PUBLISHED_PLAYER_CSP,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'same-origin',
          },
        });
      }
      if (match[4] === 'runtime') {
        requireContent(!match[5] && !ai, 'NOT_FOUND', 404);
        if (request.method === 'GET') {
          requireContent(url.searchParams.size === 1 && url.searchParams.has('attempt'));
          return response(
            trace,
            200,
            await run((ctx) =>
              service.attemptRuntime(ctx, id(match[3]), id(url.searchParams.get('attempt'))),
            ),
          );
        }
        requireContent(!url.search && request.headers.get('content-type') === 'application/json');
        const csrf = request.headers.get('x-zhiban-csrf');
        requireContent(csrf && /^[A-Za-z0-9_-]{43}$/.test(csrf), 'FORBIDDEN', 403);
        try {
          await security.assertUnsafe(handle, origin, csrf);
        } catch {
          throw new ContentError('FORBIDDEN', 403);
        }
        const v = (await body(request, 2048, 3000)) as Record<string, unknown>;
        requireContent(
          v &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            Object.keys(v).sort().join(',') === 'attemptId,publicationId,type' &&
            v.type === 'BIND_ATTEMPT',
        );
        const attempt = id(v.attemptId),
          publication = id(v.publicationId);
        return response(
          trace,
          200,
          await run((ctx) => service.attemptRuntime(ctx, id(match[3]), attempt, publication)),
        );
      }
      if (assetRead) {
        requireContent(
          url.searchParams.size === 3 &&
            ['draft', 'published'].includes(url.searchParams.get('source') ?? ''),
        );
        const source = url.searchParams.get('source')!,
          version =
            source === 'draft'
              ? revision(url.searchParams.get('version'))
              : id(url.searchParams.get('version')),
          slide = id(url.searchParams.get('slide'));
        requireContent(streams < 2, 'UNAVAILABLE', 503);
        streams++;
        let released = false;
        const done = () => {
          if (!released) {
            released = true;
            streams--;
          }
        };
        try {
          return await service.assetResponse(
            x,
            id(match[3]),
            id(match[5]),
            source,
            version,
            slide,
            request.method as 'GET' | 'HEAD',
            request.headers.get('range'),
            request.signal,
            done,
          );
        } catch (e) {
          done();
          throw e;
        }
      }
      if (match[4] === 'player' || match[4] === 'frame') {
        requireContent(playerRead || frameRead, 'METHOD_NOT_ALLOWED', 405);
        requireContent(
          url.searchParams.has('publication') &&
            (url.searchParams.size === 1 ||
              (playerRead &&
                url.searchParams.size === 2 &&
                (url.searchParams.has('dispatch') || url.searchParams.has('classroom')))),
        );
        const publication = id(url.searchParams.get('publication'));
        const preview = await run((ctx) =>
          service.preview(ctx, id(match[3]), 'published', undefined, publication),
        );
        requireContent(
          'publicationId' in preview &&
            typeof preview.publicationId === 'string' &&
            'publicationNo' in preview &&
            typeof preview.publicationNo === 'number',
        );
        if (frameRead) {
          requireContent(
            'html' in preview && typeof preview.html === 'string',
            'INVALID_STATE',
            409,
          );
          return new Response(preview.html, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'private, no-store',
              'Content-Security-Policy': INTERACTIVE_FRAME_CSP,
              'Referrer-Policy': 'no-referrer',
              'X-Content-Type-Options': 'nosniff',
              'Cross-Origin-Resource-Policy': 'same-origin',
            },
          });
        }
        const joint = url.searchParams.has('dispatch')
          ? await run((ctx) =>
              service.jointEntry(
                ctx,
                id(match[3]),
                publication,
                id(url.searchParams.get('dispatch')),
              ),
            )
          : undefined;
        if (preview.slides?.[0]?.elements?.[0]?.text?.startsWith('原生完整课件 · 来源 SHA256 ')) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: `/zhiban/native-published?tenant=${tenant}&offering=${offering}&resource=${match[3]}&publication=${preview.publicationId}`,
              'Cache-Control': 'private, no-store',
            },
          });
        }
        return new Response(
          publishedPlayerDocument(
            url.pathname.slice(0, -7),
            preview,
            tenant,
            service.attemptRuntimeEnabled,
            joint,
            url.searchParams.has('classroom') ? id(url.searchParams.get('classroom')) : undefined,
          ),
          {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'private, no-store',
              'Content-Security-Policy':
                'html' in preview
                  ? PUBLISHED_PLAYER_CSP.replace("frame-src 'none'", "frame-src 'self'")
                  : PUBLISHED_PLAYER_CSP,
              'X-Content-Type-Options': 'nosniff',
              'X-Frame-Options': 'DENY',
              'Referrer-Policy': 'same-origin',
              'Cross-Origin-Resource-Policy': 'same-origin',
              'X-Zhiban-Request-Id': trace,
            },
          },
        );
      }
      if (ai && request.method === 'GET') {
        requireContent(lesson, 'SERVICE_UNAVAILABLE', 503);
        return response(trace, 200, await run((ctx) => lesson.handle(ctx, request)));
      }
      if (request.method === 'GET') {
        if (match[4] === 'assets') {
          requireContent(!url.search && !match[5]);
          return response(trace, 200, await run((ctx) => service.uploads(ctx, id(match[3]))));
        }
        if (match[3]) {
          requireContent(
            url.searchParams.size === 1 &&
              ['draft', 'published'].includes(url.searchParams.get('source') ?? ''),
          );
          return response(
            trace,
            200,
            await run((ctx) => {
              const version = request.headers.get('x-zhiban-publication-version');
              requireContent(version === null || /^[1-9][0-9]{0,14}$/.test(version));
              requireContent(version === null || url.searchParams.get('source') === 'published');
              const publicationId = request.headers.get('x-zhiban-publication-id');
              if (publicationId !== null) {
                id(publicationId);
                requireContent(url.searchParams.get('source') === 'published');
              }
              return service.preview(
                ctx,
                id(match[3]),
                url.searchParams.get('source')!,
                version ?? undefined,
                publicationId ?? undefined,
              );
            }),
          );
        }
        requireContent(!url.search);
        return response(trace, 200, await run((ctx) => service.list(ctx)));
      }
      requireContent(
        upload
          ? url.searchParams.size === 1 && url.searchParams.has('revision')
          : !match[3] && (!url.search || (ai && url.search === '?kind=quiz')),
      );
      requireContent(
        upload || request.headers.get('content-type') === 'application/json',
        'UNSUPPORTED_MEDIA_TYPE',
        415,
      );
      const csrf = request.headers.get('x-zhiban-csrf');
      requireContent(csrf && /^[A-Za-z0-9_-]{43}$/.test(csrf), 'FORBIDDEN', 403);
      try {
        await security.assertUnsafe(handle, origin, csrf);
      } catch {
        throw new ContentError('FORBIDDEN', 403);
      }
      if (upload) {
        requireContent(request.body);
        const reader = request.body.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0;
        const read = async () => {
          try {
            while (true) {
              const v = await reader.read();
              if (v.done) break;
              size += v.value.byteLength;
              requireContent(size <= 4194304, 'TOO_LARGE', 413);
              chunks.push(v.value);
            }
          } finally {
            reader.releaseLock();
          }
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            read(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                void reader.cancel().catch(() => {});
                reject(new ContentError('UNAVAILABLE', 503));
              }, 3000);
            }),
          ]);
        } catch (e) {
          void request.body.cancel().catch(() => {});
          throw e;
        } finally {
          clearTimeout(timer);
        }
        return response(
          trace,
          200,
          await run((ctx) =>
            service.upload(
              ctx,
              id(match[3]),
              revision(url.searchParams.get('revision')),
              request.headers.get('x-zhiban-command') ?? '',
              Buffer.concat(chunks),
            ),
          ),
        );
      }
      const value = await body(request, 262144, 3000);
      if (ai) {
        requireContent(lesson, 'SERVICE_UNAVAILABLE', 503);
        return response(trace, 200, await run((ctx) => lesson.handle(ctx, request, value)));
      }
      return response(
        trace,
        200,
        await run((ctx) =>
          service.execute(ctx, value, request.headers.get('x-zhiban-command') ?? ''),
        ),
      );
    } catch (e) {
      if (e instanceof ContentError) return failure(trace, e.status, e.code);
      if (e instanceof ProtocolRefusal) return failure(trace, e.status, 'INVALID_REQUEST');
      return failure(trace, 503, 'UNAVAILABLE');
    } finally {
      active--;
    }
  };
}
