import type { ImportsService } from '@/lib/zhiban/application/imports/service';
import { AcademicError, academicId, requireAcademic } from '@/lib/zhiban/domain/academic/model';
import type { IdentityAuthentication } from '@/lib/zhiban/infrastructure/identity/composition/authentication';
import { academicSessionAuthentication } from '../academic/session-authentication';
import { observeOperation } from '@/lib/zhiban/infrastructure/identity/composition/refusals';
import {
  body,
  cookie,
  headers,
  ProtocolRefusal,
  response,
  failure,
  requestId,
} from '@/lib/zhiban/infrastructure/identity/http/protocol';

export function createImportsHttp(
  service: ImportsService,
  security: IdentityAuthentication,
  allowedOrigin: string,
  observe: (code: string) => void = () => {},
) {
  let active = 0;
  const authenticate = academicSessionAuthentication(
    (token) => security.authenticate(token),
    observe,
  );
  return async (request: Request) => {
    const id = requestId();
    if (active >= 8) return failure(id, 503, 'SERVICE_UNAVAILABLE');
    active++;
    try {
      headers(request, allowedOrigin, request.method === 'POST');
      const url = new URL(request.url),
        match = /^\/api\/zhiban\/imports\/([^/]+)(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname);
      if (!match) return failure(id, 404, 'NOT_FOUND');
      if (!['GET', 'POST'].includes(request.method)) return failure(id, 405, 'METHOD_NOT_ALLOWED');
      if (
        [...url.searchParams.keys()].some((k) => k !== 'after') ||
        url.searchParams.getAll('after').length > 1 ||
        (url.search && (request.method !== 'GET' || match[2]))
      )
        return failure(id, 400, 'INVALID_INPUT');
      const tenant = academicId(match[1]);
      const batch = match[2] ? academicId(match[2]) : null;
      const token = cookie(request);
      const verified =
        token === null
          ? { ok: true as const, value: null }
          : await observeOperation(() => authenticate(token));
      if (!verified.ok)
        return failure(
          id,
          verified.refusal === 'SESSION_REJECTED' ? 401 : 503,
          verified.refusal === 'SESSION_REJECTED' ? 'UNAUTHENTICATED' : 'SERVICE_UNAVAILABLE',
        );
      const handle = verified.value;
      if (handle === null) return failure(id, 401, 'UNAUTHENTICATED');
      let space = null;
      let cursor = null;
      do {
        const page = await security.spaces(handle, cursor, 50);
        space = page.find((row) => row.tenantId === tenant) ?? space;
        cursor = page.length === 50 ? page.at(-1)!.membershipId : null;
      } while (!space && cursor);
      if (!space) return failure(id, 403, 'FORBIDDEN');
      const context = { handle, tenantId: tenant, actorMembershipId: space.membershipId };
      if (request.method === 'GET')
        return response(
          id,
          200,
          batch
            ? await service.read(context, batch)
            : await service.list(context, url.searchParams.get('after')),
        );
      if (request.headers.get('content-type') !== 'application/json')
        return failure(id, 415, 'UNSUPPORTED_MEDIA_TYPE');
      const csrf = request.headers.get('x-zhiban-csrf');
      if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) return failure(id, 403, 'FORBIDDEN');
      try {
        await security.assertUnsafe(handle, allowedOrigin, csrf);
      } catch {
        return failure(id, 403, 'FORBIDDEN');
      }
      const input = await body(request, 131072, 3000);
      requireAcademic(input !== null && typeof input === 'object' && !Array.isArray(input));
      const value = input as Record<string, unknown>;
      const keys = Object.keys(value).sort().join(',');
      if (!batch && value.type === 'PREVIEW' && keys === 'csv,kind,type')
        return response(
          id,
          200,
          await service.preview(context, value.kind, value.csv, request.signal),
        );
      if (batch && value.type === 'COMMIT' && keys === 'type')
        return response(id, 200, await service.commit(context, batch, request.signal));
      return failure(id, 400, 'INVALID_INPUT');
    } catch (error) {
      if (error instanceof ProtocolRefusal) return failure(id, error.status, 'INVALID_REQUEST');
      if (error instanceof AcademicError) {
        const status =
          error.code === 'INVALID_INPUT'
            ? 400
            : error.code === 'FORBIDDEN' || error.code === 'INACTIVE_MEMBER'
              ? 403
              : error.code === 'NOT_FOUND'
                ? 404
                : error.code === 'UNAVAILABLE'
                  ? 503
                  : 409;
        return failure(id, status, error.code);
      }
      const code = (error as { code?: string }).code;
      observe(typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code) ? code : 'UNKNOWN');
      return failure(id, 503, 'SERVICE_UNAVAILABLE');
    } finally {
      active--;
    }
  };
}
