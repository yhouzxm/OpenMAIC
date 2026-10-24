import type { AnalyticsService } from '@/lib/zhiban/application/analytics/service';
import { AcademicError, academicId } from '@/lib/zhiban/domain/academic/model';
import type { IdentityAuthentication } from '@/lib/zhiban/infrastructure/identity/composition/authentication';
import { academicSessionAuthentication } from '../academic/session-authentication';
import { observeOperation } from '@/lib/zhiban/infrastructure/identity/composition/refusals';
import {
  body,
  query,
  cookie,
  headers,
  ProtocolRefusal,
  response,
  failure,
  requestId,
} from '@/lib/zhiban/infrastructure/identity/http/protocol';

export function createAnalyticsHttp(
  service: AnalyticsService,
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
        match =
          /^\/api\/zhiban\/analytics\/([^/]+)\/offerings\/([^/]+)(?:\/(followups|followup-cases)(?:\/([^/]+))?)?$/.exec(
            url.pathname,
          );
      if (!match) return failure(id, 404, 'NOT_FOUND');
      const cases = match[3] === 'followup-cases';
      if (match[4] && !cases) return failure(id, 404, 'NOT_FOUND');
      if (
        !['GET', 'POST'].includes(request.method) ||
        (request.method === 'POST' && (!cases || match[4]))
      )
        return failure(id, 405, 'METHOD_NOT_ALLOWED');
      const selection = query(
        request,
        cases
          ? request.method === 'POST'
            ? []
            : match[4]
              ? ['cursor']
              : ['q', 'state', 'cursor']
          : match[3]
            ? ['q', 'state', 'limit', 'cursor']
            : ['activityId', 'version'],
      );
      const tenant = academicId(match[1]);
      const offering = academicId(match[2]);
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
      if (cases) {
        if (request.method === 'GET')
          return response(
            id,
            200,
            await service.cases(context, offering, match[4] ?? null, selection),
          );
        const csrf = request.headers.get('x-zhiban-csrf');
        if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) return failure(id, 403, 'FORBIDDEN');
        try {
          await security.assertUnsafe(handle, allowedOrigin, csrf);
        } catch {
          return failure(id, 403, 'FORBIDDEN');
        }
        return response(
          id,
          200,
          await service.caseCommand(
            context,
            offering,
            await body(request, 16384, 3000),
            request.headers.get('x-zhiban-command') ?? '',
          ),
        );
      }
      return response(
        id,
        200,
        await (match[3]
          ? service.followups(context, offering, selection)
          : service.read(context, offering, selection)),
      );
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
