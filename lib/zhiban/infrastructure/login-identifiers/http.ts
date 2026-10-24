import { academicSessionAuthentication } from '../academic/session-authentication';
import { LoginIdentifiers } from './service';
import { canonicalLoginAlias } from '../../domain/login-identifiers/model';
import type { createIdentityComposition } from '../identity/composition/root';
import { AcademicError } from '../../domain/academic/model';
import {
  body,
  query,
  headers,
  cookie,
  record,
  text,
  response,
  failure,
  requestId,
  ProtocolRefusal,
} from '../identity/http/protocol';
import { bearerForCookie } from '../identity/sessions/session-material';
import { observeOperation } from '../identity/composition/refusals';
export function createLoginIdentifiersHttp(
  service: LoginIdentifiers,
  composition: Awaited<ReturnType<typeof createIdentityComposition>>,
  origin: string,
) {
  const authenticate = academicSessionAuthentication((token: string) =>
    composition.security.authenticate(token),
  );
  let active = 0;
  return async (request: Request, peer: string) => {
    const id = requestId();
    if (active >= 4) return failure(id, 503, 'SERVICE_UNAVAILABLE');
    active++;
    try {
      const path = new URL(request.url).pathname,
        login = path === '/api/zhiban/login-identifiers/login';
      if (!login && path !== '/api/zhiban/login-identifiers/me')
        return failure(id, 404, 'NOT_FOUND');
      if (
        (login && request.method !== 'POST') ||
        (!login && !['GET', 'POST'].includes(request.method))
      )
        return failure(id, 405, 'METHOD_NOT_ALLOWED');
      headers(request, origin, request.method === 'POST');
      query(request, []);
      if (!service.enabled) return failure(id, 503, 'SERVICE_UNAVAILABLE');
      const raw = cookie(request);
      if (login) {
        const b = record(await body(request, 8192, 3000), ['identifier', 'password']);
        text(b.identifier, /^[\s\S]{0,128}$/);
        text(b.password, /^[\s\S]{1,4096}$/);
        const op = await observeOperation(() =>
          service.login(b.identifier, b.password as string, peer, id, raw),
        );
        if (!op.ok)
          return failure(id, op.refusal === 'ADMISSION_DENIED' ? 429 : 503, 'SERVICE_UNAVAILABLE');
        const result = op.value;
        if (result.status === 'RATE_LIMITED') return failure(id, 429, 'SERVICE_UNAVAILABLE');
        if (result.status !== 'ISSUED') return failure(id, 401, 'UNAUTHENTICATED');
        const maxAge = Math.max(
          0,
          Math.floor((result.identity.absoluteExpiresAt - Date.now()) / 1000),
        );
        if (!maxAge) return failure(id, 401, 'UNAUTHENTICATED');
        const r = response(id, 200, {
          userId: result.identity.userId,
          absoluteExpiresAt: result.identity.absoluteExpiresAt,
          idleExpiresAt: result.identity.idleExpiresAt,
        });
        r.headers.set(
          'set-cookie',
          `__Host-zhiban_session=${bearerForCookie(result.bearer)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}; Expires=${new Date(result.identity.absoluteExpiresAt).toUTCString()}`,
        );
        return r;
      }
      if (!raw) return failure(id, 401, 'UNAUTHENTICATED');
      const auth = await observeOperation(() => authenticate(raw));
      if (!auth.ok)
        return failure(
          id,
          auth.refusal === 'SESSION_REJECTED' ? 401 : 503,
          auth.refusal === 'SESSION_REJECTED' ? 'UNAUTHENTICATED' : 'SERVICE_UNAVAILABLE',
        );
      if (!auth.value) return failure(id, 401, 'UNAUTHENTICATED');
      if (request.method === 'GET') return response(id, 200, await service.own(raw, auth.value));
      const csrf = request.headers.get('x-zhiban-csrf');
      if (!csrf) throw new ProtocolRefusal(403);
      const unsafe = await observeOperation(() =>
        composition.application.assertUnsafe(auth.value!, origin, csrf),
      );
      if (!unsafe.ok)
        return failure(
          id,
          unsafe.refusal === null ? 503 : unsafe.refusal === 'SESSION_REJECTED' ? 401 : 403,
          'FORBIDDEN',
        );
      const b = record(await body(request, 8192, 3000), [
        'action',
        'alias',
        'revision',
        'password',
      ]);
      if (
        !['ACCEPT', 'RETIRE'].includes(String(b.action)) ||
        canonicalLoginAlias(b.alias) !== b.alias ||
        typeof b.revision !== 'string' ||
        !/^[1-9][0-9]{0,15}$/.test(b.revision)
      )
        throw new ProtocolRefusal(400);
      text(b.password, /^[\s\S]{1,4096}$/);
      return response(
        id,
        200,
        await service.mutate(
          raw,
          auth.value,
          b as { action: 'ACCEPT' | 'RETIRE'; alias: string; revision: string; password: string },
          peer,
          id,
        ),
      );
    } catch (e) {
      if (e instanceof ProtocolRefusal) return failure(id, e.status, 'INVALID_REQUEST');
      const code = e instanceof AcademicError ? e.code : (e as { code?: string }).code;
      return failure(
        id,
        code === 'FORBIDDEN' || code === '42501'
          ? 403
          : code === '40001' || code === '23505' || code === 'RETRYABLE_PERSISTENCE_FAILURE'
            ? 409
            : code === 'INVALID_INPUT'
              ? 400
              : 503,
        code === 'FORBIDDEN' || code === '42501'
          ? 'FORBIDDEN'
          : code === '40001' || code === '23505' || code === 'RETRYABLE_PERSISTENCE_FAILURE'
            ? 'CONFLICT'
            : 'SERVICE_UNAVAILABLE',
      );
    } finally {
      active--;
    }
  };
}
