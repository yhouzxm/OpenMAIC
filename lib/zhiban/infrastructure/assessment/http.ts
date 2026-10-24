import type { QuizAdviceService } from '../../application/quiz/advice';
import type { FinalGradeService } from '../../application/finalgrade/service';
import { gradebookCsv } from '../../application/assessment/gradebook-csv';
import type { AssessmentService } from '@/lib/zhiban/application/assessment/service';
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

export function createAssessmentHttp(
  service: AssessmentService,
  security: IdentityAuthentication,
  allowedOrigin: string,
  observe: (code: string) => void = () => {},
  attachmentsEnabled = false,
  finalgrade?: FinalGradeService,
  advice?: QuizAdviceService,
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
          /^\/api\/zhiban\/assessment\/([^/]+)\/offerings\/([^/]+)(?:\/(finalgrades|publications|queue|gradebook(?:\.csv|-export\.csv)?))?$/.exec(
            url.pathname,
          );
      if (!match) return failure(id, 404, 'NOT_FOUND');
      if (!['GET', 'POST'].includes(request.method)) return failure(id, 405, 'METHOD_NOT_ALLOWED');
      if (match[3] && match[3] !== 'finalgrades' && request.method !== 'GET')
        return failure(id, 405, 'METHOD_NOT_ALLOWED');
      const filters = query(
        request,
        match[3] === 'finalgrades'
          ? request.method === 'GET'
            ? ['member', 'view', 'after']
            : []
          : !match[3]
            ? []
            : match[3] === 'gradebook-export.csv'
              ? ['q']
              : match[3] === 'gradebook' || match[3] === 'gradebook.csv'
                ? ['q', 'limit', 'activityLimit', 'cursor', 'activityCursor']
                : match[3] === 'queue'
                  ? ['q', 'activity', 'member', 'state', 'limit', 'cursor', 'activityType']
                  : ['submission', 'limit', 'cursor'],
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
      if (
        request.method === 'GET' &&
        ['gradebook.csv', 'gradebook-export.csv'].includes(match[3])
      ) {
        const all = match[3] === 'gradebook-export.csv';
        // One bounded projection under current authorization; never concatenate page snapshots.
        const page = all
          ? await service.exportGradebook(context, offering, filters)
          : await service.gradebook(context, offering, filters);
        const csv = gradebookCsv(
          { ...page, next: null, activityNext: null },
          all ? 'FILTER' : 'PAGE',
        );
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="zhiban-gradebook-${all ? 'filtered-' : ''}${offering}.csv"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'X-Request-Id': id,
          },
        });
      }
      if (match[3] === 'finalgrades' && request.method === 'GET') {
        if (!finalgrade) return failure(id, 503, 'SERVICE_UNAVAILABLE');
        return response(id, 200, await finalgrade.read(context, offering, filters));
      }
      if (request.method === 'GET')
        return response(
          id,
          200,
          match[3] === 'gradebook'
            ? await service.gradebook(context, offering, filters)
            : match[3]
              ? {
                  submissionAttachments: attachmentsEnabled,
                  ...(await service.page(
                    context,
                    offering,
                    match[3] as 'publications' | 'queue',
                    filters,
                  )),
                }
              : await service.read(context, offering),
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
      const commandBody = await body(request, 32768, 3000),
        commandKey = request.headers.get('x-zhiban-command') ?? '';
      if (match[3] === 'finalgrades') {
        if (!finalgrade) throw new AcademicError('UNAVAILABLE');
        return response(
          id,
          200,
          await finalgrade.execute(context, offering, commandBody, commandKey),
        );
      }
      if (
        ['SUGGEST_QUIZ_GRADE', 'ACCEPT_QUIZ_ADVICE', 'REJECT_QUIZ_ADVICE'].includes(
          (commandBody as { type: string }).type,
        )
      ) {
        if (!advice) throw new AcademicError('UNAVAILABLE');
        return response(id, 200, await advice.command(context, offering, commandBody, commandKey));
      }
      return response(id, 200, await service.command(context, offering, commandBody, commandKey));
    } catch (error) {
      if (error instanceof ProtocolRefusal) return failure(id, error.status, 'INVALID_REQUEST');
      if (error instanceof AcademicError) {
        const status =
          error.code === 'INVALID_INPUT'
            ? 400
            : error.code === 'EXPORT_LIMIT'
              ? 413
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
