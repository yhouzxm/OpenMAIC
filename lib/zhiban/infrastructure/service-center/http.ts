import type { MembershipId } from '@/lib/zhiban/domain/identity';
import type { IdentityAuthentication } from '../identity/composition/authentication';
import { academicSessionAuthentication } from '../academic/session-authentication';
import { academicId, AcademicError } from '@/lib/zhiban/domain/academic/model';
import { ModelSettingsError } from '@/lib/server/model-config/settings';
import { WorkspaceConfigConflictError } from '@/lib/persistence/workspace-model-config';
import { body, cookie, headers, ProtocolRefusal } from '../identity/http/protocol';
import type { ServiceCenter } from './service';
export function serviceCenterHttp(
  service: ServiceCenter,
  security: IdentityAuthentication,
  origin: string,
) {
  const authenticate = academicSessionAuthentication((t) => security.authenticate(t));
  let active = 0;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  return async (request: Request) => {
    if (active >= 8) return json({ error: { code: 'UNAVAILABLE', message: '服务繁忙' } }, 503);
    active++;
    try {
      const url = new URL(request.url),
        m = /^\/api\/zhiban\/service-center\/([^/]+)\/(config|usage|events|check)$/.exec(
          url.pathname,
        );
      if (!m) return json({ error: { code: 'NOT_FOUND' } }, 404);
      const tenant = academicId(m[1]),
        kind = m[2],
        unsafe = !['GET', 'HEAD'].includes(request.method);
      headers(request, origin, unsafe);
      if (
        request.method !==
        (kind === 'config' ? (unsafe ? 'PUT' : 'GET') : kind === 'check' ? 'POST' : 'GET')
      )
        return json({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
      if (
        [...url.searchParams.keys()].some(
          (k) => !(kind === 'usage' ? ['month'] : kind === 'events' ? ['cursor'] : []).includes(k),
        ) ||
        new Set(url.searchParams.keys()).size !== url.searchParams.size
      )
        throw new AcademicError('INVALID_INPUT');
      const token = cookie(request),
        handle = token ? await authenticate(token) : null;
      if (!handle) return json({ error: { code: 'UNAUTHENTICATED', message: '请登录' } }, 401);
      let member: string | undefined,
        cursor: MembershipId | null = null;
      do {
        const rows = await security.spaces(handle, cursor, 50);
        member = rows.find((r) => r.tenantId === tenant)?.membershipId ?? member;
        cursor = rows.length === 50 ? rows.at(-1)!.membershipId : null;
      } while (!member && cursor);
      if (!member) throw new AcademicError('FORBIDDEN');
      const x = { handle, tenantId: tenant, actorMembershipId: member };
      if (unsafe) {
        const csrf = request.headers.get('x-zhiban-csrf');
        if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new AcademicError('FORBIDDEN');
        try {
          await security.assertUnsafe(handle, origin, csrf);
        } catch {
          throw new AcademicError('FORBIDDEN');
        }
      }
      if (kind === 'config')
        return json(
          unsafe
            ? await service.change(
                x,
                await body(request, 65536, 3000),
                request.headers.get('x-zhiban-command') ?? '',
              )
            : await service.view(x),
        );
      if (kind === 'events')
        return json(await service.history(x, url.searchParams.get('cursor') ?? undefined));
      if (kind === 'usage')
        return json(
          await service.usage(
            x,
            url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7),
          ),
        );
      return json(
        await service.check(
          x,
          await body(request, 4096, 3000),
          request.headers.get('x-zhiban-command') ?? '',
          request.signal,
        ),
      );
    } catch (e) {
      const conflict = e instanceof WorkspaceConfigConflictError;
      const code = conflict
        ? 'CONFLICT'
        : e instanceof AcademicError
          ? e.code
          : e instanceof ModelSettingsError
            ? e.code
            : e instanceof ProtocolRefusal
              ? 'INVALID_REQUEST'
              : 'UNAVAILABLE';
      const status =
        e instanceof ProtocolRefusal
          ? e.status
          : code === 'FORBIDDEN'
            ? 403
            : code === 'NOT_FOUND'
              ? 404
              : code === 'CONFLICT' || code === 'SLOT_LOCKED'
                ? 409
                : code === 'UNAVAILABLE'
                  ? 503
                  : 400;
      return json(
        {
          error: {
            code,
            message:
              status === 403
                ? '当前身份没有此空间的管理权限'
                : status === 409
                  ? '配置已变化，请刷新后重试'
                  : status === 400
                    ? '配置不符合原生服务规则'
                    : '操作未完成，请核对状态',
          },
        },
        status,
      );
    } finally {
      active--;
    }
  };
}
