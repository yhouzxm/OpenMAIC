/** Platform landing/commands use the existing live session and frozen control authorization. */
import type { Pool } from 'pg';
import type { createIdentityComposition } from '../identity/composition/root';
import { observedTransport } from '../identity/composition/admission';
import { run, now } from '../identity/composition/support';
import {
  headers,
  cookie,
  body,
  record,
  requestId,
  response,
  failure,
  ProtocolRefusal,
} from '../identity/http/protocol';
export function platformHttp(
  identity: Awaited<ReturnType<typeof createIdentityComposition>>,
  pool: Pool,
  origin: string,
) {
  return async (request: Request) => {
    const id = requestId(),
      u = new URL(request.url),
      unsafe = request.method !== 'GET';
    try {
      headers(request, origin, unsafe);
      if (u.search) return failure(id, 400, 'INVALID_REQUEST');
      const handle = await identity.security.authenticate(cookie(request));
      if (!handle) return failure(id, 401, 'UNAUTHENTICATED');
      const security = await identity.security.membershipSecurity();
      const allowed = await run(pool, async (c) => {
        await security.assertSession(c, handle);
        const at = await now(c);
        const rows = await c.query(
          'SELECT grant_id FROM zhiban_identity.system_admin_grants WHERE user_id=$1 AND revoked_at IS NULL AND valid_from<=$2 AND (valid_until IS NULL OR valid_until>$2) FOR SHARE',
          [security.actor(handle), at.toString()],
        );
        await security.assertSession(c, handle);
        return rows.rows.length > 0;
      });
      if (!allowed) return failure(id, 403, 'FORBIDDEN');
      if (request.method === 'GET' && u.pathname === '/api/zhiban/platform')
        return response(id, 200, {
          userId: security.actor(handle),
          platformAdmin: true,
          controlCommandsEnabled: identity.control !== null,
        });
      if (request.method !== 'POST') return failure(id, 405, 'METHOD_NOT_ALLOWED');
      await identity.security.assertUnsafe(
        handle,
        request.headers.get('origin'),
        request.headers.get('x-zhiban-csrf'),
      );
      if (!identity.control) return failure(id, 503, 'CONTROL_APPROVAL_NOT_CONFIGURED');
      const transport = observedTransport(request.headers.get('x-zhiban-client-ip') ?? '');
      if (u.pathname === '/api/zhiban/platform/approvals/register') {
        const b = record(await body(request, 8192, 3000), ['approvalRef', 'password']);
        if (
          typeof b.approvalRef !== 'string' ||
          typeof b.password !== 'string' ||
          b.password.length > 1024
        )
          return failure(id, 400, 'INVALID_REQUEST');
        return response(
          id,
          200,
          await identity.control.registerApproval(handle, b.approvalRef, b.password, transport, id),
        );
      }
      if (u.pathname === '/api/zhiban/platform/commands/execute') {
        const b = record(await body(request, 8192, 3000), ['command', 'password']);
        if (typeof b.password !== 'string' || b.password.length > 1024)
          return failure(id, 400, 'INVALID_REQUEST');
        return response(
          id,
          200,
          await identity.control.execute(
            handle,
            b.command as Parameters<NonNullable<typeof identity.control>['execute']>[1],
            b.password,
            transport,
          ),
        );
      }
      return failure(id, 404, 'NOT_FOUND');
    } catch (e) {
      return failure(id, e instanceof ProtocolRefusal ? e.status : 403, 'REQUEST_REJECTED');
    }
  };
}
