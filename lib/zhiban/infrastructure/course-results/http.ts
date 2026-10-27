import type { IdentityAuthentication } from '../identity/composition/authentication';
import type { MembershipId } from '../../domain/identity';
import { academicSessionAuthentication } from '../academic/session-authentication';
import { AcademicError, academicId } from '../../domain/academic/model';
import { ContentError } from '../content/model';
import {
  body,
  cookie,
  headers,
  response,
  failure,
  requestId,
  ProtocolRefusal,
} from '../identity/http/protocol';
import { resultCommand } from './model';
import type { CourseResultsService } from './service';
export function courseResultsHttp(
  service: CourseResultsService,
  security: IdentityAuthentication,
  origin: string,
) {
  const authenticate = academicSessionAuthentication((t) => security.authenticate(t));
  let active = 0;
  return async (request: Request) => {
    const trace = requestId();
    if (active >= 8) return failure(trace, 503, 'UNAVAILABLE');
    active++;
    try {
      const u = new URL(request.url),
        m = /^\/api\/zhiban\/course-results\/([^/]+)\/offerings\/([^/]+)$/.exec(u.pathname);
      if (!m) return failure(trace, 404, 'NOT_FOUND');
      if (!['GET', 'POST'].includes(request.method))
        return failure(trace, 405, 'METHOD_NOT_ALLOWED');
      const tenant = academicId(m[1]),
        offering = academicId(m[2]);
      headers(request, origin, request.method === 'POST');
      if (u.searchParams.size > 1 || [...u.searchParams.keys()].some((k) => k !== 'before'))
        return failure(trace, 400, 'INVALID_INPUT');
      const before = u.searchParams.has('before')
        ? academicId(u.searchParams.get('before'))
        : undefined;
      const token = cookie(request),
        handle = token ? await authenticate(token) : null;
      if (!handle) return failure(trace, 401, 'UNAUTHENTICATED');
      let member: string | undefined,
        cursor: MembershipId | null = null;
      do {
        const rows = await security.spaces(handle, cursor, 50);
        member = rows.find((r) => r.tenantId === tenant)?.membershipId ?? member;
        cursor = rows.length === 50 ? rows.at(-1)!.membershipId : null;
      } while (!member && cursor);
      if (!member) return failure(trace, 403, 'FORBIDDEN');
      const x = { handle, tenantId: tenant, actorMembershipId: member };
      if (request.method === 'GET')
        return response(trace, 200, await service.list(x, offering, before));
      if (u.search) throw new AcademicError('INVALID_INPUT');
      const csrf = request.headers.get('x-zhiban-csrf');
      if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new AcademicError('FORBIDDEN');
      try {
        await security.assertUnsafe(handle, origin, csrf);
      } catch {
        throw new AcademicError('FORBIDDEN');
      }
      const parsed = resultCommand.safeParse(await body(request, 16384, 3000));
      if (!parsed.success) throw new AcademicError('INVALID_INPUT');
      return response(
        trace,
        200,
        await service.execute(
          x,
          offering,
          parsed.data,
          request.headers.get('x-zhiban-command') ?? '',
        ),
      );
    } catch (e) {
      if (e instanceof ProtocolRefusal) return failure(trace, e.status, 'INVALID_REQUEST');
      if (e instanceof ContentError) return failure(trace, e.status, e.code);
      if (e instanceof AcademicError)
        return failure(
          trace,
          e.code === 'FORBIDDEN'
            ? 403
            : e.code === 'NOT_FOUND'
              ? 404
              : e.code === 'INVALID_INPUT'
                ? 400
                : e.code === 'UNAVAILABLE'
                  ? 503
                  : 409,
          e.code,
        );
      return failure(trace, 503, 'UNAVAILABLE');
    } finally {
      active--;
    }
  };
}
